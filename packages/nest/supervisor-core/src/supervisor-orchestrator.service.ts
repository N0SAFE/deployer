/**
 * SupervisorOrchestratorService — super-global registry and driver for all
 * platform supervisors.
 *
 * Supervisors SELF-REGISTER from their own `onModuleInit` (each decides when
 * IT is ready — e.g. the global-db supervisor waits for the database URL and
 * skips registration for external databases), so any module can add a
 * supervisor without touching this file. The orchestrator:
 *
 *   1. Drives boot-time convergence of every registered supervisor
 *      (isolated failures — one degraded supervisor never blocks others).
 *   2. Aggregates health snapshots for the health module.
 *   3. Resolves supervisors for consumers via the AWAITED `getSupervisor(Class)`
 *      accessor (waits for self-registration) and `getSupervisorById`.
 */

import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import z from "zod/v4";
import { filter } from "rxjs/operators";
import type { Subscription } from "rxjs";

import type {
	BaseSupervisorService,
	SupervisorHealthSnapshot,
	SupervisorState,
} from "./base-supervisor.service";
import { SupervisorEventBus } from "./supervisor-event.bus";

/** Any registered supervisor — payload + process-info types are heterogeneous. */
export type AnySupervisor = BaseSupervisorService<z.ZodType, z.ZodType>;

/** How long `getSupervisor` waits for a supervisor to SELF-REGISTER before
 *  giving up (supervisors register from their own onModuleInit, possibly late
 *  — e.g. the global-db supervisor waits for the database URL). */
const DEFAULT_REGISTRATION_WAIT_MS = 10_000;

@Injectable()
export class SupervisorOrchestratorService implements OnApplicationBootstrap, OnModuleDestroy {
	/**
	 * How often to re-attempt supervisors that are DEGRADED.
	 *
	 * ── WHY THIS EXISTS (observed, not theoretical) ─────────────────────────────
	 * `ensureAll()` runs ONCE at bootstrap. That is wrong for this platform for a
	 * structural reason: the API starts BEFORE setup has provisioned the database
	 * — the API existing early is what lets setup hand over to it. So every
	 * supervisor that touches the DB races the schema and can lose:
	 *
	 *   [ManagedWebSupervisorService] Convergence failed:
	 *     insert into "app_config" ... on conflict ("key") do update ...
	 *   [SupervisorOrchestrator] ⚠️ "platform-managed-web" DEGRADED after boot
	 *
	 * ...at 09:02:22, against a schema that finished migrating at 09:02:27. Five
	 * seconds. Nothing ever retried it, so the supervisor stayed degraded forever,
	 * `/health/ready` stayed RED, and setup — which waits for readiness before
	 * releasing the entry port — never handed over. The operator saw three
	 * services instead of five, and an ingress that never became swarm-managed.
	 *
	 * The retry is what makes that five-second race survivable instead of fatal.
	 *
	 * Only DEGRADED supervisors are retried: `pending` already has its own
	 * recovery path (its blocker is re-evaluated on every call) and `converged`
	 * needs nothing. A supervisor that is genuinely broken simply stays degraded
	 * and keeps reporting itself in health — the cadence never masks a real fault.
	 */
	private static readonly DEGRADED_RETRY_INTERVAL_MS = 15_000;

	/**
	 * Cadence of the full reconcile sweep — see `scheduleReconcileSweep`.
	 *
	 * Slower than the degraded retry because it re-runs EVERY supervisor, including
	 * the ones already reporting `converged`.
	 */
	private static readonly RECONCILE_SWEEP_INTERVAL_MS = 60_000;

	/**
	 * Event bus driving the registration wait of `getSupervisor`. Supervisors
	 * emit `registered` from their own onModuleInit — the async accessor
	 * re-checks the registry on every such event until its timeout.
	 */
	@Inject(SupervisorEventBus)
	protected readonly supervisorEvents: SupervisorEventBus | undefined;

	private readonly logger = new Logger(SupervisorOrchestratorService.name);
	private readonly supervisors: Map<string, AnySupervisor>;

