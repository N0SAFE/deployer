import { Context, Effect } from 'effect'

import { serviceOver, type Over } from '@deployer/effect-core'

import {
    GithubAppsStore,
    type GithubAppsStoreShape,
} from '../repositories/github-apps.repository'

/**
 * Durable webhook idempotency.
 *
 * The database is the authority: the unique index on `github_webhook_events.delivery_id` makes the
 * first INSERT the atomic claim, and a redelivery (same `delivery_id`, e.g. after a process restart)
 * conflicts and is skipped. The in-memory `seen` set is a bounded fast-path cache for the same-process
 * hot path; it is advisory only and never the source of truth.
 */
const CACHE_MAX_SIZE = 10_000

type Ports = { readonly store: GithubAppsStoreShape }

function makeWebhookIdempotencyService({ store }: Ports, seen: Set<string>) {
    const markSeen = (deliveryId: string) =>
        Effect.sync(() => {
            seen.add(deliveryId)
            if (seen.size > CACHE_MAX_SIZE) {
                const first = seen.values().next().value
                if (first !== undefined) seen.delete(first)
            }
        })

    return {
        /** Fast path: was this delivery already seen in-process? */
        isDuplicate: (deliveryId: string) =>
            Effect.sync(() => seen.has(deliveryId)),

        /** Remember a delivery in the in-process cache (the cache only; see `claim` for the durable record). */
        markSeen,

        /**
         * Durable claim against the database. Answers `true` when THIS delivery was claimed (first time)
         * and `false` when it is a duplicate: already seen in-process, or already checkpointed, including
         * from a previous process lifetime.
         */
        claim: Effect.fn('WebhookIdempotencyService.claim')(function* (
            deliveryId: string,
            event: string,
            payload: unknown
        ) {
            if (seen.has(deliveryId)) return false
            const claimed = yield* store.claimWebhookDelivery({
                deliveryId,
                event,
                payload,
            })
            if (claimed) yield* markSeen(deliveryId)
            return claimed
        }),

        /** Forget every delivery held in-process. */
        clear: () =>
            Effect.sync(() => {
                seen.clear()
            }),
    }
}

export type WebhookIdempotencyServiceShape = Over<
    ReturnType<typeof makeWebhookIdempotencyService>,
    GithubAppsStore
>

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class WebhookIdempotencyService extends Context.Service<
    WebhookIdempotencyService,
    WebhookIdempotencyServiceShape
>()('fleet/WebhookIdempotencyService') {
    /** The store is yielded when a method runs; the delivery cache is one value created here, shared by every call. */
    static readonly live: WebhookIdempotencyServiceShape = (() => {
        const seen = new Set<string>()
        return serviceOver(Effect.all({ store: GithubAppsStore }), (ports) =>
            makeWebhookIdempotencyService(ports, seen)
        )
    })()
}
