import {
    makePgDb,
    type DbShape,
    type PgClientLike,
    type PgPoolLike,
} from '@deployer/effect-infra'
import type {
    GlobalDatabase,
    GlobalDatabaseService,
} from '@deployer/shared/core/modules/database/services/global-database.service'
import { Context } from 'effect'
import { drizzle } from 'drizzle-orm/node-postgres'

/**
 * The runtime service's database with fiber-scoped transactions: `use` runs a Drizzle callback on
 * the transaction's connection when there is one, `transaction(effect)` runs `effect` in one
 * transaction, and both cancel the query on the server when the fiber is interrupted (see `makePgDb`).
 */
export class RuntimeDb extends Context.Service<
    RuntimeDb,
    DbShape<GlobalDatabase>
>()('runtime/Db') {}

/**
 * The same database for callers that are not on Effect yet (the deployment repository). The pool is
 * read when this is called, so call it on first use, after the database module has initialised.
 */
export function makeRuntimeDb(
    database: GlobalDatabaseService
): DbShape<GlobalDatabase> {
    const db = database.db
    return makePgDb<GlobalDatabase>({
        name: 'runtime',
        pool: (db as unknown as { readonly $client: PgPoolLike }).$client,
        // Same schema (and so the same relational `query` API) as the shared database.
        makeDb: (client: PgClientLike) =>
            drizzle(client as never, { schema: db._.fullSchema }),
    })
}