	/** Chained-timer handle for the degraded retry cadence. */
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	/** Full reconcile sweep timer — see `scheduleReconcileSweep`. */
	private sweepTimer: ReturnType<typeof setTimeout> | null = null;	private disposed = false;

	/**
	 * Nest DI (`SupervisorsModule`) passes the PROCESS-WIDE registry so every
	 * bootstrapped app (gateway + main sub-app) observes the same supervisors
	 * — the gateway app RUNS them (before/while setup), the sub-apps only
	 * consume. Direct construction (unit tests) creates an isolated map.
	 */
	constructor(sharedRegistry?: Map<string, AnySupervisor>) {
		this.supervisors = sharedRegistry ?? new Map<string, AnySupervisor>();
	}

	/**
	 * Register a supervisor (idempotent by supervisorId). Supervisors publish
	 * themselves from `BaseSupervisorService.onModuleInit` — never call this
	 * manually from implementations.
	 */
	register(supervisor: AnySupervisor): void {
		const existing = this.supervisors.get(supervisor.supervisorId);
		if (existing !== undefined) {
			if (existing === supervisor) return;
			throw new Error(
				`Duplicate supervisorId "${supervisor.supervisorId}" registered by both ${existing.constructor.name} and ${supervisor.constructor.name}`,
			);
		}
		this.supervisors.set(supervisor.supervisorId, supervisor);
		this.logger.log(`Registered supervisor "${supervisor.supervisorId}" (${supervisor.constructor.name})`);
	}

	list(): AnySupervisor[] {
		return [...this.supervisors.values()];
	}

	has(supervisorId: string): boolean {
		return this.supervisors.has(supervisorId);
	}

	/**
	 * Resolve a REGISTERED supervisor by its class — fully typed by its own
	 * payload + process-info schemas. Returns null when nothing registered
	 * within `timeoutMs` (default 10s).
	 *
	 * This is THE accessor for code that needs the supervised process: it
	 * AWAITS self-registration (supervisors register from their own
	 * onModuleInit — possibly late, like the global-db supervisor) and the
	 * returned instance exposes the entire config + live information about
	 * the process:
	 *
	 *   const traefik = await orch.getSupervisor(TraefikSupervisorService);
	 *   const info = traefik && (await traefik.getProcessInfo());
	 *   // info.process.kind === "docker" (desired + live container view)
	 *   // info.urls.entryUrl / apiUrl / webUrl — how to reach it
	 *   // info.entry.port + isDefault80 — the ingress entry port
	 */
	async getSupervisor<T extends AnySupervisor>(
		supervisorClass: new (...args: any[]) => T,
		options: { timeoutMs?: number } = {},
	): Promise<T | null> {
		const immediate = this.findSupervisorByClass(supervisorClass);
		if (immediate !== null) return immediate;
		return await this.awaitRegistration(
			() => this.findSupervisorByClass(supervisorClass),
			options.timeoutMs ?? DEFAULT_REGISTRATION_WAIT_MS,
		);
	}

	/** Resolve a registered supervisor by its stable id (typed only at runtime
	 *  — prefer `getSupervisor(Class)` for fully typed access). */
	async getSupervisorById(
		supervisorId: string,
		options: { timeoutMs?: number } = {},
	): Promise<AnySupervisor | null> {
		const immediate = this.supervisors.get(supervisorId) ?? null;
		if (immediate !== null) return immediate;
		return await this.awaitRegistration(
			() => this.supervisors.get(supervisorId) ?? null,
			options.timeoutMs ?? DEFAULT_REGISTRATION_WAIT_MS,
		);
	}

	private findSupervisorByClass<T extends AnySupervisor>(supervisorClass: new (...args: any[]) => T): T | null {
		for (const supervisor of this.supervisors.values()) {
			if (supervisor instanceof supervisorClass) return supervisor;
		}
		return null;
	}

