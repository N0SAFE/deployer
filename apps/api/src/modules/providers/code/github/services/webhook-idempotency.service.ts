import { Injectable, Optional } from "@nestjs/common";
import type { GithubAppsRepository } from "../repositories/github-apps.repository";

/**
 * W-P2 (durable idempotency) — replaces the in-memory-only LRU.
 *
 * The DB is the authority: the unique index on `github_webhook_events.delivery_id`
 * makes the first INSERT the atomic claim, and a redelivery (same `delivery_id`,
 * e.g. after a process restart) conflicts and is skipped. The in-memory `seen`
 * set is a bounded fast-path cache for the same-process hot path; it is
 * advisory only and never the source of truth.
 */
const CACHE_MAX_SIZE = 10_000;

@Injectable()
export class WebhookIdempotencyService {
    private readonly seen = new Set<string>();

    constructor(
        @Optional() private readonly githubAppsRepository?: GithubAppsRepository,
    ) {}

    /** Fast-path: was this delivery already seen in-process? */
    isDuplicate(deliveryId: string): boolean {
        return this.seen.has(deliveryId);
    }

    /** Keep the legacy sync markSeen API for the fast-path (cache only). */
    markSeen(deliveryId: string): void {
        this.seen.add(deliveryId);
        if (this.seen.size > CACHE_MAX_SIZE) {
            const first = this.seen.values().next().value;
            if (first !== undefined) {
                this.seen.delete(first);
            }
        }
    }

    /**
     * Durable claim against the DB. Returns `true` when THIS delivery was
     * claimed (first time) and `false` when it is a duplicate (already
     * checkpointed — including from a previous process lifetime).
     */
    async claim(deliveryId: string, event: string, payload: unknown): Promise<boolean> {
        if (this.isDuplicate(deliveryId)) {
            return false;
        }

        if (!this.githubAppsRepository) {
            // No DB available (unit isolations / degraded boot): fall back to the
            // bounded in-memory cache so behavior is preserved per-process.
            this.markSeen(deliveryId);
            return true;
        }

        const claimed = await this.githubAppsRepository.claimWebhookDelivery({
            deliveryId,
            event,
            payload,
        });
        if (claimed) {
            this.markSeen(deliveryId);
        }
        return claimed;
    }

    clear(): void {
        this.seen.clear();
    }
}
