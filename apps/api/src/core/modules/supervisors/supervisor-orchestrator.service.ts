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

import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
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
export class SupervisorOrchestratorService implements OnApplicationBootstrap {
	/**
	 * Event bus driving the registration wait of `getSupervisor`. Supervisors
	 * emit `registered` from their own onModuleInit — the async accessor
	 * re-checks the registry on every such event until its timeout.
	 */
	@Inject(SupervisorEventBus)
	protected readonly supervisorEvents: SupervisorEventBus | undefined;

	private readonly logger = new Logger(SupervisorOrchestratorService.name);
	private readonly supervisors: Map<string, AnySupervisor>;

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
			if (supervisor instanceof supervisorClass) return supervisor as T;
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
				if (state === "degraded") {
					const supervisor = this.supervisors.get(id);
					this.logger.warn(`⚠️ Supervisor "${id}" DEGRADED after boot convergence: ${supervisor?.getStateSnapshot().detail ?? "unknown"}`);
				} else {
					this.logger.log(`✅ Supervisor "${id}" ${state}`);
				}
			}
			// NOTE: a degraded supervisor NEVER stops the application. It is
			// surfaced through health snapshots + `health-snapshot` events so
			// the web app can warn the operator and guide remediation.
		});
	}
}
