import { Context, Effect } from 'effect'

import { indicatorFor, type HealthIndicatorShape } from './indicator-result'

import type { IndicatorResult } from '../types'
import type { Pool } from 'pg'

/**
 * The Postgres check — a REAL round trip, not a presence test.
 *
 * ── WHAT MAKES THIS "REAL" ──────────────────────────────────────────────────
 * It does three things a naive check does not:
 *
 *   1. runs an actual statement through the app's OWN pool (so it proves the
 *      pool is usable, not just that some host answers on 5432);
 *   2. reads the SERVER VERSION, so the payload says WHICH database answered —
 *      the thing that tells you a compose stack is pointed at the wrong one;
 *   3. reports latency, so a database that answers slowly is visible BEFORE it
 *      starts failing.
 *
 * ── WHY IT NEVER FAILS ──────────────────────────────────────────────────────
 * A health check that throws when a dependency is down has hidden the diagnosis
 * it exists to provide. Every failure becomes `indicator.down({ message })`,
 * which renders as `{ database: { status: "down", message } }` — the shape a
 * client already understands.
 *
 * ── THE POOL, NOT THE CONNECTION ────────────────────────────────────────────
 * `GLOBAL_DATABASE_CONNECTION` is the DRIZZLE handle (a query builder) and
 * `GLOBAL_DATABASE_POOL` is the raw `pg.Pool`. This check issues a bare
 * `SELECT version()`, which only the pool can do — so the module passes the
 * pool into the constructor (it may be absent, which is reported, not thrown).
 */
export class DatabaseHealthIndicator extends Context.Service<
    DatabaseHealthIndicator,
    HealthIndicatorShape
>()('shared/health/DatabaseHealthIndicator') {
    /** The indicator's name in the payload. */
    static readonly NAME = 'database'

    static readonly live = class DatabaseHealthIndicatorImpl implements HealthIndicatorShape {
        constructor(
            private readonly pool: Pool | null | undefined = undefined
        ) {}

        check(): Effect.Effect<IndicatorResult> {
            const name = DatabaseHealthIndicator.NAME
            const pool = this.pool
            return Effect.gen(function* () {
                const check = indicatorFor(name)

                // `@Optional()` used to yield `undefined` (not `null`) when no pool was bound — both must be
                // rejected, or the check would report a TypeError instead of the actionable cause.
                if (pool === undefined || pool === null) {
                    return check.down({
                        message: 'no database pool is bound to this service',
                        hint: "declare DatabaseModule in the service's root module",
                    })
                }

                const started = Date.now()
                const outcome = yield* Effect.result(
                    Effect.tryPromise({
                        try: () =>
                            pool.query<
                                { version: string } & Record<string, unknown>
                            >('SELECT version() AS version'),
                        catch: (error) => error,
                    })
                )

                if (outcome._tag === 'Failure') {
                    const cause: unknown = outcome.failure
                    const message =
                        cause instanceof Error ? cause.message : String(cause)
                    return check.down({
                        message,
                        latencyMs: Date.now() - started,
                        // The classification the operator actually needs: "refused" and
                        // "wrong password" have different fixes.
                        cause: classifyDatabaseError(message),
                    })
                }

                const version = outcome.success.rows[0]?.version

                // The server banner is long ("PostgreSQL 16.4 (Debian …) on x86_64…");
                // the product + version is the useful part.
                const shortVersion =
                    typeof version === 'string'
                        ? version.split(' ').slice(0, 2).join(' ') || version
                        : 'unknown'

                return check.up({
                    latencyMs: Date.now() - started,
                    version: shortVersion,
                })
            })
        }
    }
}

/** A short, actionable classification of a Postgres connection failure. */
function classifyDatabaseError(message: string): string {
    if (message.includes('ECONNREFUSED'))
        return 'connection refused — is the database running?'
    if (message.includes('ETIMEDOUT') || /timeout/i.test(message))
        return 'connection timed out — check network/firewall'
    if (message.includes('ENOTFOUND'))
        return 'hostname did not resolve — check DNS'
    if (/password|authentication/i.test(message))
        return 'authentication failed — check credentials'
    if (/does not exist/i.test(message)) return 'database does not exist'
    return 'database error'
}