	/**
	 * Wait (bounded) for a supervisor to self-register: re-check the predicate
	 * on every `registered` event emitted by the bus, resolving null when the
	 * window elapses. Without an injected bus (direct construction in unit
	 * tests) the predicate is checked once and returned.
	 */
	private async awaitRegistration<T>(predicate: () => T | null, timeoutMs: number): Promise<T | null> {
		if (this.supervisorEvents === undefined || timeoutMs <= 0) return predicate();
		const initial = predicate();
		if (initial !== null) return initial;
		const deadline = Date.now() + timeoutMs;
		const events = this.supervisorEvents; // narrowed (guarded above)
		return await new Promise<T | null>((resolve) => {
			let subscription: Subscription | undefined;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const cleanup = (): void => {
				if (timer !== undefined) clearTimeout(timer);
				subscription?.unsubscribe();
			};
			const recheck = (): void => {
				const found = predicate();
				if (found !== null) {
					cleanup();
					resolve(found);
				}
			};
			timer = setTimeout(() => {
				cleanup();
				resolve(null);
			}, Math.max(0, deadline - Date.now()));
			subscription = events.events$
				.pipe(filter((event) => event.type === "registered"))
				.subscribe({ next: recheck });
			// Race guard: a supervisor may have registered between the initial
			// check above and subscribing to the stream.
			recheck();
		});
	}

	/**
	 * Converge all supervisors whose deps are ready, in parallel, isolating
	 * failures per supervisor. DEP-gated supervisors (deps not loaded yet —
	 * e.g. global-db before the DB URL exists) are skipped here and converged
	 /**
	 * Converge all registered supervisors in parallel, isolating failures per
	 * supervisor. Only REGISTERED supervisors run — registration is entirely
	 * the supervisor's own decision (its `onModuleInit` registers when IT is
	 * ready; a dep-gated supervisor simply registers later).
	 */
	async ensureAll(): Promise<Map<string, SupervisorState>> {
		const entries = this.list();
		const results = await Promise.all(
			entries.map(async (supervisor): Promise<[string, SupervisorState]> => {
				const state = await supervisor.ensureDesiredState();
				return [supervisor.supervisorId, state];
			}),
		);
		return new Map(results);
	}

	/** Converge one supervisor by id on demand (e.g. "retry now" from the dev pages). */
	async convergeNow(supervisorId: string): Promise<SupervisorState | null> {
		const supervisor = this.supervisors.get(supervisorId);
		if (supervisor === undefined) return null;
		return await supervisor.ensureDesiredState();
	}

	/**
	 * The supervisors that are currently DEGRADED (resource down). The app
	 * NEVER stops because of a degraded supervisor — failures are surfaced
	 * through health + events so the web app can act on them (e.g. the
	 * ingress-port warning banner).
	 */
	degraded(): AnySupervisor[] {
		return this.list().filter((s) => s.getStateSnapshot().state === "degraded");
	}

	/**
	 * Aggregate health of every registered supervisor, in parallel. Every
	 * entry's payload is validated against its own supervisor's Zod schema
	 * (inside `getHealth`), and each snapshot is published to the supervisor
	 * event bus (`health-snapshot`) so subscribers observe live state.
	 */
	async getHealthOfAll(): Promise<SupervisorHealthSnapshot<z.ZodType>[]> {
		return await Promise.all(this.list().map((supervisor) => supervisor.getHealthAndNotify()));
	}

	onApplicationBootstrap(): void {
		if (process.env.NODE_ENV === "test") return;
		if (this.supervisors.size === 0) return;

		void this.ensureAll().then((results) => {
			for (const [id, state] of results) {
				const supervisor = this.supervisors.get(id);
				if (state === "degraded") {
					this.logger.warn(`⚠️ Supervisor "${id}" DEGRADED after boot convergence: ${supervisor?.getStateSnapshot().detail ?? "unknown"}`);
				} else if (state === "pending") {
					// Not a failure: the precondition does not exist yet (e.g. a
					// swarm-only service before setup created the cluster). Normal
					// INFO, never a warning — the recovery is `recoverPending()`
					// once setup converges the engine.
					this.logger.log(`⏳ Supervisor "${id}" deferred (pending): ${supervisor?.getStateSnapshot().detail ?? "awaiting prerequisite"}`);
				} else {
					this.logger.log(`✅ Supervisor "${id}" ${state}`);
				}
			}
			// NOTE: a degraded supervisor NEVER stops the application. It is
			// surfaced through health snapshots + `health-snapshot` events so
			// the web app can warn the operator and guide remediation.
			this.scheduleDegradedRetry();
			this.scheduleReconcileSweep();
		});
	}

