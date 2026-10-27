import type { Clock } from "./clock";

/**
 * Fenêtre glissante de déduplication par clé d'idempotence.
 * Borne la mémoire en évinçant les entrées plus vieilles que TTL.
 */
export class SlidingDedupWindow {
    private readonly seen = new Map<string, number>();

    constructor(
        private readonly clock: Clock,
        private readonly ttlMs = 24 * 60 * 60 * 1000,
        private readonly maxEntries = 100_000,
    ) {}

    /** Retourne true si la clé est nouvelle, false si dupliquée. */
    checkAndRecord(key: string): boolean {
        this.evictExpired();
        if (this.seen.has(key)) return false;
        if (this.seen.size >= this.maxEntries) this.evictOldest();
        this.seen.set(key, this.clock.nowMs());
        return true;
    }

    has(key: string): boolean {
        this.evictExpired();
        return this.seen.has(key);
    }

    size(): number { return this.seen.size; }

    private evictExpired(): void {
        const cutoff = this.clock.nowMs() - this.ttlMs;
        for (const [key, ts] of this.seen) {
            if (ts < cutoff) this.seen.delete(key);
            else break;
        }
    }

    private evictOldest(): void {
        const firstKey = this.seen.keys().next().value;
        if (firstKey !== undefined) this.seen.delete(firstKey);
    }
}