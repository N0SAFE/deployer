import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { Effect, Exit, Fiber } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
    projects,
    services,
} from '@deployer/nest-schema/global/project/deployment'
import { deployments } from '@deployer/nest-schema/global/runtime/deployment'
import { localEventOutbox } from '@deployer/nest-schema/global/runtime/runtime'
import {
    GlobalDatabaseService,
    type GlobalDatabaseServiceShape,
} from '@deployer/shared/core/modules/database/services/global-database.service'
import { createAuthenticatedSession } from '@deployer/shared/e2e-harness/authenticated-session'

import { RuntimeDatabasePort, RuntimeDb } from '@/core/database/runtime-db'
import { getSharedApiRuntimeContext } from '@/e2e/runtime'
import { DeploymentRepository } from '@/modules/deployment/repositories/deployment.repository'

/** The slice of the shared `pg.Pool` these tests read. */
type Pool = {
    query(sql: string): Promise<{ rows: Record<string, unknown>[] }>
    readonly totalCount: number
    readonly idleCount: number
}

/**
 * Transactions against a REAL Postgres: commit, rollback, cancellation of a running statement, and the
 * deployment repository's change-plus-outbox writes that now run through them.
 *
 * A fake pool proves the statement order (see `makePgDb`'s unit spec); only a server can prove what this
 * layer exists for: that a rolled-back write is really gone, and that interrupting a fiber stops the
 * query on the server instead of leaving it running on an orphaned connection.
 */
describe('RuntimeDb e2e: transactions and cancellation', () => {
    let database: GlobalDatabaseServiceShape
    let pool: Pool
    let repository: DeploymentRepository
    let serviceId: string
    const probe = `tx_probe_${randomUUID().replaceAll('-', '')}`

    const withDb = <A, E>(
        effect: Effect.Effect<A, E, RuntimeDb | RuntimeDatabasePort>
    ) =>
        Effect.runPromise(
            effect.pipe(
                Effect.provideService(RuntimeDb, RuntimeDb.live),
                Effect.provideService(RuntimeDatabasePort, database)
            )
        )

    beforeAll(async () => {
        const context = await getSharedApiRuntimeContext()
        database = context.serviceMapper.get(
            GlobalDatabaseService
        ) as unknown as GlobalDatabaseServiceShape
        repository = context.serviceMapper.get(DeploymentRepository)
        pool = (database.db as unknown as { $client: Pool }).$client

        const owner = await createAuthenticatedSession(context, {
            role: 'admin',
        })
        const [project] = await database.db
            .insert(projects)
            .values({
                name: `e2e-tx-${randomUUID()}`,
                description: 'transactions e2e',
                baseDomain: 'e2e.example.test',
                ownerId: owner.userId,
            })
            .returning()
        if (project === undefined) throw new Error('failed to seed the project')
        const [service] = await database.db
            .insert(services)
            .values({
                projectId: project.id,
                name: 'tx-service',
                description: 'transactions e2e',
                type: 'application' as const,
                providerId: 'artifact-bundle' as const,
                builderId: 'manual' as const,
                port: 3000,
                healthCheckPath: '/health',
            })
            .returning()
        if (service === undefined) throw new Error('failed to seed the service')
        serviceId = service.id

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
                const db = yield* RuntimeDb
                yield* db.transaction(
                    Effect.gen(function* () {
                        yield* db.use((tx) =>
                            tx.execute(
                                sql.raw(`insert into ${probe} values ('a')`)
                            )
                        )
                        yield* db.use((tx) =>
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
                const db = yield* RuntimeDb
                return yield* Effect.exit(
                    db.transaction(
                        Effect.gen(function* () {
                            yield* db.use((tx) =>
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

        const elapsed = await withDb(
            Effect.gen(function* () {
                const db = yield* RuntimeDb
                const fiber = yield* Effect.forkChild(
                    db.transaction(
                        Effect.gen(function* () {
                            yield* db.use((tx) =>
                                tx.execute(
                                    sql.raw(`insert into ${probe} values ('d')`)
                                )
                            )
                            yield* db.use((tx) =>
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

        // Nothing is still running that sleep, and the transaction's insert was rolled back.
        await new Promise((resolve) => setTimeout(resolve, 200))
        const running = await pool.query(
            "select count(*) as n from pg_stat_activity where query like '%pg_sleep(30)%' and pid <> pg_backend_pid() and state = 'active'"
        )
        expect(Number(running.rows[0]?.n)).toBe(0)
        expect(await countProbe()).toBe(before)
        expect(pool.totalCount - pool.idleCount).toBeLessThanOrEqual(baseline)
    }, 30_000)

    it('writes a deployment and its outbox event together, and removes both consistently', async () => {
        const created = await repository.create({
            serviceId,
            triggeredBy: null,
            environment: 'production',
            sourceType: 'upload',
        } as never)

        const outbox = async (topic: string) =>
            (
                await database.db
                    .select()
                    .from(localEventOutbox)
                    .where(eq(localEventOutbox.topic, topic))
            ).filter((event) =>
                JSON.stringify(event.payload).includes(created.id)
            )
        expect(await outbox('deployment.created')).toHaveLength(1)

        const updated = await repository.updateStatus(created.id, 'building')
        expect(updated?.status).toBe('building')
        expect(await outbox('deployment.status.updated')).toHaveLength(1)

        await repository.delete(created.id)
        expect(
            await database.db
                .select()
                .from(deployments)
                .where(eq(deployments.id, created.id))
        ).toHaveLength(0)
        expect(await outbox('deployment.deleted')).toHaveLength(1)
    }, 30_000)
})