	onModuleDestroy(): void {
		this.disposed = true;
		if (this.retryTimer !== null) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
		if (this.sweepTimer !== null) {
			clearTimeout(this.sweepTimer);
			this.sweepTimer = null;
		}
	}

	/**
	 * Re-run EVERY supervisor on a slow cadence, so drift is corrected.
	 *
	 * ── WHY `converged` IS NOT THE SAME AS "NOTHING TO DO" ────────────────────
	 * The degraded-retry loop above only re-attempts supervisors that REPORTED a
	 * failure. That leaves a real gap: a supervisor whose resource disappears
	 * WITHOUT it being notified keeps reporting `converged` forever, because its
	 * last convergence genuinely succeeded — the world changed afterwards.
	 *
	 * Observed directly while verifying this platform:
	 *
	 *   docker service rm deployer-managed-web      # out-of-band removal
	 *   ... supervisor state stayed `converged`, the service was NEVER recreated
	 *   ... zero retry log lines, because nothing was `degraded`
	 *
	 * The same applies to anything that deletes a supervised resource behind the
	 * platform's back, and to a node that loses one to an engine restart. The
	 * supervisor cannot be expected to detect that on its own — `reconcile()` is
	 * documented as idempotent precisely so it CAN be re-run.
	 *
	 * Chained timeouts, so a slow sweep cannot stack passes. The cadence is
	 * deliberately slow (a minute): this is drift correction, not liveness, and
	 * `reconcile()` on an already-correct resource is a cheap no-op.
	 */
	private scheduleReconcileSweep(): void {
		if (this.disposed || this.sweepTimer !== null) return;

		this.sweepTimer = setTimeout(() => {
			this.sweepTimer = null;
			void this.ensureAll()
				.catch((error: unknown) => {
					this.logger.warn(
						`Reconcile sweep failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				})
				.finally(() => {
					this.scheduleReconcileSweep();
				});
		}, SupervisorOrchestratorService.RECONCILE_SWEEP_INTERVAL_MS);
	}

	/**
	 * Keep re-attempting degraded supervisors until none are left.
	 *
	 * Chained timeouts rather than `setInterval`, so a slow convergence can never
	 * stack passes — the same pattern the swarm app-wiring supervisor uses. Stops
	 * scheduling once nothing is degraded, and restarts whenever a NEW degradation
	 * appears, so a later failure is retried too rather than only boot-time ones.
	 */
	private scheduleDegradedRetry(): void {
		if (this.disposed || this.retryTimer !== null) return;

		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			void this.retryDegraded()
				.catch((error: unknown) => {
					this.logger.warn(
						`Degraded-supervisor retry failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				})
				.finally(() => {
					this.scheduleDegradedRetry();
				});
		}, SupervisorOrchestratorService.DEGRADED_RETRY_INTERVAL_MS);
	}

	/**
	 * One retry pass over the degraded supervisors. Returns the ids that recovered.
	 *
	 * Fault-isolated per supervisor: one that fails again must not stop the others
	 * from being retried in the same pass.
	 */
	private async retryDegraded(): Promise<string[]> {
		const degraded = this.degraded();
		if (degraded.length === 0) return [];

		const recovered: string[] = [];
		await Promise.all(
			degraded.map(async (supervisor) => {
				try {
					const state = await supervisor.ensureDesiredState();
					if (state === "converged") {
						recovered.push(supervisor.supervisorId);
						this.logger.log(`✅ Supervisor "${supervisor.supervisorId}" recovered on retry`);
					}
				} catch (error: unknown) {
					this.logger.warn(
						`Retry for "${supervisor.supervisorId}" threw: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}),
		);
		return recovered;
	}
}
