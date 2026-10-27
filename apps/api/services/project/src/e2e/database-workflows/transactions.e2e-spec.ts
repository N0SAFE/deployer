import { randomUUID } from 'node:crypto'
import { localEventOutbox } from '@deployer/nest-schema/global/runtime/runtime'
import { projects } from '@deployer/nest-schema/global/project/deployment'
import { GlobalDatabaseService } from '@deployer/shared/core/modules/database/services/global-database.service'
import { and, eq } from 'drizzle-orm'
import { Effect, Exit, Fiber, Layer } from 'effect'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getSharedApiRuntimeContext } from '@/e2e/runtime'
import { createAuthenticatedSession } from '@deployer/shared/e2e-harness/authenticated-session'
import { DatabasePort } from '@project/core/database/database.port'
import { ProjectDb } from '@project/core/database/project-db'
import { ProjectStore } from '@/modules/project/repositories/project.repository'

/**
 * Transactions against a REAL Postgres: commit, rollback, and cancellation of a running statement.
 *
 * A fake pool proves the statement order (see `makePgDb`'s unit spec); only a server can prove the
 * things this layer exists for: that a rolled-back write is really gone, and that interrupting a
 * fiber stops the query on the server instead of leaving it running on an orphaned connection.
 */
/** The slice of the shared `pg.Pool` these tests read. */
type Pool = {
    query(sql: string): Promise<{ rows: Record<string, unknown>[] }>
    readonly totalCount: number
    readonly idleCount: number
}

describe('ProjectDb e2e: transactions and cancellation', () => {
    let db: GlobalDatabaseService['db']
    let pool: Pool
    let ownerId: string
    const probe = `tx_probe_${randomUUID().replaceAll('-', '')}`

    const withDb = <A, E>(
        effect: Effect.Effect<A, E, ProjectDb | ProjectStore>
    ) =>
        Effect.runPromise(
            effect.pipe(
                Effect.provide(
                    Layer.provideMerge(ProjectStore.Live, ProjectDb.Live)
                ),
                Effect.provideService(DatabasePort, { db })
            )
        )

    beforeAll(async () => {
        const context = await getSharedApiRuntimeContext()
        db = context.serviceMapper.get(GlobalDatabaseService).db
        pool = (db as unknown as { $client: Pool }).$client
        const admin = await createAuthenticatedSession(context, {
            role: 'admin',
        })
        ownerId = admin.userId
        await pool.query(`create table ${probe} (id text primary key)`)
    }, 120_000)

    afterAll(async () => {
        await pool.query(`drop table if exists ${probe}`)
    })

    const countProbe = async () =>
        Number(
            (await pool.query(`select count(*) as n from ${probe}`)).rows[0]?.n
        )

    it("commits a transaction's writes together", async () => {
        await withDb(
            Effect.gen(function* () {
                const database = yield* ProjectDb
                yield* database.transaction(
                    Effect.gen(function* () {
                        yield* database.use((tx) =>
                            tx.execute(
                                sql.raw(`insert into ${probe} values ('a')`)
                            )
                        )
                        yield* database.use((tx) =>
                            tx.execute(
                                sql.raw(`insert into ${probe} values ('b')`)
                            )
                        )
                    })
                )
            })
        )
        expect(await countProbe()).toBe(2)
    })

    it('rolls every write back when the body fails', async () => {
        const before = await countProbe()
        const exit = await withDb(
            Effect.gen(function* () {
                const database = yield* ProjectDb
                return yield* Effect.exit(
                    database.transaction(
                        Effect.gen(function* () {
                            yield* database.use((tx) =>
                                tx.execute(
                                    sql.raw(`insert into ${probe} values ('c')`)
                                )
                            )
                            return yield* Effect.fail('abort')
                        })
                    )
                )
            })
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(await countProbe()).toBe(before)
    })

    it('stops a 30 s statement on the server within a second of interrupting the fiber, with no leaked connection', async () => {
        const baseline = pool.totalCount - pool.idleCount
        const before = await countProbe()

        const started = Date.now()
        const elapsed = await withDb(
            Effect.gen(function* () {
                const database = yield* ProjectDb
                const fiber = yield* Effect.forkChild(
                    database.transaction(
                        Effect.gen(function* () {
                            yield* database.use((tx) =>
                                tx.execute(
                                    sql.raw(`insert into ${probe} values ('d')`)
                                )
                            )
                            yield* database.use((tx) =>
                                tx.execute(sql`select pg_sleep(30)`)
                            )
                        })
                    )
                )
                yield* Effect.sleep('300 millis')
                const interruptedAt = Date.now()
                yield* Fiber.interrupt(fiber)
                return Date.now() - interruptedAt
            })
        )

        expect(elapsed).toBeLessThan(1000)
        expect(Date.now() - started).toBeLessThan(5000)

        // Nothing is still running that sleep, and the transaction's insert was rolled back.
        await new Promise((resolve) => setTimeout(resolve, 200))
        const running = await pool.query(
            "select count(*) as n from pg_stat_activity where query like '%pg_sleep(30)%' and pid <> pg_backend_pid() and state = 'active'"
        )
        expect(Number(running.rows[0]?.n)).toBe(0)
        expect(await countProbe()).toBe(before)
        expect(pool.totalCount - pool.idleCount).toBeLessThanOrEqual(baseline)
    }, 30_000)

    it('writes a project and its outbox event together, and removes both consistently', async () => {
        const created = await withDb(
            Effect.gen(function* () {
                const store = yield* ProjectStore
                return yield* store.create({
                    name: `tx-e2e-${randomUUID()}`,
                    ownerId,
                })
            })
        )

        const events = await db
            .select()
            .from(localEventOutbox)
            .where(and(eq(localEventOutbox.topic, 'project.created')))
        expect(
            events.some((event) =>
                JSON.stringify(event.payload).includes(created.id)
            )
        ).toBe(true)

        await withDb(
            Effect.gen(function* () {
                const store = yield* ProjectStore
                yield* store.delete(created.id)
            })
        )
        expect(
            await db.select().from(projects).where(eq(projects.id, created.id))
        ).toHaveLength(0)
    }, 30_000)
})
