import { Context, Effect, Layer, Ref, Semaphore } from 'effect'

import type { SystemMetricsSnapshot } from '@deployer/contracts-entities'

import { systeminformationProbe, type MachineProbe } from './probe'
import { toSnapshot } from './snapshot'

import type { MetricsUnavailable } from './errors'

/** How long a snapshot is reused. */
export const DEFAULT_SNAPSHOT_TTL_MS = 15_000

export type SystemMetricsShape = {
    /**
     * The machine's current snapshot. A recent one is reused; `force` takes a fresh one. Callers that
     * arrive while a snapshot is being taken wait for that one instead of starting another, and a
     * failed sampling is never cached.
     */
    readonly snapshot: (options?: {
        readonly force?: boolean
    }) => Effect.Effect<SystemMetricsSnapshot, MetricsUnavailable>
}

export type SystemMetricsOptions = {
    readonly probe?: MachineProbe
    readonly ttlMs?: number
    /** The clock, in epoch milliseconds. */
    readonly now?: () => number
    /** This process's id, to pick it out of the process list. */
    readonly pid?: number
}

export class SystemMetrics extends Context.Service<
    SystemMetrics,
    SystemMetricsShape
>()('system-metrics/SystemMetrics') {
    static readonly layer = (options?: SystemMetricsOptions) =>
        Layer.sync(SystemMetrics, () => makeSystemMetrics(options))
}

export function makeSystemMetrics(
    options: SystemMetricsOptions = {}
): SystemMetricsShape {
    const {
        probe = systeminformationProbe,
        ttlMs = DEFAULT_SNAPSHOT_TTL_MS,
        now = Date.now,
        pid = process.pid,
    } = options
    const cache = Ref.makeUnsafe<{
        /** When the sampling started: what the TTL counts from. */
        readonly capturedAtMs: number
        /** When it finished: a caller that arrived before this shares it. */
        readonly completedAtMs: number
        readonly snapshot: SystemMetricsSnapshot
    } | null>(null)
    /** One sampling at a time: a caller that waits here finds the snapshot the first one took. */
    const oneAtATime = Semaphore.makeUnsafe(1)

    const fresh = (force: boolean, arrivedAtMs: number) =>
        Effect.gen(function* () {
            const cached = yield* Ref.get(cache)
            // A sampling that finished since this caller arrived is the one it was waiting for, forced or not.
            if (
                cached !== null &&
                (cached.completedAtMs >= arrivedAtMs ||
                    (!force && now() - cached.capturedAtMs < ttlMs))
            ) {
                return cached.snapshot
            }
            const startedAtMs = now()
            const readings = yield* probe
            const snapshot = toSnapshot(readings, pid, new Date())
            yield* Ref.set(cache, {
                capturedAtMs: startedAtMs,
                completedAtMs: now(),
                snapshot,
            })
            return snapshot
        })

    return {
        snapshot: (opts) => {
            const force = opts?.force ?? false
            const arrivedAtMs = now()
            return Effect.gen(function* () {
                // A fresh cache is answered at once, without queueing behind a sampling.
                const cached = yield* Ref.get(cache)
                if (
                    !force &&
                    cached !== null &&
                    now() - cached.capturedAtMs < ttlMs
                )
                    return cached.snapshot
                return yield* oneAtATime.withPermits(1)(
                    fresh(force, arrivedAtMs)
                )
            })
        },
    }
}
