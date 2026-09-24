export const GLOBAL_DATABASE_CONNECTION = "GLOBAL_DATABASE_CONNECTION";
export const GLOBAL_DATABASE_POOL = "GLOBAL_DATABASE_POOL";

/** Typed Drizzle handle on the local SQLite database (what consumers query). */
export const LOCAL_DATABASE_CONNECTION = "LOCAL_DATABASE_CONNECTION";

/**
 * The RAW `bun:sqlite` handle underneath `LOCAL_DATABASE_CONNECTION`.
 *
 * Exposed as its own token so the connection can be CLOSED on shutdown without
 * reaching into Drizzle internals (the driver exposes no typed accessor for it).
 * Both tokens resolve to the same underlying handle, created once per Nest
 * context by `LocalDatabaseModule`.
 */
export const LOCAL_DATABASE_CLIENT = "LOCAL_DATABASE_CLIENT";
