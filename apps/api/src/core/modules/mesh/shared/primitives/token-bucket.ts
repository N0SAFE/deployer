import type { Clock } from "./clock";

/**
 * Algorithme Token Bucket pour rate limiting.
 *  tokens(t) = min(C, tokens(t-1) + r * Δt)
 */
export class TokenBucket {
    private tokens: number;
    private lastRefillMs: number;

    constructor(
        private readonly clock: Clock,
        private readonly capacity: number,
        private readonly refillTokensPerSecond: number,
    ) {
        this.tokens = capacity;
        this.lastRefillMs = clock.nowMs();
    }

    tryConsume(amount = 1): boolean {
        this.refill();
        if (this.tokens < amount) return false;
        this.tokens -= amount;
        return true;
    }

    available(): number { this.refill(); return this.tokens; }

    private refill(): void {
        const now = this.clock.nowMs();
        const elapsedSec = (now - this.lastRefillMs) / 1000;
        if (elapsedSec <= 0) return;
        this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillTokensPerSecond);
        this.lastRefillMs = now;
    }
}