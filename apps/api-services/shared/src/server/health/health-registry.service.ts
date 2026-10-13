import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import type { HealthIndicatorResult, HealthIndicatorStatus } from "@nestjs/terminus";
import {
	BehaviorSubject,
	Observable,
	Subject,
	distinctUntilChanged,
	filter,
	from,
	lastValueFrom,
	map,
	mergeMap,
	scan,
	shareReplay,
	startWith,
	toArray,
} from "rxjs";

import type { IndicatorSnapshot, HealthSnapshot } from "./types";

/**
 * Injection token for the indicator entries a module's `forRoot` built.
 *
 * A token rather than the registry reading a static list: the entries are
 * constructed from the app's named indicator set, so the registry cannot run a
 * check the app did not ask for.
 */
export const HEALTH_INDICATORS = Symbol("api-server:health-indicators");

/**
 * One named check the registry can run.
 *
 * `name` matches the key Terminus uses, so the stream and the HTTP payload agree
 * without translation.
 */
export interface HealthIndicatorEntry {
	readonly name: string;
	/**
	 * Run the check.
	 *
	 * Returns a Terminus result — the shape a client and the Terminus UI already
	 * understand — so nothing downstream needs a translator.
	 */
	run(): Promise<HealthIndicatorResult>;
	/**
	 * Told to the registry so a caller can render the check list before running it.
	 * Purely informational — never used for control flow.
	 */
	readonly description?: string;
}

/**
 * Runs the platform's health indicators and streams their results.
 *
 * ── WHY rxjs AND NOT A POLLING FUNCTION ─────────────────────────────────────
 * A readiness endpoint answers one question at one instant. The questions an
 * OPERATOR has are about CHANGE: "is it still up?", "when did the database go
 * down?", "has it recovered?". Those are streams, and building them from a
 * polling function means every consumer re-derives the transitions themselves —
 * which is how two components end up disagreeing about whether a service is
 * healthy.
 *
 * So the registry OWNS the stream:
 *
 *   - `results$`   — one emission per completed full pass
 *   - `changes$`   — only when a snapshot differs from the previous one
 *     (`distinctUntilChanged` by a stable signature), so a subscriber is told
 *     about TRANSITIONS rather than being woken every interval
 *   - `indicator$` — just one indicator's results across passes
 *
 * ── WHY CHECKS RUN IN PARALLEL, WITH A PER-CHECK TIMEOUT ────────────────────
 * Indicators are independent, so a slow disk check must not delay the database
 * verdict. `mergeMap` runs them concurrently, and each carries its own timeout
 * so one hung dependency cannot stall a pass — the hung check fails, the others
 * still report.
 *
 * ── WHY THE LAST SNAPSHOT IS CACHED ─────────────────────────────────────────
 * `/health/ready` is polled forever (compose every 15s). Running the I/O per
 * request is the mistake the platform already made once and documented (see the
 * monolith's `ReadinessStateService`). The endpoint reads the cached snapshot;
 * a background cadence refreshes it. The cache is `BehaviorSubject`, so a late
 * subscriber gets the current value immediately instead of waiting for the next
 * pass.
 */
