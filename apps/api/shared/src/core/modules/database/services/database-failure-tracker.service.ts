import { Logger } from '@nestjs/common'
import { Context, Effect } from 'effect'

import { AppLifecyclePhase, type AppLifecycleShape } from '@deployer/lifecycle'
import type { ServiceLifecycleShape } from '@deployer/nest-effect'

import type { Pool } from 'pg'

export type DatabaseFailureTrackerShape = ServiceLifecycleShape & {
    /** Counts a database failure; the fifth in a row moves the lifecycle to DEGRADED and schedules a recovery probe. */
    readonly recordFailure: (pool: Pool) => void
    /** Resets the count, and leaves DEGRADED if the platform was in it. */
    readonly recordSuccess: () => void
}

const THRESHOLD = 5

/** An observer, not a flow: it is called from the pool's error edge, which is synchronous. */
export function makeDatabaseFailureTracker(
    lifecycle: Pick<AppLifecycleShape, 'stateNow' | 'transitionNow'>
): DatabaseFailureTrackerShape {
    const logger = new Logger('DatabaseFailureTracker')
    let failureCount = 0
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null

    const recordSuccess = (): void => {
        failureCount = 0
        if (lifecycle.stateNow().phase === AppLifecyclePhase.DEGRADED) {
            lifecycle.transitionNow(AppLifecyclePhase.READY, {
                databaseReachable: true,
            })
        }
        if (recoveryTimer) {
            clearTimeout(recoveryTimer)
            recoveryTimer = null
        }
    }

    const scheduleRecovery = (pool: Pool): void => {
        const delay = Math.min(
            2_000 * Math.pow(2, failureCount - THRESHOLD),
            30_000
        )
        recoveryTimer = setTimeout(() => {
            void (async () => {
                try {
                    const client = await pool.connect()
                    await client.query('SELECT 1')
                    client.release()
                    recordSuccess()
                } catch {
                    scheduleRecovery(pool)
                }
            })()
        }, delay)
    }

    return {
        recordFailure: (pool) => {
            failureCount++
            if (
                failureCount >= THRESHOLD &&
                lifecycle.stateNow().phase !== AppLifecyclePhase.DEGRADED
            ) {
                logger.warn(
                    `🚨 ${String(failureCount)} consecutive DB failures — entering degraded mode`
                )
                lifecycle.transitionNow(AppLifecyclePhase.DEGRADED, {
                    error: `${String(failureCount)} consecutive database failures`,
                    databaseReachable: false,
                })
                scheduleRecovery(pool)
            }
        },
        recordSuccess,
        // A pending recovery probe must not outlive the application.
        onStop: () =>
            Effect.sync(() => {
                if (recoveryTimer) {
                    clearTimeout(recoveryTimer)
                    recoveryTimer = null
                }
            }),
    }
}

export class DatabaseFailureTracker extends Context.Service<
    DatabaseFailureTracker,
    DatabaseFailureTrackerShape
>()('shared/DatabaseFailureTracker') {}
