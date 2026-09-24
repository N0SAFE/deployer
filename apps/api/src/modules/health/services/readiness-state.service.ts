import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import {
	BehaviorSubject,
	Observable,
	Subject,
	debounceTime,
	merge,
	type Subscription,
} from "rxjs";
import z from "zod/v4";

import { AppLifecyclePhase, AppLifecycleService } from "@repo/nest-lifecycle";

import { SupervisorOrchestratorService } from "@repo/nest-supervisor-core/supervisor-orchestrator.service";
import { SupervisorEventBus } from "@repo/nest-supervisor-core/supervisor-event.bus";
import type { SupervisorHealthSnapshot } from "@repo/nest-supervisor-core/base-supervisor.service";

/** The cached platform readiness picture. */
export interface ReadinessSnapshot {
	/** Current lifecycle phase, straight from the lifecycle core service. */
	lifecyclePhase: AppLifecyclePhase;
	/** `databaseReachable` metadata the lifecycle already carries, or null if never set. */
	databaseReachable: boolean | null;
	/** `meshConnected` metadata the lifecycle already carries, or null if never set. */
	meshConnected: boolean | null;
	/** Latest supervisor snapshots, refreshed on their own events. */
	supervisors: SupervisorHealthSnapshot<z.ZodType>[];
	/** When this snapshot was last rebuilt. */
	checkedAt: string;
}

/**
 * ReadinessStateService — the EVENT-DRIVEN readiness cache.
 *
 * WHY THIS EXISTS
 * A readiness probe is polled (compose every 15s, forever). Doing the work per
 * request meant every poll ran a `SELECT 1`, a `docker swarm inspect`, a full
 * probe of EVERY supervisor (each doing its own HTTP / `SELECT 1` / task-state
 * call) and a mesh query — to answer a question whose answer had already been
 * published as events.
 *
 * So the I/O moved here and happens on CHANGE, not on request:
 *   - `AppLifecycleService.events`   → phase, databaseReachable, meshConnected
 *   - `SupervisorEventBus.events$`   → state-changed / reconciled / health-snapshot
 *
 * The HTTP probe is now a pure read of `snapshot()` — O(1), no I/O, no timers
 * on the request path.
 *
 * TWO DRIVERS, deliberately:
 *   1. EVENTS (primary) — a supervisor that changes state republishes its
 *      health immediately, so the probe reflects reality within milliseconds.
 *   2. A slow SAFETY-NET cadence — a resource can degrade without its
 *      supervisor changing state (a redis that dies while `converged`). Events
 *      alone cannot see that, so a chained timer re-probes. Chained (not
 *      `setInterval`) so a slow probe can never stack passes, matching the
 *      pattern already used by `SwarmAppWiringSupervisorService`.
 *
 * `refresh()` is public so callers that KNOW something changed (setup
 * completing, an operator hitting "retry") can force an immediate rebuild
 * instead of waiting for the cadence.
 */
