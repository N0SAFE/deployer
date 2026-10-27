import { CurrentActor, type Ambient } from '@deployer/effect-core'
import { Context, Effect, Layer } from 'effect'
import { generateVAPIDKeys } from 'web-push'

import { actorFromCurrent } from '@identity/core/utils/actor.utils'

import {
    PushSubscriptionNotFound,
    type PushInvalid,
} from '../domain/push.errors'
import { pushRules } from '../domain/push.rules'
import type {
    PublicKey,
    PushStats,
    PushSubscription,
    SubscribeRequest,
    SubscribeResult,
} from '../domain/push.types'
import {
    PushRepository,
    type PushRepositoryShape,
} from '../repositories/push.repository'
import type { PushRepositoryFailure } from '../push.failures'
import { rule } from './push.service.utils'

/** What `recordDelivery` learns from the transport that actually sent. */
export type DeliveryOutcome = {
    readonly delivered: boolean
    readonly gone: boolean
}

/** What a push use case can fail with: its own refusals, or the database. */
export type PushFailure =
    PushInvalid | PushSubscriptionNotFound | PushRepositoryFailure

/**
 * Methods about "my devices" read `CurrentActor` (left open as `Ambient`); the two that act for the
 * platform, not a user (`deliverableCount`, `recordDelivery`), need nothing from the request.
 */
export type PushServiceShape = {
    readonly publicKey: () => Effect.Effect<PublicKey, PushFailure, Ambient>
    readonly subscribe: (
        request: SubscribeRequest
    ) => Effect.Effect<SubscribeResult, PushFailure, Ambient>
    readonly unsubscribe: (
        endpoint: string
    ) => Effect.Effect<{ readonly success: boolean }, PushFailure, Ambient>
    readonly list: () => Effect.Effect<PushSubscription[], PushFailure, Ambient>
    readonly stats: () => Effect.Effect<PushStats, PushFailure, Ambient>
    readonly deliverableCount: () => Effect.Effect<number, PushFailure>
    readonly recordDelivery: (
        id: string,
        outcome: DeliveryOutcome
    ) => Effect.Effect<void, PushFailure>
}

/** Tag and implementation together: the tag is the contract, `Live` the one implementation. */
export class PushService extends Context.Service<
    PushService,
    PushServiceShape
>()('identity/PushService') {
    /** Leaves `PushRepository` open, so a test swaps it without touching the database. */
    static readonly Live: Layer.Layer<PushService, never, PushRepository> =
        Layer.effect(
            PushService,
            Effect.gen(function* () {
                const subscriptions = yield* PushRepository
                return makePushService(subscriptions)
            })
        )
}

const actingUserId = Effect.gen(function* () {
    return actorFromCurrent(yield* CurrentActor).userId
})

/**
 * The push domain's use cases, composed as Effects.
 *
 * Rules stay synchronous and are lifted with `rule`; database work is an Effect from the
 * repository. Each refusal is a tagged `DomainError` the boundary maps by kind; a repository
 * failure is left unmapped on purpose.
 *
 * Not here: SQL (the repository), the HTTP shape (the controller), or the
 * notification PAYLOAD — composing what a message says is a caller's concern.
 */
