import { Context, Duration, Effect, Cause } from "effect";
import {
	BehaviorSubject,
	Observable,
	Subject,
	distinctUntilChanged,
	filter,
	map,
	scan,
	shareReplay,
	startWith,
} from "rxjs";

import { indicatorFor } from "./indicators/indicator-result";

import type { HealthSnapshot, IndicatorResult, IndicatorSnapshot } from "./types";

/**
 * One named check the registry can run.
 *
 * `name` matches the key the result uses, so the stream and the HTTP payload agree
 * without translation. `run` is an Effect that never fails: a dependency that is down is a `down` result, which is the
 * diagnosis the caller came for.
 */
export type HealthIndicatorEntry = {
	readonly name: string;
	/**
	 * Run the check.
	 *
	 * Returns a result the client already understands (`{ <name>: { status, …detail } }`) so nothing downstream needs a
	 * translator.
	 */
	run(): Effect.Effect<IndicatorResult>;
	/**
	 * Told to the registry so a caller can render the check list before running it.
	 * Purely informational — never used for control flow.
	 */
	readonly description?: string;
};

export type HealthRegistryShape = {
	/** One emission per completed pass, replayed to a late subscriber. */
	readonly snapshots$: Observable<HealthSnapshot>;
	/** Only the transitions, by a stable signature of `name:status` pairs. */
	readonly changes$: Observable<HealthSnapshot>;
	/** One indicator's verdicts across passes. */
	readonly indicator$: (name: string) => Observable<IndicatorSnapshot>;
	/** Registered names, in registration order. */
	readonly indicatorNames: readonly string[];
	/** Register a check at runtime. `forRoot` pre-registers; this is for tests. */
	readonly register: (entry: HealthIndicatorEntry) => Effect.Effect<void, Error>;
	/** The latest snapshot, or `null` before the first pass completes. */
	readonly current: () => Effect.Effect<HealthSnapshot | null>;
	/** The latest snapshot, running a pass first if none has completed. */
	readonly currentOrRun: () => Effect.Effect<HealthSnapshot>;
	/** Ask for a pass now (debounced through the refresh subject). */
	readonly requestRefresh: () => Effect.Effect<void>;
	/** Emit only when a full pass has been requested, collapsing bursts. */
	readonly refreshStream: () => Observable<void>;
	/** Run every indicator once and publish the result. */
	readonly runOnce: () => Effect.Effect<HealthSnapshot>;
	/** The drift-detection cadence. Never completes; `serviceLifecycle` forks it and interrupts it on stop. */
	readonly run: () => Effect.Effect<void>;
	/** Close the streams, so subscribers are released. Runs after `run` is interrupted. */
	readonly onStop: () => Effect.Effect<void>;
};

/**
 * Runs the platform's health indicators and streams their results.
 *
 * ── WHY A STREAM AND NOT A POLLING FUNCTION ─────────────────────────────────
 * A readiness endpoint answers one question at one instant. The questions an
 * OPERATOR has are about CHANGE: "is it still up?", "when did the database go
 * down?", "has it recovered?". Those are streams, and building them from a
 * polling function means every consumer re-derives the transitions themselves —
 * which is how two components end up disagreeing about whether a service is
 * healthy. RxJS stays the streaming surface; every command (`runOnce`, `current`,
 * `requestRefresh`, `start`, `stop`) is an Effect.
 *
 * ── WHY CHECKS RUN IN PARALLEL, WITH A PER-CHECK TIMEOUT ────────────────────
 * Indicators are independent, so a slow disk check must not delay the database
 * verdict. They run concurrently, each under its own timeout, so one hung
 * dependency cannot stall a pass — the hung check fails, the others still report.
 *
 * ── WHY THE LAST SNAPSHOT IS CACHED ─────────────────────────────────────────
 * `/health/ready` is polled forever (compose every 15s). Running the I/O per
 * request is the mistake the platform already made once. The endpoint reads the
 * cached snapshot; a background cadence refreshes it. The cache is a
 * `BehaviorSubject`, so a late subscriber gets the current value immediately.
 */
