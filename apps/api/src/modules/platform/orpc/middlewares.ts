/**
 * Platform ORPC middlewares.
 *
 * - `requireAppInstance(appInstances)` — verifies the X-App-Instance-Token
 *   header against the app_instances store and narrows the context with the
 *   instance identity. Follows the same DI-factory pattern as
 *   `requireAuth(auth)`: the middleware is the ONLY place that resolves the
 *   token, so after it runs `context.appInstance` is guaranteed non-null —
 *   handlers never check for absence.
 * - `rateLimit(options)` — generic sliding-window limiter keyed by client IP.
 *   No built-in exists in @orpc/server (verified 1.14.6), so this is the repo's
 *   single implementation; extract to core if a second consumer appears.
 */

import { os } from "@orpc/server";
import {
    domainErrorOptions,
    standardDomainErrorPayloadSchema,
    standardErrorOptions,
    STANDARD_DOMAIN_ERROR_DEFS,
} from "@repo/orpc-utils";

import type { AppInstanceService } from "@/core/modules/platform-ingress/services/app-instance.service";

/** Minimal context contract — the runtime provides `request` on every call
 *  (set as initial context by ORPCModule). */
export interface RequestContext {
	request: globalThis.Request;
}

/**
 * Read a request header across transports. The ORPC context `request` is a
 * fetch Request under the HTTP gateway but an Express Request in the e2e
 * runtime (and potentially other adapters) — their header stores differ.
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

/** Context extension produced by `requireAppInstance()`. */
export interface AppInstanceContext {
	appInstance: {
		id: string;
		label: string;
		kind: "managed" | "external";
	};
}

/**
 * Verifies the X-App-Instance-Token header and narrows the context with the
 * instance identity. Throws UNAUTHORIZED when the header is missing or the
 * token does not resolve — after this middleware runs, `context.appInstance`
 * is guaranteed present, so handlers never null-check it.
 */
export function requireAppInstance(appInstances: AppInstanceService) {
	return os
		.$context<RequestContext>()
		.errors(STANDARD_DOMAIN_ERROR_DEFS)
		.middleware(async ({ context, next, errors }) => {
			const rawToken = readHeader(context.request, "x-app-instance-token");
			if (rawToken === null || rawToken.length === 0) {
				throw errors.UNAUTHORIZED(
					standardErrorOptions("unauthorized", "Missing or invalid X-App-Instance-Token"),
				);
			}
			const instance = await appInstances.verifyByToken(rawToken);
			if (instance === null) {
				throw errors.UNAUTHORIZED(
					standardErrorOptions("unauthorized", "Missing or invalid X-App-Instance-Token"),
				);
			}
			return next({
				context: {
					...context,
					appInstance: {
						id: instance.id,
						label: instance.label,
						kind: instance.kind,
					},
				},
			});
		});
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
 * In-process sliding-window rate limiter. Keys by x-forwarded-for (first hop)
 * falling back to "unknown". Process-local by design — good enough for the
 * single-node self-hosted deployment model; swap for a shared store only when
 * multi-node platform deployments actually need it.
 *
 * The thrown error is ALWAYS the contract-declared TOO_MANY_REQUESTS
 * (declared on `registerAppInstanceContract`); the middleware declares the
 * same code via `.errors(...)` so only that one code can be thrown.
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
