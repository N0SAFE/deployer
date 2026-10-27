import {
    makePgDb,
    type DbShape,
    type PgClientLike,
    type PgPoolLike,
} from '@deployer/effect-infra'
import type { GlobalDatabase } from '@deployer/shared/core/modules/database/services/global-database.service'
import { Context, Effect, Layer } from 'effect'
import { drizzle } from 'drizzle-orm/node-postgres'

import { DatabasePort } from './database.port'

/**
 * The project service's database with fiber-scoped transactions.
 *
 * `use` runs a Drizzle callback on the transaction's connection when there is one, else on a
 * borrowed connection; `transaction(effect)` runs `effect` in one transaction. Both cancel the
 * query on the server when the fiber is interrupted (see `makePgDb`).
 */
export class ProjectDb extends Context.Service<
    ProjectDb,
    DbShape<GlobalDatabase>
>()('project/Db') {
    /** Built over the shared pool the Nest database module owns; this layer never closes it. */
    static readonly Live: Layer.Layer<ProjectDb, never, DatabasePort> =
        Layer.effect(
            ProjectDb,
            Effect.gen(function* () {
                const { db } = yield* DatabasePort
                return makePgDb<GlobalDatabase>({
                    name: 'project',
                    pool: (db as unknown as { readonly $client: PgPoolLike })
                        .$client,
                    // Same schema (and so the same relational `query` API) as the shared database.
                    makeDb: (client: PgClientLike) =>
                        drizzle(client as never, { schema: db._.fullSchema }),
                })
            })
        )
}
