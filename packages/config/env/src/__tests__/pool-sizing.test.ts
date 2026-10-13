import { describe, expect, it } from 'vitest'
import { apiEnvSchema } from '../index'

/**
 * The global DB pool is created once per process, so `max` multiplies across the
 * whole fleet and has to stay under Postgres' `max_connections`.
 */
function poolSizingFrom(raw: Record<string, string>) {
    const env = apiEnvSchema.parse(raw)
    const max = env.GLOBAL_DB_POOL_MAX
    // Mirrors readPoolSizing() in global-database.module.ts.
    const min = Math.min(env.GLOBAL_DB_POOL_MIN, max)
    return {
        max,
        min,
        idleTimeoutMillis: env.GLOBAL_DB_POOL_IDLE_TIMEOUT_MS,
        connectionTimeoutMillis: env.GLOBAL_DB_POOL_CONNECTION_TIMEOUT_MS,
    }
}

describe('GLOBAL_DB_POOL_* sizing', () => {
    it('defaults to 10 per process, not the old hardcoded 50', () => {
        const s = poolSizingFrom({})
        expect(s.max).toBe(10)
        expect(s.max).not.toBe(50)
    })

    it('defaults min to 0 so idle processes hold no connections', () => {
        const s = poolSizingFrom({})
        expect(s.min).toBe(0)
        expect(s.min).not.toBe(2)
    })

    it('honours an explicit max (services can shrink to 5)', () => {
        expect(poolSizingFrom({ GLOBAL_DB_POOL_MAX: '5' }).max).toBe(5)
    })

    it('clamps min to max when min is configured above it', () => {
        const s = poolSizingFrom({ GLOBAL_DB_POOL_MAX: '3', GLOBAL_DB_POOL_MIN: '9' })
        expect(s.min).toBe(3)
        expect(s.min).toBeLessThanOrEqual(s.max)
    })

    it('keeps the whole fleet under Postgres max_connections', () => {
        // BFF + 5 services + api + setup = 8 pools at the default.
        const fleetConnections = poolSizingFrom({}).max * 8
        expect(fleetConnections).toBeLessThanOrEqual(100)
    })

    it('allows overriding the idle and connection timeouts', () => {
        const s = poolSizingFrom({
            GLOBAL_DB_POOL_IDLE_TIMEOUT_MS: '5000',
            GLOBAL_DB_POOL_CONNECTION_TIMEOUT_MS: '2000',
        })
        expect(s.idleTimeoutMillis).toBe(5000)
        expect(s.connectionTimeoutMillis).toBe(2000)
    })

    it('rejects a max of 0', () => {
        expect(() => poolSizingFrom({ GLOBAL_DB_POOL_MAX: '0' })).toThrow()
    })
})
