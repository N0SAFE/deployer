/**
 * @deployer/events — domain events as Effect.
 *
 * Framework-free: typed contracts, the durable per-namespace journal and the transient-database
 * error classifier. The RxJS services that stream events live in `apps/api/shared` (`core/modules/events/base`).
 */
export { contractBuilder, EventContractBuilder } from "./contracts/event-contract.builder";
export type { EventContract, EventContracts, EventInput, EventOutput } from "./contracts/event-contract.builder";
export { EventLogUnavailable } from "./errors";
export { defaultJournalSettings, makeEventJournal } from "./journal/event-journal";
export type { EventJournalShape, JournalConfig, JournalSettings } from "./journal/event-journal";
export type {
	BufferedEventRecord,
	EventLogStoreShape,
	JournalLogger,
	PersistedEventLog,
	ReplayQuery,
} from "./journal/records";
export { isTransientDatabaseError } from "./storage/transient-database-error";
