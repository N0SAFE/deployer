import { os } from "@orpc/server";
import { domainErrorOptions, standardDomainErrorPayloadSchema } from "@deployer/orpc-utils";

/**
 * Minimal context contract — the runtime provides `request` on every call (set as the
 * initial context by `ORPCModule`).
 */
export interface RequestContext {
	request: globalThis.Request;
}

export interface RateLimitOptions {
	/** Sliding window length in milliseconds. */
	windowMs: number;
	/** Maximum requests per window per key. */
	max: number;
	/** Human-readable message sent to the client. */
	message?: string;
}

interface RateLimitBucketEntry {
	timestamps: number[];
}

/**
 * Read a request header across transports.
 *
 * The ORPC context `request` is a fetch `Request` under the HTTP gateway but an Express
 * `Request` in the e2e runtime (and possibly other adapters) — their header stores differ,
 * and Express repeats a header as an ARRAY rather than joining it. Handling all three is
 * what stops an app-instance token silently reading as absent in one runtime and present in
 * another.
 */
export function readHeader(request: unknown, name: string): string | null {
	const headers = (request as { headers?: unknown } | null | undefined)?.headers;
	if (headers instanceof Headers) return headers.get(name);
	if (typeof headers === "object" && headers !== null) {
		const record = headers as Record<string, unknown>;
		const value = record[name] ?? record[name.toLowerCase()];
		if (typeof value === "string") return value;
		if (Array.isArray(value)) {
			const first = value.find((entry): entry is string => typeof entry === "string");
			return first ?? null;
		}
	}
	return null;
}

/**
 * In-process sliding-window rate limiter, keyed by the first `x-forwarded-for` hop.
 *
 * ── WHY THIS IS IN CORE AND NOT IN A DOMAIN ─────────────────────────────────
 * It was written for the platform's app-instance registration and lived in that module's
 * `orpc/middlewares`. The health surface needs the same limiter, and two implementations of
 * "how many requests may you make" is how one endpoint ends up protected and another does
 * not. It is infrastructure with no domain vocabulary, so core is where it belongs.
 *
 * ── WHY PROCESS-LOCAL, AND WHEN TO CHANGE IT ────────────────────────────────
 * The buckets are an in-memory `Map`. For the single-node self-hosted deployment this
 * platform targets that IS the correct scope — a shared store would add a Redis round trip
 * per request to enforce a limit that one process already enforces exactly. It becomes
 * wrong the moment the platform runs multi-node, and the fix at that point is to swap the
 * store, not to widen this one.
 *
 * ── WHY "unknown" IS A SHARED BUCKET ────────────────────────────────────────
 * A request with no `x-forwarded-for` cannot be attributed to a client. Keying them all on
 * `"unknown"` means unattributed traffic shares one budget rather than each getting its
 * own — the strict reading, and the one that cannot be bypassed by stripping the header.
 */
export function rateLimit(options: RateLimitOptions) {
	const buckets = new Map<string, RateLimitBucketEntry>();

	return os
		.$context<RequestContext>()
		.errors({
			TOO_MANY_REQUESTS: {
				message: "Too many requests",
				status: 429,
				data: standardDomainErrorPayloadSchema,
			},
		})
		.middleware(({ context, next, errors }) => {
			const forwarded = readHeader(context.request, "x-forwarded-for");
			const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
			const now = Date.now();
			const entry = buckets.get(ip) ?? { timestamps: [] };
			entry.timestamps = entry.timestamps.filter((ts) => now - ts < options.windowMs);

			if (entry.timestamps.length >= options.max) {
				throw errors.TOO_MANY_REQUESTS(
					domainErrorOptions(
						"TOO_MANY_REQUESTS",
						429,
						options.message ?? "Too many requests — try again later",
					),
				);
			}
			entry.timestamps.push(now);
			buckets.set(ip, entry);

			return next({ context });
		});
}
