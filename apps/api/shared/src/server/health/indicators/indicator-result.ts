import type { IndicatorResult } from '../types'
import type { Effect } from 'effect'

/**
 * The result builder every check uses: `indicatorFor("memory").up({ heapRatio })`.
 *
 * Terminus' `HealthIndicatorService` did exactly this and nothing else, so the platform keeps the shape and drops the
 * dependency: a check reports `{ <name>: { status, …detail } }` and the registry does the rest.
 */
export const indicatorFor = (name: string) => ({
    up: (detail: Record<string, unknown> = {}): IndicatorResult => ({
        [name]: { status: 'up', ...detail },
    }),
    down: (detail: Record<string, unknown> = {}): IndicatorResult => ({
        [name]: { status: 'down', ...detail },
    }),
})

/**
 * What a health check is, as an Effect service.
 *
 * A check is I/O against one dependency, so it returns an Effect the registry runs concurrently with a timeout — and it
 * never fails: a dependency that is down is a `down` result, which is the diagnosis the caller came for.
 */
export type HealthIndicatorShape = {
    readonly check: () => Effect.Effect<IndicatorResult>
}
