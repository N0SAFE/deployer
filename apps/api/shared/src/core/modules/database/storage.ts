import { Context, Effect } from "effect";

import { domainError } from "@deployer/effect-core";

import type { GlobalDatabase } from "./global/global-database.service";

/** The platform database as an Effect port. Bound to the container's `GlobalDatabaseService` by the module that needs it. */
export class DatabasePort extends Context.Service<DatabasePort, { readonly db: GlobalDatabase }>()("shared/DatabasePort") {}

/** The database failed; the cause stays server-side. */
export class StorageFailure extends domainError("StorageFailure", "dependency_missing")() {
  override publicMessage() { return "The store is unavailable."; }
}

/** Run one Promise-based query; any rejection is a `StorageFailure`. */
export function storage<A>(
  database: { readonly db: GlobalDatabase },
  run: (db: GlobalDatabase) => Promise<A>,
): Effect.Effect<A, StorageFailure> {
  return Effect.tryPromise({ try: () => run(database.db), catch: (cause) => new StorageFailure({ cause }) });
}
