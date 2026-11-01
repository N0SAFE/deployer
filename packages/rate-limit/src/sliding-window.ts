import { Context, Effect, Layer } from "effect";

export type RateLimitDecision =
	| { readonly allowed: true; readonly remaining: number }
	/** `retryAfterMs`: how long until the oldest request leaves the window and one more is allowed. */
	| { readonly allowed: false; readonly retryAfterMs: number };

export type SlidingWindowOptions = {
	/** Sliding window length in milliseconds. */
	readonly windowMs: number;
	/** Maximum requests per window per key. */
	readonly max: number;
	/** The clock, in epoch milliseconds. */
	readonly now?: () => number;
};

export type RateLimiterShape = {
	/** Counts one request from `key` and says whether it may proceed. A refused request is not counted. */
	readonly consume: (key: string) => Effect.Effect<RateLimitDecision>;
	/** `consume`, synchronously, for a middleware that has to answer inline. */
	readonly consumeNow: (key: string) => RateLimitDecision;
	/** How many keys are being tracked (clients with a request still inside the window). */
	readonly tracked: () => number;
};

export class RateLimiter extends Context.Service<RateLimiter, RateLimiterShape>()("rate-limit/RateLimiter") {
	static readonly layer = (options: SlidingWindowOptions) => Layer.sync(RateLimiter, () => makeSlidingWindowLimiter(options));
}

/**
 * An in-process sliding-window limiter: a key may make `max` requests in any `windowMs`.
 *
 * Process-local by design. For the single-node self-hosted deployment this platform targets that IS the
 * correct scope: a shared store would add a round trip per request to enforce a limit one process already
 * enforces exactly. It becomes wrong the moment the platform runs multi-node, and the fix then is to swap
 * the store, not to widen this one.
 *
 * Keys whose requests have all left the window are forgotten, so the map stays the size of the clients
 * active in one window instead of every client ever seen.
 */
export function makeSlidingWindowLimiter(options: SlidingWindowOptions): RateLimiterShape {
	const { windowMs, max, now = Date.now } = options;
	const buckets = new Map<string, number[]>();
	let sweptAtMs = now();

	/** Drops idle keys, at most once per window: a request is O(its own bucket), the sweep is amortized. */
	const sweep = (at: number): void => {
		if (at - sweptAtMs < windowMs) return;
		sweptAtMs = at;
		for (const [key, timestamps] of buckets) {
			if (timestamps.every((timestamp) => at - timestamp >= windowMs)) buckets.delete(key);
		}
	};

	const consumeNow = (key: string): RateLimitDecision => {
		const at = now();
		sweep(at);
		const recent = (buckets.get(key) ?? []).filter((timestamp) => at - timestamp < windowMs);
		if (recent.length >= max) {
			buckets.set(key, recent);
			const oldest = recent[0] ?? at;
			return { allowed: false, retryAfterMs: Math.max(0, windowMs - (at - oldest)) };
		}
		recent.push(at);
		buckets.set(key, recent);
		return { allowed: true, remaining: max - recent.length };
	};

	return {
		consume: (key) => Effect.sync(() => consumeNow(key)),
		consumeNow,
		tracked: () => buckets.size,
	};
}
