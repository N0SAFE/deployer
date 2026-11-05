import { Logger } from '@nestjs/common'
import { Effect, Schedule } from 'effect'

import type { EffectHostShape } from '@deployer/nest-effect'

import { describeFailure, recover } from '@/core/effects'

import {
    DNS_RECONCILE_INTERVAL_MS,
    IngressEdgeService,
} from './ingress-edge.service'

export const INGRESS_DNS_RECONCILER = Symbol('fleet:ingress-dns-reconciler')

/**
 * The fiber is forked while the module is still being built, when the Effect context's ports are not
 * populated yet: the first run read `null` for the lanes port (`DNS reconcile skipped: null is not an
 * object`) and the next one was a full interval away. Waiting a moment lets the application finish starting.
 */
const STARTUP_DELAY_MS = 10_000

/**
 * Converges lane DNS on a cadence, because mesh and public addresses change on their own. The
 * ingress service is a constant with no lifetime, so the loop that outlives a request is a
 * registration the module calls once when it is built: one fiber on the app's `EffectHost`. The
 * handle it returns stops the loop with the application (Nest calls `onApplicationShutdown` on a
 * provider's instance whatever built it); stopping interrupts the fiber and awaits it.
 */
export function startIngressDnsReconciler(
    host: EffectHostShape,
    intervalMs: number = DNS_RECONCILE_INTERVAL_MS,
    initialDelayMs: number = STARTUP_DELAY_MS
) {
    const logger = new Logger('IngressDnsReconciler')
    const stop = host.fork(
        'fleet/ingress-dns-reconciler',
        Effect.sleep(initialDelayMs).pipe(
            Effect.andThen(
                Effect.repeat(
                    recover(
                        Effect.gen(function* () {
                            const ingress = yield* IngressEdgeService
                            yield* ingress.reconcileDns()
                        }),
                        (error) =>
                            Effect.sync(() => {
                                logger.warn(
                                    `DNS reconcile failed: ${describeFailure(error)}`
                                )
                            })
                    ),
                    Schedule.spaced(intervalMs)
                )
            )
        )
    )

    return {
        async onApplicationShutdown(): Promise<void> {
            await stop()
        },
    }
}
