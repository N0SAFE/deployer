/**
 * Preview TTL Cleanup Service
 *
 * Periodically expires preview environments whose `expiresAt` has passed
 * (default TTL set at provision time — 7 days). For each expired preview it
 * deactivates the traefik route, removes the DNS record, and marks the row
 * inactive via PreviewProvisioningService.
 *
 * `runCleanup` is the Effect service; the cadence is a registration (`startPreviewTtlCleanup`) the
 * module calls once when it is built: one fiber on the app's `EffectHost`, matching
 * `startIngressDnsReconciler`. Interval is fixed at 10 minutes.
 */
import { Context, Effect, Schedule } from 'effect'

import type { EffectHostShape } from '@deployer/nest-effect'
import type { RequirementsOf } from '@deployer/effect-core'

import { Logger } from '@nestjs/common'

import { describeFailure, recover } from '@/core/effects'

import {
    PreviewProvisioningService,
    type PreviewProvisioningServiceShape,
} from './preview-provisioning.service'

export const TTL_CLEANUP_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

/** What expiring a preview reads: the provisioning service and what its operations read in turn. */
type CleanupRequirements =
    | PreviewProvisioningService
    | RequirementsOf<PreviewProvisioningServiceShape>

/** The scheduled sweep: expire every preview whose TTL has passed. */
export type PreviewTtlCleanupServiceShape = {
    readonly runCleanup: () => Effect.Effect<void, never, CleanupRequirements>
}

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class PreviewTtlCleanupService extends Context.Service<
    PreviewTtlCleanupService,
    PreviewTtlCleanupServiceShape
>()('fleet/PreviewTtlCleanupService') {
    static readonly live = class PreviewTtlCleanupServiceImpl
        implements PreviewTtlCleanupServiceShape
    {
        /**
         * Expire every preview whose TTL has passed. One preview failing is logged and the next one
         * still runs; the run itself never fails.
         */
        runCleanup(): ReturnType<
            PreviewTtlCleanupServiceShape['runCleanup']
        > {
            return Effect.asVoid(
                recover(
                    Effect.gen(function* () {
                        const provisioning = yield* PreviewProvisioningService
                        const expired = yield* provisioning.findExpiredPreviews()
                        for (const preview of expired) {
                            yield* recover(
                                provisioning.expirePreview(
                                    preview.id,
                                    preview.serviceId,
                                    preview.previewName
                                ),
                                (error) =>
                                    Effect.logWarning(
                                        `Failed to expire preview ${preview.fullDomain}: ${describeFailure(error)}`
                                    )
                            )
                            yield* Effect.logInfo(
                                `Expired preview cleaned: ${preview.fullDomain}`
                            )
                        }
                    }),
                    (error) =>
                        Effect.logWarning(
                            `Preview TTL cleanup run failed: ${describeFailure(error)}`
                        )
                )
            )
        }
    }
}

export const PREVIEW_TTL_CLEANUP = Symbol('fleet:preview-ttl-cleanup')

/**
 * The fiber is forked while the module is still being built, when the Effect context is not populated yet:
 * the first run failed with `Cannot destructure property 'db' from null`. Waiting a moment lets the
 * application finish starting.
 */
const STARTUP_DELAY_MS = 10_000

/**
 * Schedules the cleanup when the module is built and stops it with the application. The handle it
 * returns carries the shutdown hook, which Nest calls on a provider's instance whatever built it;
 * stopping interrupts the fiber and awaits it.
 */
export function startPreviewTtlCleanup(
    host: EffectHostShape,
    intervalMs: number = TTL_CLEANUP_INTERVAL_MS,
    initialDelayMs: number = STARTUP_DELAY_MS
) {
    const logger = new Logger('PreviewTtlCleanup')
    const stop = host.fork(
        'fleet/preview-ttl-cleanup',
        Effect.sleep(initialDelayMs).pipe(
            Effect.andThen(
                Effect.repeat(
                    recover(
                        Effect.gen(function* () {
                            const cleanup = yield* PreviewTtlCleanupService
                            yield* cleanup.runCleanup()
                        }),
                        (error) =>
                            Effect.sync(() => {
                                logger.warn(
                                    `Preview TTL cleanup run failed: ${describeFailure(error)}`
                                )
                            })
                    ),
                    Schedule.spaced(intervalMs)
                )
            )
        )
    )
    logger.log(
        `Preview TTL cleanup scheduled every ${String(intervalMs / 60000)} minutes`
    )

    return {
        async onModuleDestroy(): Promise<void> {
            await stop()
        },
    }
}
