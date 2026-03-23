import { Injectable } from "@nestjs/common";

// T036: Webhook idempotency guard.
// Tracks seen delivery IDs to prevent duplicate-delivery side effects.
// Uses a bounded LRU-style eviction: once the cache reaches the max size,
// the oldest entry is evicted to prevent unbounded growth.

const MAX_SIZE = 10_000;

@Injectable()
export class WebhookIdempotencyService {
    private readonly seen = new Map<string, Date>();

    isDuplicate(deliveryId: string): boolean {
        return this.seen.has(deliveryId);
    }

    markSeen(deliveryId: string): void {
        if (this.seen.size >= MAX_SIZE) {
            // Evict the oldest entry (insertion-order iteration)
            const firstKey = this.seen.keys().next().value;
            if (firstKey !== undefined) {
                this.seen.delete(firstKey);
            }
        }
        this.seen.set(deliveryId, new Date());
    }

    clear(): void {
        this.seen.clear();
    }
}
