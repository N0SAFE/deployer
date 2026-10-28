import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventLogUnavailable } from "../errors";

import { makeEventJournal, type JournalSettings } from "./event-journal";

import type { EventLogStoreShape, JournalLogger, PersistedEventLog } from "./records";

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect);

const makeLogger = () => ({ warn: vi.fn(), debug: vi.fn(), log: vi.fn() }) satisfies JournalLogger;

const makeStore = (overrides: Partial<EventLogStoreShape> = {}) => {
	const written: PersistedEventLog[] = [];
	const store: EventLogStoreShape = {
		insertMany: (logs) =>
			Effect.sync(() => {
				written.push(...logs);
			}),
		findRecentByEventKey: () => Effect.succeed([]),
		findRecentByEventName: () => Effect.succeed([]),
		...overrides,
	};
	return { store, written };
};

const entry = (n: number, key = "k1") => ({
	eventName: "progress",
	eventKey: key,
	input: { id: key },
	output: { n },
});

const settings = (patch: Partial<JournalSettings> = {}): (() => JournalSettings) => () => ({
	replayLimit: 3,
	flushBatchSize: 2,
	flushIntervalMs: 60_000,
	retryBaseMs: 5,
	retryMaxMs: 20,
	maxPending: 5,
	...patch,
});

const journalWith = (store: EventLogStoreShape | null, logger = makeLogger(), patch?: Partial<JournalSettings>) => ({
	logger,
	journal: makeEventJournal({ namespace: "demo", store: () => store, logger, settings: settings(patch) }),
});

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
	vi.restoreAllMocks();
});

describe("EventJournal.record", () => {
	it("numbers each key independently and bounds the replay buffer", async () => {
		const { journal } = journalWith(null);
		for (let n = 1; n <= 5; n++) journal.record(entry(n));
		journal.record(entry(1, "k2"));
		expect(journal.lastSequence("k1")).toBe(5);
		expect(journal.lastSequence("k2")).toBe(1);
		expect(journal.lastSequence("none")).toBe(0);
		const replay = await run(journal.replayByKey("progress", "k1", { limit: 10 }));
		expect(replay.map((item) => item.sequence)).toEqual([3, 4, 5]);
	});
});

describe("EventJournal.replay", () => {
	it("replays only what follows the cursor", async () => {
		const { journal } = journalWith(null);
		for (let n = 1; n <= 3; n++) journal.record(entry(n));
		const replay = await run(journal.replayByKey("progress", "k1", { limit: 10, afterSequence: 1 }));
		expect(replay.map((item) => item.output.n)).toEqual([2, 3]);
	});

	it("puts persisted records before buffered ones", async () => {
		const persisted: PersistedEventLog[] = [1, 2].map((n) => ({
			namespace: "demo",
			eventName: "progress",
			eventKey: "k1",
			sequence: n,
			input: {},
			output: { n, persisted: true },
			emittedAt: new Date(),
		}));
		const { store } = makeStore({ findRecentByEventKey: () => Effect.succeed(persisted) });
		const { journal } = journalWith(store);
		journal.record(entry(9));
		const replay = await run(journal.replayByKey("progress", "k1", { limit: 10 }));
		expect(replay.map((item) => item.output)).toEqual([{ n: 1, persisted: true }, { n: 2, persisted: true }, { n: 9 }]);
	});

	it("reports an unreadable log once, then quietly, and still replays the buffer", async () => {
		const down = new EventLogUnavailable({
			reason: "down",
			cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
		});
		const { store } = makeStore({ findRecentByEventKey: () => Effect.fail(down) });
		const { journal, logger } = journalWith(store);
		journal.record(entry(1));
		expect(await run(journal.replayByKey("progress", "k1", { limit: 5 }))).toHaveLength(1);
		await run(journal.replayByKey("progress", "k1", { limit: 5 }));
		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(logger.debug).toHaveBeenCalledTimes(1);
	});

	it("replays by event name across keys", async () => {
		const { journal } = journalWith(null);
		journal.record(entry(1, "a"));
		journal.record(entry(2, "b"));
		const replay = await run(journal.replayByName("progress", { limit: 5 }));
		expect(replay.map((item) => item.output.n)).toEqual([1, 2]);
	});
});

describe("EventJournal persistence", () => {
	it("flushes a full batch at once, in order", async () => {
		const { store, written } = makeStore();
		const { journal } = journalWith(store);
		journal.record(entry(1));
		expect(written).toHaveLength(0);
		journal.record(entry(2));
		await tick(5);
		expect(written.map((log) => log.sequence)).toEqual([1, 2]);
	});

	it("keeps a failed batch queued, warns once, retries with backoff and logs the recovery", async () => {
		let healthy = false;
		const { store, written } = makeStore({
			insertMany: (logs) =>
				healthy
					? Effect.sync(() => {
							written.push(...logs);
						})
					: Effect.fail(new EventLogUnavailable({ reason: "table missing" })),
		});
		const { journal, logger } = journalWith(store);
		journal.record(entry(1));
		journal.record(entry(2));
		await tick(40);
		expect(written).toHaveLength(0);
		expect(logger.warn).toHaveBeenCalledTimes(1);
		healthy = true;
		await tick(60);
		expect(written.map((log) => log.sequence)).toEqual([1, 2]);
		expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("recovered"));
		await run(journal.close);
	});

	it("drops the oldest queued events past the cap, warning once", () => {
		const { journal, logger } = journalWith(null, makeLogger(), { flushBatchSize: 100 });
		for (let n = 1; n <= 8; n++) journal.record(entry(n));
		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("dropping oldest"));
	});

	it("does nothing without a store and forgets everything on clear", async () => {
		const { journal } = journalWith(null);
		journal.record(entry(1));
		await run(journal.flush);
		await run(journal.clear);
		expect(journal.lastSequence("k1")).toBe(0);
		expect(await run(journal.replayByKey("progress", "k1", { limit: 5 }))).toEqual([]);
	});
});
