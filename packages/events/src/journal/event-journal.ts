import { Effect, Fiber } from "effect";

import { isTransientDatabaseError } from "../storage/transient-database-error";

import type {
	BufferedEventRecord,
	EventLogStoreShape,
	JournalLogger,
	PersistedEventLog,
	ReplayQuery,
} from "./records";

/** Tunables; read on every use so a host (or a test) can change them while the journal runs. */
export type JournalSettings = {
	/** How many records each replay buffer keeps. */
	readonly replayLimit: number;
	/** A queue this long triggers a flush right away. */
	readonly flushBatchSize: number;
	/** The safety-net flush cadence. */
	readonly flushIntervalMs: number;
	readonly retryBaseMs: number;
	readonly retryMaxMs: number;
	/** Hard cap on the persistence queue; the oldest entries are dropped past it. */
	readonly maxPending: number;
};

export const defaultJournalSettings: JournalSettings = {
	replayLimit: 2_000,
	flushBatchSize: 200,
	flushIntervalMs: 3 * 60 * 1000,
	retryBaseMs: 500,
	retryMaxMs: 60_000,
	maxPending: 10_000,
};

export type JournalConfig = {
	readonly namespace: string;
	/** The event log, when one is configured: it can be set after the journal exists. */
	readonly store: () => EventLogStoreShape | null;
	readonly logger: JournalLogger;
	readonly settings?: () => JournalSettings;
};

/**
 * One namespace's durable event journal: per-key sequence numbers, bounded replay buffers, and a
 * persistence queue that survives the event log being down.
 *
 * Persistence is best-effort audit storage. When the table is not ready yet (first-boot migrations)
 * or the database is unreachable, a flush never drops the batch: it stays queued and is retried with
 * backoff. The in-memory buffers keep every subscriber working whatever the log's state.
 */
export type EventJournalShape = {
	/**
	 * Assigns the next sequence for `eventKey`, buffers the record for replay and queues it for
	 * persistence (flushing at once when a batch is full). Synchronous: emitters call it inline.
	 */
	readonly record: (entry: {
		readonly eventName: string;
		readonly eventKey: string;
		readonly input: Record<string, unknown>;
		readonly output: Record<string, unknown>;
	}) => BufferedEventRecord;
	/** The highest sequence recorded for `eventKey` (0 when none). */
	readonly lastSequence: (eventKey: string) => number;
	/**
	 * The records to replay for one event key: persisted ones first, then the in-memory buffer. A log
	 * that cannot be read is reported once and skipped; the buffer is still replayed.
	 */
	readonly replayByKey: (
		eventName: string,
		eventKey: string,
		query: ReplayQuery,
	) => Effect.Effect<readonly { readonly sequence: number; readonly output: Record<string, unknown> }[]>;
	/** The records to replay for an event name (any key), persisted first, then buffered. */
	readonly replayByName: (
		eventName: string,
		query: Pick<ReplayQuery, "limit" | "includePersisted">,
	) => Effect.Effect<readonly { readonly input: Record<string, unknown>; readonly output: Record<string, unknown> }[]>;
	/** Writes one batch of the queue to the log; failures stay queued and schedule a retry. */
	readonly flush: Effect.Effect<void>;
	/** Starts the periodic flush. */
	readonly start: Effect.Effect<void>;
	/** Stops the periodic flush and any pending retry. */
	readonly close: Effect.Effect<void>;
	/** Forgets every buffer, sequence and queued write. */
	readonly clear: Effect.Effect<void>;
};

/**
 * A sleep that does not keep the process alive. The flush ticker and retry are housekeeping: a CLI
 * that never tears its modules down must still be able to exit.
 */
const sleepUnref = (ms: number): Effect.Effect<void> =>
	Effect.callback((resume) => {
		const timer = setTimeout(() => {
			resume(Effect.void);
		}, ms);
		timer.unref();
		return Effect.sync(() => {
			clearTimeout(timer);
		});
	});