@Injectable()
export class HealthRegistry implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(HealthRegistry.name);

	/** Safety-net refresh cadence. Slow on purpose: this is drift detection. */
	private static readonly REFRESH_INTERVAL_MS = 15_000;

	/** Bounds one check, so a hung dependency cannot stall a pass. */
	private static readonly INDICATOR_TIMEOUT_MS = 5_000;

	/** The latest completed pass. `null` until the first one finishes. */
	private readonly snapshot$ = new BehaviorSubject<HealthSnapshot | null>(null);

	/** Explicit "check now" requests from callers or the cadence timer. */
	private readonly refreshRequests = new Subject<void>();

	/** Per-indicator result streams, so a consumer can watch ONE dependency. */
	private readonly indicatorResults$ = new Subject<IndicatorSnapshot>();

	private timer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;

	/** Registered entries, by name, in declaration order. */
	private readonly entryByName = new Map<string, HealthIndicatorEntry>();

	constructor(@Inject(HEALTH_INDICATORS) entries: readonly HealthIndicatorEntry[]) {
		for (const entry of entries) {
			if (this.entryByName.has(entry.name)) {
				throw new Error(`health indicator "${entry.name}" is registered twice`);
			}
			this.entryByName.set(entry.name, entry);
		}
	}

	/**
	 * Snapshots, replayed.
	 *
	 * `shareReplay(1)` so the first subscriber triggers the work and every later
	 * one receives the latest value instantly — without it, a second subscriber
	 * would start a second cadence.
	 */
	readonly snapshots$: Observable<HealthSnapshot> = this.snapshot$.pipe(
		filter((snapshot): snapshot is HealthSnapshot => snapshot !== null),
		shareReplay({ bufferSize: 1, refCount: false }),
	);

	/**
	 * Only the TRANSITIONS.
	 *
	 * A subscriber that wants to log, alert, or invalidate a cache cares about
	 * `up → down`, not about every 15-second confirmation. The signature is a
	 * stable string of `name:status` pairs, so an unchanged health picture emits
	 * nothing — and a change in ANY indicator emits once.
	 */
	readonly changes$: Observable<HealthSnapshot> = this.snapshots$.pipe(
		distinctUntilChanged((previous, next) => signatureOf(previous) === signatureOf(next)),
	);

	/** One indicator's verdicts across passes. */
	indicator$(name: string): Observable<IndicatorSnapshot> {
		return this.indicatorResults$.pipe(filter((snapshot) => snapshot.name === name));
	}

	/** Register a check at runtime. `forRoot` pre-registers; this is for tests. */
	register(entry: HealthIndicatorEntry): void {
		if (this.entryByName.has(entry.name)) {
			throw new Error(`health indicator "${entry.name}" is already registered`);
		}
		this.entryByName.set(entry.name, entry);
	}

	/** The registered indicator names, in registration order. */
	get indicatorNames(): readonly string[] {
		return [...this.entryByName.keys()];
	}

	/** The latest snapshot, or `null` before the first pass completes. */
	current(): HealthSnapshot | null {
		return this.snapshot$.value;
	}

	/**
	 * The latest snapshot, running a pass first if none has completed.
	 *
	 * Awaited by `/health/ready` at boot so the endpoint never reports "not ready"
	 * merely because the background cadence has not ticked yet.
	 */
	async currentOrRun(): Promise<HealthSnapshot> {
		const existing = this.snapshot$.value;
		if (existing !== null) return existing;
		return this.runOnce();
	}

	/** Ask for a pass now (debounced through the refresh subject). */
	requestRefresh(): void {
		if (!this.disposed) this.refreshRequests.next();
	}

	/** `OnModuleInit`: start the drift-detection cadence. */
	onModuleInit(): void {
		this.scheduleNext();
	}

	/** `OnModuleDestroy`: stop the cadence and close the streams. */
	onModuleDestroy(): void {
		this.stop();
	}

	stop(): void {
		this.disposed = true;
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
		this.snapshot$.complete();
		this.indicatorResults$.complete();
		this.refreshRequests.complete();
	}

	/**
	 * Run every indicator once and publish the result.
	 *
	 * Public so a boot check and a test can drive it directly rather than waiting
	 * for the cadence.
	 */
	async runOnce(): Promise<HealthSnapshot> {
		const started = Date.now();
		const entries = [...this.entryByName.values()];

		// Parallel: indicators are independent, and a slow disk check must not delay
		// the database verdict. `toArray` preserves DECLARATION order regardless of
		// completion order, so the payload is stable between passes.
		const results = await lastValueFrom(
			from(entries).pipe(
				mergeMap((entry) =>
					from(
						Promise.race([
							// A check that THROWS is a failed check, not a failed pass: the
							// registry exists to report, and a pass that dies reports nothing.
							// `catch` here is what keeps one broken indicator from hiding every
							// other dependency's verdict.
							entry.run().catch((error: unknown) => ({
								[entry.name]: {
									status: "down" as const,
									message: error instanceof Error ? error.message : String(error),
								},
							})),
							timeoutAfter(HealthRegistry.INDICATOR_TIMEOUT_MS, entry.name),
						]),
					).pipe(map((result) => ({ entry, result }))),
				),
				toArray(),
			),
			{ defaultValue: [] },
		);

		const indicators: IndicatorSnapshot[] = [];
		const info: HealthSnapshot["info"] = {};
		const error: HealthSnapshot["error"] = {};

		for (const { entry, result } of results ?? []) {
			const value = result[entry.name] ?? { status: "down" as const };
			const snapshot = toIndicatorSnapshot(entry.name, value);
			indicators.push(snapshot);
			this.indicatorResults$.next(snapshot);

			if (value.status === "up") {
				info[entry.name] = { ...value, status: "up" };
			} else {
				error[entry.name] = { ...value, status: "down" };
			}
		}

		// `down` when ANY indicator is down. The caller decides which indicators
		// are REQUIRED by declaring them at all — so this stays policy-free.
		const snapshot: HealthSnapshot = {
			status: indicators.every((indicator) => indicator.status === "up") ? "up" : "down",
			info,
			error,
			details: Object.fromEntries(
				indicators.map((indicator) => [
					indicator.name,
					{
						status: indicator.status,
						...(indicator.message === undefined ? {} : { message: indicator.message }),
						...(indicator.detail ?? {}),
					},
				]),
			),
			indicators,
			checkedAt: new Date().toISOString(),
			durationMs: Date.now() - started,
		};

		this.snapshot$.next(snapshot);
		this.logger.debug(
			`health pass: ${snapshot.status} (${String(snapshot.durationMs)}ms, ${String(indicators.length)} indicators)`,
		);
		return snapshot;
	}

	/**
	 * The cadence, chained rather than `setInterval`.
	 *
	 * Chained so a slow pass can never stack on top of the next one — the same
	 * correction the monolith's readiness service documents, and the reason a
	 * container under load does not accumulate probes.
	 */
	private scheduleNext(): void {
		if (this.disposed) return;
		this.timer = setTimeout(() => {
			void this.runOnce()
				.catch((error: unknown) => {
					// A failed PASS (not a failed indicator) must not kill the cadence;
					// otherwise one bad refresh stops health reporting forever.
					this.logger.warn(`health pass failed: ${error instanceof Error ? error.message : String(error)}`);
				})
				.finally(() => {
					this.scheduleNext();
				});
		}, HealthRegistry.REFRESH_INTERVAL_MS);
	}

	/**
	 * Drive passes from a stream of requests.
	 *
	 * Exposed so a caller with a real trigger — a lifecycle transition, a
	 * supervisor event — can push instead of waiting for the cadence.
	 */
	pushRefreshRequests(source: Observable<unknown>): void {
		source.pipe(startWith(null)).subscribe(() => {
			this.requestRefresh();
		});
	}

	/** Emit only when a full pass has been requested, collapsing bursts. */
	refreshStream(): Observable<void> {
		return this.refreshRequests.pipe(scan((count) => count + 1, 0), map(() => undefined));
	}
}

