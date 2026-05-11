import { SlidingDedupWindow } from "../../shared/primitives/sliding-dedup-window";
import type { Clock } from "../../shared/primitives/clock";

/**
 * Store de déduplication spécialisé pour les événements mesh-topic.
 *
 * Compose deux mécanismes :
 *  1. SlidingDedupWindow  — dédup par eventId (at-least-once → effectively-once)
 *  2. aggregateProgress   — ordering par sequence/version par agrégat
 *
 * La compaction TTL + maxEntries des eventIds est déléguée à SlidingDedupWindow.
 */
export class MeshTopicDedupStore {
    private readonly processedEvents: SlidingDedupWindow;
    private readonly aggregateProgress = new Map<
        string,
        { sequence?: number; version?: number; updatedAt: number }
    >();

    constructor(
        clock: Clock,
        private readonly retentionMs = 6 * 60 * 60 * 1000,
        private readonly maxEntries = 20_000,
    ) {
        this.processedEvents = new SlidingDedupWindow(clock, retentionMs, maxEntries);
    }

    // ─── Event dedup ──────────────────────────────────────────────────────────

    /**
     * Vérifie si l'eventId est nouveau ET l'enregistre atomiquement.
     *
     * Retourne `true`  si l'event est nouveau (doit être traité).
     * Retourne `false` si l'event a déjà été vu (doit être ignoré).
     *
     * Sémantique identique à SlidingDedupWindow.checkAndRecord().
     */
    checkAndMarkProcessed(eventId: string): boolean {
        return this.processedEvents.checkAndRecord(eventId);
    }

    // ─── Aggregate ordering ───────────────────────────────────────────────────

    /**
     * Retourne `true` si l'événement est hors-ordre et doit être ignoré.
     */
    isOutOfOrder(
        aggregateKey: string,
        progress: { sequence?: number; version?: number },
    ): boolean {
        this.compactAggregate();
        const existing = this.aggregateProgress.get(aggregateKey);
        if (!existing) return false;

        if (
            typeof progress.sequence === "number" &&
            typeof existing.sequence === "number" &&
            progress.sequence <= existing.sequence
        ) {
            return true;
        }

        if (
            typeof progress.version === "number" &&
            typeof existing.version === "number" &&
            progress.version <= existing.version
        ) {
            return true;
        }

        return false;
    }

    markAggregateProgress(
        aggregateKey: string,
        progress: { sequence?: number; version?: number },
    ): void {
        this.compactAggregate();
        const existing = this.aggregateProgress.get(aggregateKey);
        this.aggregateProgress.set(aggregateKey, {
            sequence:
                typeof progress.sequence === "number"
                    ? Math.max(progress.sequence, existing?.sequence ?? Number.MIN_SAFE_INTEGER)
                    : existing?.sequence,
            version:
                typeof progress.version === "number"
                    ? Math.max(progress.version, existing?.version ?? Number.MIN_SAFE_INTEGER)
                    : existing?.version,
            updatedAt: Date.now(),
        });
    }

    // ─── Compaction aggregate (TTL + LRU) ─────────────────────────────────────

    private compactAggregate(): void {
        const now = Date.now();
        const cutoff = now - this.retentionMs;

        for (const [key, entry] of this.aggregateProgress) {
            if (entry.updatedAt < cutoff) this.aggregateProgress.delete(key);
        }

        if (this.aggregateProgress.size > this.maxEntries) {
            const sorted = [...this.aggregateProgress.entries()].sort(
                (a, b) => a[1].updatedAt - b[1].updatedAt,
            );
            const overflow = this.aggregateProgress.size - this.maxEntries;
            for (let i = 0; i < overflow; i++) {
                const key = sorted[i]?.[0];
                if (key) this.aggregateProgress.delete(key);
            }
        }
    }
}