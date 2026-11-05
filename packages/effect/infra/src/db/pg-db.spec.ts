import { Context, Effect, Exit, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'

import {
    DbError,
    lazyPgDb,
    makePgDb,
    type PgClientLike,
    type PgPoolLike,
} from './pg-db'

type Log = string[]

/** A pool whose clients record every statement and release; `hang` makes a callback never finish. */
function fakePool(options: { failOn?: string } = {}) {
    const log: Log = []
    const released: boolean[] = []
    const poolQueries: string[] = []
    let nextPid = 100

    const makeClient = (): PgClientLike => {
        const pid = nextPid++
        return {
            processID: pid,
            query: (sql: string) => {
                log.push(`${String(pid)}:${sql}`)
                if (options.failOn !== undefined && sql === options.failOn)
                    return Promise.reject(new Error(`boom: ${sql}`))
                return Promise.resolve({ rows: [] })
            },
            release: (destroy?: boolean | Error) => {
                released.push(destroy === true)
            },
        }
    }

    const pool: PgPoolLike = {
        connect: () => Promise.resolve(makeClient()),
        query: (sql: string, params?: readonly unknown[]) => {
            poolQueries.push(`${sql}${params ? ` [${params.join(',')}]` : ''}`)
            return Promise.resolve({ rows: [] })
        },
    }
    return { pool, log, released, poolQueries }
}

type Db = { readonly tag: string; readonly client: PgClientLike }
const make = (pool: PgPoolLike) =>
    makePgDb<Db>({
        name: 'test',
        pool,
        makeDb: (client) => ({ tag: 'db', client }),
    })

describe('makePgDb.use', () => {
    it('borrows a connection for one call and returns it to the pool', async () => {
        const { pool, released } = fakePool()
        const db = make(pool)
        const value = await Effect.runPromise(
            db.use((d) => Promise.resolve(d.tag))
        )
        expect(value).toBe('db')
        expect(released).toEqual([false])
    })

    it('wraps a driver failure as DbError and destroys the connection', async () => {
        const { pool, released } = fakePool()
        const db = make(pool)
        const error = await Effect.runPromise(
            Effect.flip(db.use(() => Promise.reject(new Error('syntax'))))
        )
        expect(error).toBeInstanceOf(DbError)
        expect(released).toEqual([true])
    })

    it('cancels the backend by pid when the fiber is interrupted, and destroys the connection', async () => {
        const { pool, released, poolQueries } = fakePool()
        const db = make(pool)
        const fiber = Effect.runFork(
            db.use(
                (_d, signal) =>
                    new Promise<never>((_resolve, reject) => {
                        signal.addEventListener('abort', () => {
                            reject(new Error('aborted'))
                        })
                    })
            )
        )
        await new Promise((r) => setTimeout(r, 10))
        const exit = await Effect.runPromise(
            Fiber.interrupt(fiber).pipe(
                Effect.flatMap(() => Fiber.await(fiber))
            )
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(poolQueries).toEqual(['select pg_cancel_backend($1) [100]'])
        expect(released).toEqual([true])
    })
})

describe('makePgDb.transaction', () => {
    it('runs begin, the body on the same connection, then commit', async () => {
        const { pool, log, released } = fakePool()
        const db = make(pool)
        await Effect.runPromise(
            db.transaction(
                Effect.gen(function* () {
                    yield* db.use((d) => d.client.query('insert a'))
                    yield* db.use((d) => d.client.query('insert b'))
                })
            )
        )
        expect(log).toEqual([
            '100:begin',
            '100:insert a',
            '100:insert b',
            '100:commit',
        ])
        expect(released).toEqual([false])
    })

    it('rolls back and destroys the connection when the body fails', async () => {
        const { pool, log, released } = fakePool()
        const db = make(pool)
        const error = await Effect.runPromise(
            Effect.flip(
                db.transaction(
                    db
                        .use((d) => d.client.query('insert a'))
                        .pipe(Effect.andThen(Effect.fail('nope')))
                )
            )
        )
        expect(error).toBe('nope')
        expect(log).toEqual(['100:begin', '100:insert a', '100:rollback'])
        expect(log).not.toContain('100:commit')
        expect(released).toEqual([true])
    })

    it('does not commit when commit itself is the failing statement', async () => {
        const { pool, released } = fakePool({ failOn: 'commit' })
        const db = make(pool)
        const error = await Effect.runPromise(
            Effect.flip(db.transaction(Effect.void))
        )
        expect(error).toBeInstanceOf(DbError)
        expect(released).toEqual([true])
    })

    it('rolls back and cancels the running statement when the fiber is interrupted', async () => {
        const { pool, log, released, poolQueries } = fakePool()
        const db = make(pool)
        const fiber = Effect.runFork(
            db.transaction(
                db
                    .use((d) => d.client.query('insert a'))
                    .pipe(
                        Effect.andThen(
                            db.use(
                                (_d, signal) =>
                                    new Promise<never>((_r, reject) => {
                                        signal.addEventListener('abort', () => {
                                            reject(new Error('aborted'))
                                        })
                                    })
                            )
                        )
                    )
            )
        )
        await new Promise((r) => setTimeout(r, 10))
        await Effect.runPromise(Fiber.interrupt(fiber))
        expect(poolQueries).toEqual(['select pg_cancel_backend($1) [100]'])
        expect(log).toEqual(['100:begin', '100:insert a', '100:rollback'])
        expect(released).toEqual([true])
    })

    it('nests as a savepoint: an inner failure rolls back to it, the outer can carry on and commit', async () => {
        const { pool, log, released } = fakePool()
        const db = make(pool)
        await Effect.runPromise(
            db.transaction(
                Effect.gen(function* () {
                    yield* Effect.ignore(db.transaction(Effect.fail('inner')))
                    yield* db.use((d) => d.client.query('after'))
                })
            )
        )
        expect(log).toEqual([
            '100:begin',
            '100:savepoint sp_1',
            '100:rollback to savepoint sp_1',
            '100:after',
            '100:commit',
        ])
        expect(released).toEqual([false])
    })

    it('keeps two concurrent transactions on separate connections', async () => {
        const { pool, log } = fakePool()
        const db = make(pool)
        const body = (name: string) =>
            db.transaction(db.use((d) => d.client.query(name)))
        await Effect.runPromise(
            Effect.all([body('x'), body('y')], { concurrency: 2 })
        )
        const connectionOf = (name: string) =>
            log.find((l) => l.endsWith(`:${name}`))?.split(':')[0]
        expect(connectionOf('x')).toBeDefined()
        expect(connectionOf('x')).not.toBe(connectionOf('y'))
    })
})

describe('lazyPgDb', () => {
    it('builds one handle per pool, so calls share a transaction context', async () => {
        const queries: string[] = []
        const client = {
            query: (sql: string) => {
                queries.push(sql)
                return Promise.resolve({ rows: [] })
            },
            release: () => undefined,
            processID: 1,
        }
        const pool = {
            connect: () => Promise.resolve(client),
            query: () => Promise.resolve({ rows: [] }),
        }
        class Source extends Context.Service<
            Source,
            { readonly pool: typeof pool }
        >()('test/Source') {}
        const db = lazyPgDb(Source, {
            name: 'lazy',
            pool: (s) => s.pool,
            makeDb: () => () => 'db',
        })

        const program = db
            .transaction(db.use(async (handle) => handle))
            .pipe(Effect.provideService(Source, { pool }))
        await expect(Effect.runPromise(program)).resolves.toBe('db')
        expect(queries[0]).toMatch(/begin/i)
        expect(queries.some((sql) => /commit/i.test(sql))).toBe(true)
        // Nested use joined the transaction: a single connection ran begin..commit, no second begin.
        expect(queries.filter((sql) => /begin/i.test(sql))).toHaveLength(1)
    })
})
