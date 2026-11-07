import { Context, Effect } from 'effect'

import type { RequirementsOf } from '@deployer/effect-core'

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

export type WebhookIdempotencyServiceShape = {
    /** Fast path: was this delivery already seen in-process? */
    readonly isDuplicate: (deliveryId: string) => Effect.Effect<boolean>
    /** Remember a delivery in the in-process cache (the cache only; see `claim` for the durable record). */
    readonly markSeen: (deliveryId: string) => Effect.Effect<void>
    /**
     * Durable claim against the database. Answers `true` when THIS delivery was claimed (first time)
     * and `false` when it is a duplicate: already seen in-process, or already checkpointed, including
     * from a previous process lifetime.
     */
    readonly claim: (
        deliveryId: string,
        event: string,
        payload: unknown
    ) => Effect.Effect<
        boolean,
        unknown,
        GithubAppsStore | RequirementsOf<GithubAppsStoreShape>
    >
    /** Forget every delivery held in-process. */
    readonly clear: () => Effect.Effect<void>
}

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class WebhookIdempotencyService extends Context.Service<
    WebhookIdempotencyService,
    WebhookIdempotencyServiceShape
>()('fleet/WebhookIdempotencyService') {
    static readonly live = class WebhookIdempotencyServiceImpl
        implements WebhookIdempotencyServiceShape
    {
        /** The delivery cache is one value for the process, shared by every call. */
        readonly #seen = new Set<string>()

        isDuplicate(
            deliveryId: string
        ): ReturnType<WebhookIdempotencyServiceShape['isDuplicate']> {
            return Effect.sync(() => this.#seen.has(deliveryId))
        }

        markSeen(
            deliveryId: string
        ): ReturnType<WebhookIdempotencyServiceShape['markSeen']> {
            return Effect.sync(() => {
                this.#seen.add(deliveryId)
                if (this.#seen.size > CACHE_MAX_SIZE) {
                    const first = this.#seen.values().next().value
                    if (first !== undefined) this.#seen.delete(first)
                }
            })
        }

        claim(
            deliveryId: string,
            event: string,
            payload: unknown
        ): ReturnType<WebhookIdempotencyServiceShape['claim']> {
            return Effect.gen({ self: this }, function* () {
                if (this.#seen.has(deliveryId)) return false
                const store = yield* GithubAppsStore
                const claimed = yield* store.claimWebhookDelivery({
                    deliveryId,
                    event,
                    payload,
                })
                if (claimed) yield* this.markSeen(deliveryId)
                return claimed
            })
        }

        clear(): ReturnType<WebhookIdempotencyServiceShape['clear']> {
            return Effect.sync(() => {
                this.#seen.clear()
            })
        }
    }
}