export class HealthRegistry extends Context.Service<HealthRegistry, HealthRegistryShape>()(
	"shared/HealthRegistry",
) {
	/** Safety-net refresh cadence. Slow on purpose: this is drift detection. */
	static readonly REFRESH_INTERVAL_MS = 15_000;

	/** Bounds one check, so a hung dependency cannot stall a pass. */
	static readonly INDICATOR_TIMEOUT_MS = 5_000;

	/**
	 * The registry over the entries the app's indicator set produced.
	 *
	 * No constructor injection: the entries are the argument, so the module builds one registry per app and a spec
	 * builds one over fake checks (`new HealthRegistry.live([...])`).
	 */
	static readonly live = class HealthRegistryImpl implements HealthRegistryShape {
		/** The latest completed pass. `null` until the first one finishes. */
		private readonly snapshot$ = new BehaviorSubject<HealthSnapshot | null>(null);
		/** Explicit "check now" requests from callers or the cadence timer. */
		private readonly refreshRequests = new Subject<void>();
		/** Per-indicator result streams, so a consumer can watch ONE dependency. */
		private readonly indicatorResults$ = new Subject<IndicatorSnapshot>();
		/** Registered entries, by name, in declaration order. */
		private readonly entryByName = new Map<string, HealthIndicatorEntry>();
		private disposed = false;

		constructor(entries: readonly HealthIndicatorEntry[]) {
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
		 * `shareReplay(1)` so the first subscriber triggers the work and every later one receives the latest value
		 * instantly — without it, a second subscriber would start a second cadence.
		 */
		readonly snapshots$ = this.snapshot$.pipe(
			filter((snapshot): snapshot is HealthSnapshot => snapshot !== null),
			shareReplay({ bufferSize: 1, refCount: false }),
		);

		/**
		 * Only the TRANSITIONS.
		 *
		 * A subscriber that wants to log, alert, or invalidate a cache cares about `up → down`, not about every
		 * 15-second confirmation. The signature is a stable string of `name:status` pairs, so an unchanged health
		 * picture emits nothing — and a change in ANY indicator emits once.
		 */
		readonly changes$ = this.snapshots$.pipe(
			distinctUntilChanged((previous, next) => signatureOf(previous) === signatureOf(next)),
		);

		get indicatorNames(): readonly string[] {
			return [...this.entryByName.keys()];
		}

		indicator$(name: string): Observable<IndicatorSnapshot> {
			return this.indicatorResults$.pipe(filter((snapshot) => snapshot.name === name));
		}

		register(entry: HealthIndicatorEntry): Effect.Effect<void, Error> {
			const entries = this.entryByName;
			return Effect.try({
				try: () => {
					if (entries.has(entry.name)) {
						throw new Error(`health indicator "${entry.name}" is already registered`);
					}
					entries.set(entry.name, entry);
				},
				catch: (error) => (error instanceof Error ? error : new Error(String(error))),
			});
		}

		current(): Effect.Effect<HealthSnapshot | null> {
			return Effect.sync(() => this.snapshot$.value);
		}

		currentOrRun(): Effect.Effect<HealthSnapshot> {
			const existing = this.snapshot$.value;
			return existing !== null ? Effect.succeed(existing) : this.runOnce();
		}

		requestRefresh(): Effect.Effect<void> {
			const requests = this.refreshRequests;
			return Effect.sync(() => {
				if (!this.disposed) requests.next();
			});
		}

		refreshStream(): Observable<void> {
			return this.refreshRequests.pipe(
				scan((count) => count + 1, 0),
				map(() => undefined),
			);
		}

		runOnce(): Effect.Effect<HealthSnapshot> {
			const entries = [...this.entryByName.values()];
			const indicatorResults$ = this.indicatorResults$;
			const snapshot$ = this.snapshot$;

			const runEntry = (
				entry: HealthIndicatorEntry,
			): Effect.Effect<{ entry: HealthIndicatorEntry; result: IndicatorResult; measuredLatencyMs: number }> =>
				Effect.gen(function* () {
					const checked: Effect.Effect<IndicatorResult> = entry.run().pipe(
						Effect.timeoutOrElse({
							duration: HealthRegistry.INDICATOR_TIMEOUT_MS,
							orElse: () =>
								Effect.fail(
									new Error(`check did not finish within ${String(HealthRegistry.INDICATOR_TIMEOUT_MS)}ms`),
								),
						}),
						Effect.catchCause((cause): Effect.Effect<IndicatorResult> => {
							const error = Cause.squash(cause);
							return Effect.succeed(
								indicatorFor(entry.name).down({
									message: error instanceof Error ? error.message : String(error),
								}),
							);
						}),
					);
					const [duration, result] = yield* Effect.timed(checked);
					return { entry, result, measuredLatencyMs: Duration.toMillis(duration) };
				});

			return Effect.gen(function* () {
				const started = Date.now();

				// Parallel: indicators are independent, and a slow disk check must not delay the database verdict.
				// `Effect.forEach` preserves DECLARATION order regardless of completion order, so the payload is stable
				// between passes.
				//
				// A check that FAILS is a failed check, not a failed pass: the registry exists to report, and a pass that
				// dies reports nothing. That `catchAllCause` is what keeps one broken indicator from hiding every other
				// dependency's verdict.
				const results = yield* Effect.forEach(entries, runEntry, { concurrency: "unbounded" });

				const indicators: IndicatorSnapshot[] = [];
				const info: HealthSnapshot["info"] = {};
				const error: HealthSnapshot["error"] = {};

				for (const { entry, result, measuredLatencyMs } of results) {
					const value = result[entry.name] ?? { status: "down" as const };
					const snapshot = toIndicatorSnapshot(entry.name, value, measuredLatencyMs);
					indicators.push(snapshot);
					indicatorResults$.next(snapshot);

					if (value.status === "up") {
						info[entry.name] = { ...value, status: "up" };
					} else {
						error[entry.name] = { ...value, status: "down" };
					}
				}

				// `down` when ANY indicator is down. The caller decides which indicators are REQUIRED by declaring them at
				// all — so this stays policy-free.
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

				snapshot$.next(snapshot);
				yield* Effect.logDebug(
					`health pass: ${snapshot.status} (${String(snapshot.durationMs)}ms, ${String(indicators.length)} indicators)`,
				);
				return snapshot;
			});
		}

		/**
		 * The cadence, chained rather than a fixed interval.
		 *
		 * Chained so a slow pass can never stack on top of the next one — the same correction the monolith's readiness
		 * service documented, and the reason a container under load does not accumulate probes.
		 *
		 * Never completes: `serviceLifecycle(HealthRegistry)` forks it through `EffectHost` and interrupts it on shutdown.
		 */
		run(): Effect.Effect<void> {
			const runOnce = (): Effect.Effect<HealthSnapshot> => this.runOnce();
			/** One cadence tick: sleep, then a pass that cannot kill the loop. */
			const tick = (): Effect.Effect<void> =>
				Effect.gen(function* () {
					yield* Effect.sleep(HealthRegistry.REFRESH_INTERVAL_MS);
					// A failed PASS (not a failed indicator) must not kill the cadence; otherwise one bad refresh stops
					// health reporting forever.
					yield* runOnce().pipe(
						Effect.catchCause((cause): Effect.Effect<void> =>
							Effect.logWarning(`health pass failed: ${Cause.pretty(cause)}`),
						),
					);
				});

			return Effect.gen(function* () {
				while (true) {
					yield* tick();
				}
			});
		}

		onStop(): Effect.Effect<void> {
			return Effect.sync(() => {
				this.disposed = true;
				this.snapshot$.complete();
				this.indicatorResults$.complete();
				this.refreshRequests.complete();
			});
		}
	};
}

/** A stable identity for a snapshot, for change detection. */
function signatureOf(snapshot: HealthSnapshot): string {
	return snapshot.indicators.map((indicator) => `${indicator.name}:${indicator.status}`).join("|");
}

/**
 * Flatten one result into the stream's shape.
 *
 * `latencyMs` is lifted from the check's own detail when it measured itself, and falls back to the registry's own
 * measurement — a check that does not time itself still reports how long it took.
 */
function toIndicatorSnapshot(
	name: string,
	value: { status: "up" | "down"; [key: string]: unknown },
	measuredLatencyMs: number,
): IndicatorSnapshot {
	const { status, message, reason, latencyMs, ...rest } = value;
	const numericLatency = typeof latencyMs === "number" ? latencyMs : measuredLatencyMs;

	// Everything that is not status/message/reason/latency is the check's own
	// detail (version, counts, ratios). Passing it through is what makes the
	// stream as informative as the HTTP payload instead of a bare up/down.
	const detail = Object.fromEntries(Object.entries(rest).filter(([key]) => key !== "status"));

	return {
		name,
		// A check may report `degraded`; the registry only distinguishes "serving" from "not", so anything that is not
		// `up` is `down` here. The original status is preserved in `detail` for a consumer that cares.
		status: status === "up" ? "up" : "down",
		latencyMs: numericLatency,
		...(typeof message === "string" ? { message } : {}),
		...(typeof reason === "string" ? { reason } : {}),
		...(Object.keys(detail).length === 0 ? {} : { detail }),
	};
}

/** Re-exported so an entry can be written without knowing where the builder lives. */
export { indicatorFor };
