import { drizzle } from 'drizzle-orm/node-postgres'
import { Context, Effect } from 'effect'

import {
    lazyPgDb,
    type DbShape,
    type LazyDbShape,
    type PgClientLike,
    type PgPoolLike,
} from '@deployer/effect-infra'
import type {
    GlobalDatabase,
    GlobalDatabaseServiceShape,
} from '@deployer/shared/core/modules/database/services/global-database.service'

/** The shared global database the runtime service reads and writes (a Nest provider). */
export class RuntimeDatabasePort extends Context.Service<
    RuntimeDatabasePort,
    GlobalDatabaseServiceShape
>()('runtime/RuntimeDatabasePort') {}

/**
 * The runtime service's database with fiber-scoped transactions: `use` runs a Drizzle callback on
 * the transaction's connection when there is one, `transaction(effect)` runs `effect` in one
 * transaction, and both cancel the query on the server when the fiber is interrupted (see `makePgDb`).
 * The pool comes from `RuntimeDatabasePort` when a call runs; one handle is built per pool and shared.
 */
export class RuntimeDb extends Context.Service<
    RuntimeDb,
    LazyDbShape<GlobalDatabase, RuntimeDatabasePort>
>()('runtime/Db') {
    static readonly live: LazyDbShape<GlobalDatabase, RuntimeDatabasePort> =
        lazyPgDb(RuntimeDatabasePort, {
            name: 'runtime',
            pool: ({ db }) =>
                (db as unknown as { readonly $client: PgPoolLike }).$client,
            // Same schema (and so the same relational `query` API) as the shared database.
            makeDb:
                ({ db }) =>
                (client: PgClientLike) =>
                    drizzle(client as never, { schema: db._.fullSchema }),
        })
}

/**
 * `RuntimeDb.live` with its database already chosen, for callers that are not on Effect yet (the
 * deployment repository and the queue lifecycle). It is the SAME shared handle, so a transaction they
 * open is visible to the Effect services. Remove it when those callers move onto the tag.
 */
export function runtimeDbOver(
    database: GlobalDatabaseServiceShape
): DbShape<GlobalDatabase> {
    return {
        use: (fn) =>
            Effect.provideService(
                RuntimeDb.live.use(fn),
                RuntimeDatabasePort,
                database
            ),
        transaction: (effect) =>
            Effect.provideService(
                RuntimeDb.live.transaction(effect),
                RuntimeDatabasePort,
                database
            ),
    }
}
