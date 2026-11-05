import { Context, Effect } from 'effect'
import { Pool } from 'pg'

export type ProbeResult = {
    reachable: boolean
    latencyMs: number
    error?: string
}

export type DatabaseProbeServiceShape = {
    /** One `SELECT 1` over a throwaway connection. Never fails: an unreachable database is the answer, with a categorised error. */
    readonly probe: (
        databaseUrl: string,
        options?: { timeout?: number }
    ) => Effect.Effect<ProbeResult>
    /** `probe` with backoff between attempts. */
    readonly probeWithRetry: (
        databaseUrl: string,
        maxRetries?: number
    ) => Effect.Effect<ProbeResult>
}

const categorizeError = (message: string): string => {
    if (message.includes('ECONNREFUSED'))
        return 'Connection refused — is the database running?'
    if (message.includes('ETIMEDOUT') || message.includes('timeout'))
        return 'Connection timed out — check network/firewall.'
    if (message.includes('ENOTFOUND'))
        return 'Hostname not resolved — check DNS.'
    if (message.includes('password') || message.includes('authentication'))
        return 'Authentication failed.'
    if (message.includes('does not exist')) return 'Database does not exist.'
    return `Database error: ${message}`
}

async function probeOnce(
    databaseUrl: string,
    timeout: number
): Promise<ProbeResult> {
    const start = Date.now()
    const probePool = new Pool({
        connectionString: databaseUrl.trim(),
        max: 1,
        connectionTimeoutMillis: timeout,
        idleTimeoutMillis: 1_000,
        allowExitOnIdle: true,
    })
    try {
        await probePool.query('SELECT 1')
        return { reachable: true, latencyMs: Date.now() - start }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return {
            reachable: false,
            latencyMs: Date.now() - start,
            error: categorizeError(message),
        }
    } finally {
        await probePool.end().catch(() => undefined)
    }
}

export function makeDatabaseProbeService(): DatabaseProbeServiceShape {
    const probe: DatabaseProbeServiceShape['probe'] = (databaseUrl, options) =>
        Effect.promise(() => probeOnce(databaseUrl, options?.timeout ?? 5_000))

    return {
        probe,
        probeWithRetry: (databaseUrl, maxRetries = 3) =>
            Effect.gen(function* () {
                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    const result = yield* probe(databaseUrl, { timeout: 5_000 })
                    if (result.reachable) return result
                    if (attempt < maxRetries)
                        yield* Effect.sleep(1000 * Math.pow(2, attempt - 1))
                }
                return yield* probe(databaseUrl, { timeout: 5_000 })
            }),
    }
}

export class DatabaseProbeService extends Context.Service<
    DatabaseProbeService,
    DatabaseProbeServiceShape
>()('shared/DatabaseProbeService') {}
