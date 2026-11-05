import { Effect } from 'effect'
import { Pool } from 'pg'

export type ExternalDatabaseObservation = {
    readonly select1: {
        readonly ok: boolean
        readonly latencyMs: number | null
    }
    readonly tableCount: number
    readonly tables: string[]
    readonly database: string
}

const unreachable = (database: string): ExternalDatabaseObservation => ({
    select1: { ok: false, latencyMs: null },
    tableCount: 0,
    tables: [],
    database,
})

/**
 * `SELECT 1` plus the public table listing against an operator-provided database URL. Never fails: a
 * database that cannot be reached or queried is an observation (`select1.ok: false`), not an error.
 * The connection pool lives exactly as long as the probe, so interrupting it closes the connection
 * and cancels whatever is in flight.
 */
export const probeExternalDatabase = (
    databaseUrl: string
): Effect.Effect<ExternalDatabaseObservation> => {
    const url = databaseUrl.trim()
    const database = url.split('/').pop() ?? 'unknown'
    if (url === '') return Effect.succeed(unreachable(database))

    return Effect.acquireUseRelease(
        Effect.sync(
            () =>
                new Pool({
                    connectionString: url,
                    max: 1,
                    connectionTimeoutMillis: 5_000,
                })
        ),
        (pool) =>
            Effect.tryPromise(async () => {
                const startedAt = Date.now()
                await pool.query('SELECT 1')
                const latencyMs = Date.now() - startedAt
                const result = await pool.query<{ table_name: string }>(
                    `SELECT table_name FROM information_schema.tables
					 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
					 ORDER BY table_name`
                )
                const tables = result.rows.map((row) => row.table_name)
                return {
                    select1: { ok: true, latencyMs },
                    tableCount: tables.length,
                    tables,
                    database,
                }
            }),
        (pool) => Effect.promise(() => pool.end().catch(() => undefined))
    ).pipe(Effect.orElseSucceed(() => unreachable(database)))
}
