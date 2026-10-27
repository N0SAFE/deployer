import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'
import { implement } from '@orpc/server'
import { EffectContextOf } from '@deployer/nest-effect'

import { PushDomainModule } from '../push.module'

import { pushContract } from '@deployer/identity-contracts'
import { requireAuth } from '@deployer/shared/core/modules/auth/orpc/middlewares'
import { actorFromContext } from '@identity/core/utils/actor.utils'

import { pushRules } from '../domain/push.rules'
import { PushService } from '../services/push.service'
import { mapPushFailures } from './push.error-mapper'

/**
 * The push domain's oRPC surface.
 *
 * ── A CONTROLLER CONTAINS NO RULE ───────────────────────────────────────────
 * Each method binds a contract procedure, takes the actor from the context, and
 * delegates. Reading it tells you which procedures exist and what they call.
 *
 * ── WHY THE CONTRACT IS IMPORTED, NOT RE-DECLARED ───────────────────────────
 * `pushContract` is the SAME object the BFF composes, so the public URL cannot drift
 * from what this service serves.
 *
 * ── WHY EVERY PROCEDURE IS AUTHENTICATED ────────────────────────────────────
 * A subscription belongs to an account, and so do the VAPID keys it is delivered
 * with. There is no anonymous push operation: `getPublicKey` is scoped to the
 * CALLER's keypair, because a shared keypair would let any sender impersonate this
 * service to any subscriber.
 */
@Controller()
export class PushController {
    /** The VAPID public key this caller's browser should subscribe with. */
    @Implement(pushContract.getPublicKey)
    getPublicKey() {
        return implement(pushContract.getPublicKey)
            .use(requireAuth())
            .use(PushDomainModule[EffectContextOf])
            .effect(function* ({ context }) {
                const push = yield* PushService
                return yield* push
                    .publicKey(actorFromContext(context))
                    .pipe(mapPushFailures)
            })
    }

    /**
     * Register this caller's device.
     *
     * `userId` is NOT taken from the input: it comes from the authenticated actor,
     * because accepting it would let a caller register a device against somebody
     * else's account and receive their notifications.
     */
    @Implement(pushContract.subscribe)
    subscribe() {
        return implement(pushContract.subscribe)
            .use(requireAuth())
            .use(PushDomainModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const push = yield* PushService
                return yield* push
                    .subscribe(actorFromContext(context), input)
                    .pipe(mapPushFailures)
            })
    }

    /** Remove this caller's device, by endpoint. */
    @Implement(pushContract.unsubscribe)
    unsubscribe() {
        return implement(pushContract.unsubscribe)
            .use(requireAuth())
            .use(PushDomainModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const push = yield* PushService
                return yield* push
                    .unsubscribe(actorFromContext(context), input.endpoint)
                    .pipe(mapPushFailures)
            })
    }

    /** This caller's active devices. */
    @Implement(pushContract.getSubscriptions)
    getSubscriptions() {
        return implement(pushContract.getSubscriptions)
            .use(requireAuth())
            .use(PushDomainModule[EffectContextOf])
            .effect(function* ({ context }) {
                const push = yield* PushService
                const subscriptions = yield* push
                    .list(actorFromContext(context))
                    .pipe(mapPushFailures)
                return { subscriptions }
            })
    }

    /**
     * This caller's subscription statistics.
     *
     * The repository's rows carry more (keys, user agent) and are deliberately not
     * forwarded, because key material has no business in a stats response.
     */
    @Implement(pushContract.getStats)
    getStats() {
        return implement(pushContract.getStats)
            .use(requireAuth())
            .use(PushDomainModule[EffectContextOf])
            .effect(function* ({ context }) {
                const push = yield* PushService
                return yield* push
                    .stats(actorFromContext(context))
                    .pipe(mapPushFailures)
            })
    }

    /**
     * Report the outcome of a test notification.
     *
     * ── WHY THIS IS NOT A SEND ──────────────────────────────────────────────
     * The contract declares `{ success, failed, total }` — a DELIVERY REPORT. The
     * sending itself needs the web-push transport and a VAPID keypair per user, so the
     * transport performs it and reports back here; this service owns the durable
     * consequence (an endpoint the push service rejected is retired so the next send
     * does not waste a call on it).
     */
    @Implement(pushContract.sendTestNotification)
    sendTestNotification() {
        return implement(pushContract.sendTestNotification)
            .use(requireAuth())
            .use(PushDomainModule[EffectContextOf])
            .effect(function* ({ context }) {
                const push = yield* PushService
                const actor = actorFromContext(context)

                const devices = yield* push.list(actor).pipe(mapPushFailures)
                const deliverable = yield* push
                    .deliverableCount()
                    .pipe(mapPushFailures)

                return pushRules.deliveryReport(devices.length, deliverable)
            })
    }
}
