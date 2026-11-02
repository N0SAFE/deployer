import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'

import { pushContract } from '@deployer/identity-contracts'
import { procedure } from '@deployer/nest-effect'
import { requireAuth } from '@deployer/shared/core/modules/auth/orpc/middlewares'

import { serve } from '@identity/core/orpc/serve'

import { pushRules } from '../domain/push.rules'
import { PushService } from '../services/push.service'

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
        return procedure(pushContract.getPublicKey)
            .use(requireAuth())
            .effect(function* ({ context }) {
                const push = yield* PushService
                return yield* serve(context)(push.publicKey())
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
        return procedure(pushContract.subscribe)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const push = yield* PushService
                return yield* serve(context)(push.subscribe(input))
            })
    }

    /** Remove this caller's device, by endpoint. */
    @Implement(pushContract.unsubscribe)
    unsubscribe() {
        return procedure(pushContract.unsubscribe)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const push = yield* PushService
                return yield* serve(context)(push.unsubscribe(input.endpoint))
            })
    }

    /** This caller's active devices. */
    @Implement(pushContract.getSubscriptions)
    getSubscriptions() {
        return procedure(pushContract.getSubscriptions)
            .use(requireAuth())
            .effect(function* ({ context }) {
                const push = yield* PushService
                const subscriptions = yield* serve(context)(push.list())
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
        return procedure(pushContract.getStats)
            .use(requireAuth())
            .effect(function* ({ context }) {
                const push = yield* PushService
                return yield* serve(context)(push.stats())
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
        return procedure(pushContract.sendTestNotification)
            .use(requireAuth())
            .effect(function* ({ context }) {
                const push = yield* PushService

                const devices = yield* serve(context)(push.list())
                const deliverable = yield* serve(context)(
                    push.deliverableCount()
                )

                return pushRules.deliveryReport(devices.length, deliverable)
            })
    }
}