const describeFailure = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** The error to classify: the driver's, not our wrapper around it. */
const driverError = (failure: { readonly cause?: unknown }): unknown => failure.cause ?? failure;

export function makeEventJournal(config: JournalConfig): EventJournalShape {
	const { namespace, logger } = config;
	const settings = () => config.settings?.() ?? defaultJournalSettings;

	const byKey = new Map<string, BufferedEventRecord[]>();
	const byName = new Map<string, BufferedEventRecord[]>();
	const sequences = new Map<string, number>();
	const pending: PersistedEventLog[] = [];

	let flushing = false;
	let retryFiber: Fiber.Fiber<unknown> | null = null;
	let tickerFiber: Fiber.Fiber<unknown> | null = null;
	let retryAttempt = 0;
	let overflowWarned = false;
	/** True while persistence is failing, so an outage is warned about once and then logged quietly. */
	let outageActive = false;

	const append = (target: Map<string, BufferedEventRecord[]>, key: string, record: BufferedEventRecord): void => {
		const appended = [...(target.get(key) ?? []), record];
		const overflow = appended.length - settings().replayLimit;
		target.set(key, overflow > 0 ? appended.slice(overflow) : appended);
	};

	const trimPending = (): void => {
		const max = settings().maxPending;
		if (pending.length <= max) return;
		// Persistence has been down a long time: drop the OLDEST audit events.
		pending.splice(0, pending.length - max);
		if (!overflowWarned) {
			overflowWarned = true;
			logger.warn(
				`Event persistence buffer exceeded ${String(max)} — dropping oldest audit events until persistence recovers`,
			);
		}
	};

	const reportReplaySkipped = (what: string, eventName: string, error: unknown): void => {
		const message = describeFailure(error);
		if (isTransientDatabaseError(error)) {
			// First boot or a recreated database: every topic's replay fails the same way, so say it once.
			if (outageActive) {
				logger.debug(`Skipping persisted ${what} for '${eventName}': ${message}`);
			} else {
				outageActive = true;
				logger.warn(`Skipping persisted ${what} for '${eventName}' (db not ready yet): ${message}`);
			}
		} else {
			logger.warn(`Skipping persisted ${what} for '${eventName}': ${message}`);
		}
	};

	const flush: Effect.Effect<void> = Effect.suspend((): Effect.Effect<void> => {
		const store = config.store();
		if (flushing || pending.length === 0 || store === null) return Effect.void;
		flushing = true;
		const batch = pending.slice(0, settings().flushBatchSize);
		return store.insertMany(batch).pipe(
			Effect.matchEffect({
				onSuccess: () =>
					Effect.sync(() => {
						// Remove exactly what was persisted, from the front.
						pending.splice(0, batch.length);
						retryAttempt = 0;
						if (outageActive) {
							outageActive = false;
							logger.log(`Event log persistence recovered (${String(pending.length)} still queued)`);
						}
						// Drain a backlog promptly instead of waiting for the periodic flush.
						if (pending.length > 0) scheduleRetry();
					}),
				onFailure: (failure) =>
					Effect.sync(() => {
						// Never drop audit events on a transient failure: keep the batch queued and back off.
						// Log the outage once, compactly (drizzle errors embed thousands of serialized rows).
						const message = describeFailure(driverError(failure)).slice(0, 200);
						if (outageActive) {
							logger.debug(`Event log persistence still unavailable (${String(pending.length)} queued): ${message}`);
						} else {
							outageActive = true;
							logger.warn(
								`Event log persistence failed (${String(pending.length)} queued) — will retry with backoff: ${message}`,
							);
						}
						scheduleRetry();
					}),
			}),
			Effect.ensuring(
				Effect.sync(() => {
					flushing = false;
				}),
			),
		);
	});

	function scheduleRetry(): void {
		if (retryFiber !== null) return;
		const { retryBaseMs, retryMaxMs } = settings();
		const delay = Math.min(retryBaseMs * 2 ** retryAttempt, retryMaxMs);
		retryAttempt = Math.min(retryAttempt + 1, 16);
		retryFiber = Effect.runFork(
			sleepUnref(delay).pipe(
				Effect.andThen(
					Effect.sync(() => {
						retryFiber = null;
					}),
				),
				Effect.andThen(flush),
			),
		);
	}

	const ticker = Effect.suspend(() => sleepUnref(settings().flushIntervalMs)).pipe(Effect.andThen(flush), Effect.forever);

	return {
		record: (entry) => {
			const sequence = (sequences.get(entry.eventKey) ?? 0) + 1;
			sequences.set(entry.eventKey, sequence);
			const record: BufferedEventRecord = { ...entry, sequence, emittedAt: new Date().toISOString() };
			append(byKey, entry.eventKey, record);
			append(byName, entry.eventName, record);
			pending.push({
				namespace,
				eventName: entry.eventName,
				eventKey: entry.eventKey,
				sequence,
				input: record.input,
				output: record.output,
				emittedAt: new Date(record.emittedAt),
			});
			trimPending();
			// While persistence is failing the backoff timer owns the retries. Flushing on every emit here
			// fired one failing INSERT per event (115 database errors in 4 s while migrations ran).
			if (pending.length >= settings().flushBatchSize && !outageActive) Effect.runFork(flush);
			return record;
		},
		lastSequence: (eventKey) => sequences.get(eventKey) ?? 0,
		replayByKey: (eventName, eventKey, query) =>
			Effect.gen(function* () {
				const replayed: { sequence: number; output: Record<string, unknown> }[] = [];
				const store = config.store();
				if ((query.includePersisted ?? true) && store !== null) {
					const persisted = yield* store
						.findRecentByEventKey({ namespace, eventName, eventKey, limit: query.limit })
						.pipe(
							Effect.catch((failure) =>
								Effect.sync(() => {
									reportReplaySkipped("replay", eventName, driverError(failure));
									return [] as readonly PersistedEventLog[];
								}),
							),
						);
					for (const item of persisted) {
						if (query.afterSequence != null && item.sequence <= query.afterSequence) continue;
						replayed.push({ sequence: item.sequence, output: item.output });
					}
				}
				const buffered = byKey.get(eventKey);
				if (buffered?.length) {
					const window =
						query.afterSequence != null
							? buffered.filter((record) => record.sequence > (query.afterSequence ?? 0))
							: query.limit > 0
								? buffered.slice(-query.limit)
								: [];
					for (const item of window) replayed.push({ sequence: item.sequence, output: item.output });
				}
				return replayed;
			}),
		replayByName: (eventName, query) =>
			Effect.gen(function* () {
				const replayed: { input: Record<string, unknown>; output: Record<string, unknown> }[] = [];
				const store = config.store();
				if ((query.includePersisted ?? true) && store !== null) {
					const persisted = yield* store.findRecentByEventName({ namespace, eventName, limit: query.limit }).pipe(
						Effect.catch((failure) =>
							Effect.sync(() => {
								reportReplaySkipped("query replay", eventName, driverError(failure));
								return [] as readonly PersistedEventLog[];
							}),
						),
					);
					for (const item of persisted) replayed.push({ input: item.input, output: item.output });
				}
				for (const item of (byName.get(eventName) ?? []).slice(-query.limit)) {
					replayed.push({ input: item.input, output: item.output });
				}
				return replayed;
			}),
		flush,
		start: Effect.sync(() => {
			tickerFiber ??= Effect.runFork(ticker);
		}),
		close: Effect.suspend(() => {
			const fibers = [tickerFiber, retryFiber].filter((fiber): fiber is Fiber.Fiber<unknown> => fiber !== null);
			tickerFiber = null;
			retryFiber = null;
			return Effect.forEach(fibers, (fiber) => Fiber.interrupt(fiber), { discard: true });
		}),
		clear: Effect.sync(() => {
			byKey.clear();
			byName.clear();
			sequences.clear();
			pending.length = 0;
		}),
	};
}

