import type { EventLogUnavailable } from "../errors";
import type { Effect } from "effect";


/** An emitted event as held in the replay buffers. */
export type BufferedEventRecord = {
	readonly eventName: string;
	readonly eventKey: string;
	readonly input: Record<string, unknown>;
	readonly output: Record<string, unknown>;
	readonly sequence: number;
	readonly emittedAt: string;
};

/** An emitted event as written to the event log. */
export type PersistedEventLog = {
	readonly namespace: string;
	readonly eventName: string;
	readonly eventKey: string;
	readonly sequence: number;
	readonly input: Record<string, unknown>;
	readonly output: Record<string, unknown>;
	readonly emittedAt: Date;
};

/**
 * Where events are persisted. It is best-effort audit storage: a failure is an `EventLogUnavailable`
 * carrying the driver's own error; the journal retries writes and never lets one reach the code that
 * emitted the event.
 */
export type EventLogStoreShape = {
	readonly insertMany: (logs: readonly PersistedEventLog[]) => Effect.Effect<void, EventLogUnavailable>;
	readonly findRecentByEventKey: (query: {
		readonly namespace: string;
		readonly eventName: string;
		readonly eventKey: string;
		readonly limit: number;
	}) => Effect.Effect<readonly PersistedEventLog[], EventLogUnavailable>;
	readonly findRecentByEventName: (query: {
		readonly namespace: string;
		readonly eventName: string;
		readonly limit: number;
	}) => Effect.Effect<readonly PersistedEventLog[], EventLogUnavailable>;
};

/** The sink the journal reports through (the host passes its own logger). */
export type JournalLogger = {
	readonly warn: (message: string) => void;
	readonly debug: (message: string) => void;
	readonly log: (message: string) => void;
};

export type ReplayQuery = {
	/** How many records to replay at most. */
	readonly limit: number;
	/** Include what was persisted before this process started. Default true. */
	readonly includePersisted?: boolean;
	/** Only records with a sequence above this (cursor-based reconnect). */
	readonly afterSequence?: number;
};
