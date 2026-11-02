import { drizzle } from 'drizzle-orm/node-postgres'
import { Context } from 'effect'

import {
    lazyPgDb,
    type LazyDbShape,
    type PgClientLike,
    type PgPoolLike,
} from '@deployer/effect-infra'
import type { GlobalDatabase } from '@deployer/shared/core/modules/database/services/global-database.service'

import { DatabasePort } from './database.port'

/**
 * The project service's database with fiber-scoped transactions.
 *
 * `use` runs a Drizzle callback on the transaction's connection when there is one, else on a
 * borrowed connection; `transaction(effect)` runs `effect` in one transaction. Both cancel the
 * query on the server when the fiber is interrupted (see `makePgDb`). The pool comes from
 * `DatabasePort` when a call runs; one handle is built per pool and shared, and the pool is never closed.
 */
export class ProjectDb extends Context.Service<ProjectDb, LazyDbShape<GlobalDatabase, DatabasePort>>()('project/Db') {
    static readonly live: LazyDbShape<GlobalDatabase, DatabasePort> = lazyPgDb(DatabasePort, {
        name: 'project',
        pool: ({ db }) => (db as unknown as { readonly $client: PgPoolLike }).$client,
        // Same schema (and so the same relational `query` API) as the shared database.
        makeDb:
            ({ db }) =>
            (client: PgClientLike) =>
                drizzle(client as never, { schema: db._.fullSchema }),
    })
}