export function makePushService(
    subscriptions: PushRepositoryShape
): PushServiceShape {
    /**
     * The VAPID public key this user's browser should subscribe with, generating the
     * keypair on first use.
     *
     * Lazy because a keypair is only needed once somebody subscribes: minting one at
     * signup would put a row and a keypair on every user for a feature most will not
     * use.
     */
    const publicKey = Effect.fn('PushService.publicKey')(function* () {
        const userId = yield* actingUserId
        const existing = yield* subscriptions.findVapidKeys(userId)
        if (existing !== null) return { publicKey: existing.publicKey }

        const generated = yield* rule(() => generateVAPIDKeys())
        const keys = yield* subscriptions.insertVapidKeys({
            userId,
            ...generated,
            // The VAPID spec requires a contact so a push service can report a
            // misbehaving sender. A `mailto:` with a local domain is deliberate: a
            // valid, unique principal that leaks no real address.
            subject: `mailto:user-${userId}@notifications.local`,
        })
        return { publicKey: keys.publicKey }
    })

    return {
        publicKey,

        /**
         * Register a device.
         *
         * The shapes are checked structurally (base64url, plausible length) rather than
         * cryptographically: this guards against a WRONG value, not a hostile one — the
         * push service is the authority on whether a keypair works. A malformed key would
         * otherwise fail at DELIVERY time, days later, as an opaque 400.
         */
        subscribe: Effect.fn('PushService.subscribe')(function* (request) {
            const userId = yield* actingUserId

            yield* rule(() => {
                pushRules.assertUsableEndpoint(request.endpoint)
                pushRules.assertUsableKey(request.keys.p256dh, 'p256dh', 60)
                pushRules.assertUsableKey(request.keys.auth, 'auth', 12)
            })

            // A subscription with no keypair cannot be delivered to, so storing one
            // first would create a row that looks live and silently cannot be used.
            yield* publicKey()

            const stored = yield* subscriptions.upsert({
                userId,
                endpoint: request.endpoint,
                p256dh: request.keys.p256dh,
                auth: request.keys.auth,
                deviceName: request.deviceName,
                userAgent: request.userAgent,
            })

            return {
                id: stored.id,
                deviceName: stored.deviceName,
                createdAt: stored.createdAt,
            }
        }),

        /**
         * Remove a device.
         *
         * The lookup and the delete are both keyed on the actor: checking in one then
         * deleting in the other would leave a window where a re-owned endpoint is deleted
         * by the previous holder, so the repository's delete carries the `userId` too.
         *
         * "Not yours" and "not found" return the SAME error, because distinguishing them
         * would confirm that an endpoint belongs to somebody else.
         */
        unsubscribe: Effect.fn('PushService.unsubscribe')(function* (endpoint) {
            const userId = yield* actingUserId

            const existing = yield* subscriptions.findByEndpoint(endpoint)
            if (existing === null || existing.userId !== userId) {
                return yield* new PushSubscriptionNotFound({ endpoint })
            }

            const deleted = yield* subscriptions.deleteByEndpointForUser(
                userId,
                endpoint
            )
            if (!deleted) return yield* new PushSubscriptionNotFound({ endpoint })
            return { success: true }
        }),

        /** This user's devices — active only, because a retired endpoint is not deliverable. */
        list: Effect.fn('PushService.list')(function* () {
            const userId = yield* actingUserId
            return yield* subscriptions.listByUser(userId, true)
        }),

        /**
         * This user's subscription statistics.
         *
         * Each figure is asked of the database for exactly the set it describes: `total`
         * counts every row while `devices` lists only active ones, so deriving the total
         * from the list would report a number that disagrees with the table.
         */
        stats: Effect.fn('PushService.stats')(function* () {
            const userId = yield* actingUserId

            const total = yield* subscriptions.countByUser(userId, false)
            const active = yield* subscriptions.countByUser(userId, true)
            const rows = yield* subscriptions.listByUser(userId, true)

            return {
                totalSubscriptions: total,
                activeSubscriptions: active,
                // `lastUsedAt ?? createdAt` rather than a null: the contract declares a
                // required date, and "never used" means "not used since registration".
                // `now()` would make an unused device look like the most recent one.
                devices: rows.map((row) => ({
                    deviceName: row.deviceName ?? 'Unknown Device',
                    lastUsed: row.lastUsedAt ?? row.createdAt,
                })),
            }
        }),

        /**
         * How many subscriptions could actually receive a notification right now.
         *
         * Activity is necessary and not sufficient: a subscription belonging to a banned
         * account must not be delivered to, and a ban does not flip the device rows.
         */
        deliverableCount: Effect.fn('PushService.deliverableCount')(
            function* () {
                return yield* subscriptions.countDeliverable()
            }
        ),

        /**
         * Record the outcome of a delivery the transport layer already performed.
         *
         * Speaking web-push means holding a VAPID keypair per user and interpreting the
         * push service's status codes. Keeping the OUTCOME here means the one piece of
         * knowledge that must persist (a retired endpoint) is recorded authoritatively.
         */
        recordDelivery: Effect.fn('PushService.recordDelivery')(function* (
            id,
            outcome
        ) {
            if (outcome.delivered) {
                yield* subscriptions.markUsed(id)
                return
            }
            if (outcome.gone) {
                yield* subscriptions.deactivate(id)
            }
        }),
    }
}