/** A stable identity for a snapshot, for change detection. */
function signatureOf(snapshot: HealthSnapshot): string {
	return snapshot.indicators.map((indicator) => `${indicator.name}:${indicator.status}`).join("|");
}

/** Flatten one Terminus result into the stream's shape. */
function toIndicatorSnapshot(
	name: string,
	value: { status: HealthIndicatorStatus; [key: string]: unknown },
): IndicatorSnapshot {
	const { status, message, reason, latencyMs, ...rest } = value;
	const numericLatency = typeof latencyMs === "number" ? latencyMs : 0;

	// Everything that is not status/message/reason/latency is the check's own
	// detail (version, counts, ratios). Passing it through is what makes the
	// stream as informative as the HTTP payload instead of a bare up/down.
	const detail = Object.fromEntries(Object.entries(rest).filter(([key]) => key !== "status"));

	return {
		name,
		// Terminus may also report `degraded`; the registry only distinguishes
		// "serving" from "not", so anything that is not `up` is `down` here. The
		// original status is preserved in `detail` for a consumer that cares.
		status: status === "up" ? "up" : "down",
		latencyMs: numericLatency,
		...(typeof message === "string" ? { message } : {}),
		...(typeof reason === "string" ? { reason } : {}),
		...(Object.keys(detail).length === 0 ? {} : { detail }),
	};
}

/** Resolve to a `down` result after `ms` instead of hanging the pass. */
async function timeoutAfter(
	ms: number,
	name: string,
): Promise<Record<string, { status: "down"; message: string }>> {
	return new Promise((resolve) => {
		setTimeout(() => {
			resolve({ [name]: { status: "down", message: `check did not finish within ${String(ms)}ms` } });
		}, ms);
	});
}