@Injectable()
export class ReadinessStateService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(ReadinessStateService.name);

	/** Safety-net re-probe cadence. Slow: this is drift detection, not polling. */
	private static readonly REFRESH_INTERVAL_MS = 15_000;

	/**
	 * Event bursts are collapsed: converging five supervisors emits a dozen
	 * events within milliseconds, and rebuilding the snapshot per event would
	 * probe the same resources repeatedly.
	 */
	private static readonly REFRESH_DEBOUNCE_MS = 250;

	private readonly state$: BehaviorSubject<ReadinessSnapshot>;

	/** Explicit refresh requests (events + callers), debounced into one rebuild. */
	private readonly refreshRequests = new Subject<void>();
	private readonly subscriptions: Subscription[] = [];
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;

	constructor(
		private readonly lifecycle: AppLifecycleService,
		private readonly orchestrator: SupervisorOrchestratorService,
		private readonly eventBus: SupervisorEventBus,
	) {
		const phase = this.lifecycle.getSnapshot();
		this.state$ = new BehaviorSubject<ReadinessSnapshot>({
			lifecyclePhase: phase.phase,
			databaseReachable: (phase.metadata?.databaseReachable as boolean | undefined) ?? null,
			meshConnected: (phase.metadata?.meshConnected as boolean | undefined) ?? null,
			supervisors: [],
			checkedAt: new Date().toISOString(),
		});
	}

	onModuleInit(): void {
		// ── Driver 1: lifecycle transitions ──────────────────────────────────
		// The lifecycle service already knows when the DB is reachable and when
		// the mesh connected, so these are read, never re-probed here.
		this.subscriptions.push(
			this.lifecycle.events.subscribe((event) => {
				const metadata = event.metadata ?? {};
				const next = this.state$.value;
				this.state$.next({
					...next,
					lifecyclePhase: event.phase,
					databaseReachable: this.resolveFlag("databaseReachable", metadata, next.databaseReachable),
					meshConnected: this.resolveFlag("meshConnected", metadata, next.meshConnected),
					checkedAt: new Date().toISOString(),
				});
				// A phase change can mean a new dependency appeared (setup
				// completed, migrations ran) — re-probe so readiness tracks it.
				this.requestRefresh();
			}),
		);

		// ── Driver 2: supervisor events ─────────────────────────────────────
		// Any state transition or published health snapshot invalidates the
		// cached supervisor list. Filtered to the three types that can change
		// health, so `registered`/`removed` noise does not trigger probes.
		this.subscriptions.push(
			merge(
				this.eventBus.of({ type: "state-changed" }),
				this.eventBus.of({ type: "reconciled" }),
				this.eventBus.of({ type: "health-snapshot" }),
			).subscribe(() => {
				this.requestRefresh();
			}),
		);

		// ── Debounce + safety-net cadence ────────────────────────────────────
		this.subscriptions.push(
			this.refreshRequests.pipe(debounceTime(ReadinessStateService.REFRESH_DEBOUNCE_MS)).subscribe(() => {
				void this.refresh();
			}),
		);
		this.scheduleRefresh();

		// Seed the cache so the first probe after boot is not empty.
		this.requestRefresh();
	}

	onModuleDestroy(): void {
		this.disposed = true;
		if (this.refreshTimer !== null) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		for (const subscription of this.subscriptions) subscription.unsubscribe();
		this.subscriptions.length = 0;
		this.state$.complete();
	}

	/** Observable of every readiness change. Replays the current value to new subscribers. */
	get snapshot$(): Observable<ReadinessSnapshot> {
		return this.state$.asObservable();
	}

	/**
	 * Current readiness, from cache. NO I/O — this is what the HTTP probe calls,
	 * so a polled endpoint costs nothing.
	 */
	snapshot(): ReadinessSnapshot {
		return this.state$.value;
	}

	/**
	 * Rebuild the snapshot by probing the platform, then publish it.
	 *
	 * Every probe is individually fault-isolated: one unreachable dependency
	 * must not blank the whole picture, because the failing component is what
	 * the operator needs to see.
	 */
	async refresh(): Promise<ReadinessSnapshot> {
		const previous = this.state$.value;
		const supervisors = await this.orchestrator.getHealthOfAll().catch((error: unknown) => {
			this.logger.warn(
				`Supervisor health aggregation failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return previous.supervisors;
		});

		const next: ReadinessSnapshot = {
			lifecyclePhase: this.lifecycle.phase,
			databaseReachable: this.readLifecycleFlag("databaseReachable", previous.databaseReachable),
			meshConnected: this.readLifecycleFlag("meshConnected", previous.meshConnected),
			supervisors,
			checkedAt: new Date().toISOString(),
		};

		this.state$.next(next);
		return next;
	}

	/** Request a debounced rebuild (coalesces event bursts into one probe pass). */
	requestRefresh(): void {
		if (this.disposed) return;
		this.refreshRequests.next();
	}

	/**
	 * Read a boolean flag the lifecycle service carries in its metadata.
	 * Falls back to the previous value when the lifecycle never set it (e.g. a
	 * node with no database configured at all).
	 */
	private readLifecycleFlag(key: "databaseReachable" | "meshConnected", fallback: boolean | null): boolean | null {
		const value = this.lifecycle.getSnapshot().metadata?.[key];
		return typeof value === "boolean" ? value : fallback;
	}

	/**
	 * Resolve a flag for an incoming event.
	 *
	 * The event payload is checked first (it is the freshest signal), but the
	 * lifecycle's CURRENT snapshot wins when the payload omits the key: the
	 * service accumulates metadata, so a later transition that says nothing
	 * about the mesh must not erase a value that is still true.
	 */
	private resolveFlag(
		key: "databaseReachable" | "meshConnected",
		eventMetadata: Record<string, unknown>,
		fallback: boolean | null,
	): boolean | null {
		if (typeof eventMetadata[key] === "boolean") return eventMetadata[key] as boolean;
		return this.readLifecycleFlag(key, fallback);
	}

	/** Chained timer: the next pass is scheduled only after this one settles. */
	private scheduleRefresh(): void {
		if (this.disposed) return;
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			void this.refresh()
				.catch((error: unknown) => {
					this.logger.warn(
						`Readiness refresh failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				})
				.finally(() => {
					this.scheduleRefresh();
				});
		}, ReadinessStateService.REFRESH_INTERVAL_MS);
	}
}
