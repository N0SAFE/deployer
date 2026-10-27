/**
 * The token Traefik presents when it polls its routes from the API.
 *
 * The config endpoint is reachable through Traefik itself (`api.<host>` routes to
 * the API), so "only the overlay can reach it" is not true and the endpoint must
 * authenticate its caller. The token is DERIVED from the API's auth secret rather
 * than stored: every API replica computes the same value with no shared state, and
 * rotating the auth secret rotates it.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Path the ingress polls on the API (Traefik HTTP provider endpoint). */
export const TRAEFIK_CONFIG_PATH = "internal/ingress/traefik-config";

/** Header Traefik's HTTP provider sends (`--providers.http.headers.<name>`). */
export const INGRESS_TOKEN_HEADER = "X-Deployer-Ingress-Token";

const DERIVATION_LABEL = "deployer:traefik-http-provider:v1";

/**
 * The secret the token is derived from: `AUTH_SECRET`, else `BETTER_AUTH_SECRET`
 * (the env schema requires them to agree when both are set). Throws when neither
 * is set — an ingress whose poll cannot be authenticated must fail loudly rather
 * than accept a token derived from an empty key.
 */
export function requireIngressSecret(authSecret: string | undefined, betterAuthSecret: string | undefined): string {
	const candidates = [authSecret?.trim(), betterAuthSecret?.trim()];
	const secret = candidates.find((value) => value !== undefined && value !== "");
	if (secret === undefined) {
		throw new Error("AUTH_SECRET is not set — the ingress cannot authenticate its route poll");
	}
	return secret;
}

export function deriveIngressProviderToken(authSecret: string): string {
	return createHmac("sha256", authSecret).update(DERIVATION_LABEL).digest("hex");
}

/** Constant-time comparison, so the token cannot be guessed byte by byte. */
export function ingressTokenMatches(presented: string | undefined, authSecret: string): boolean {
	if (presented === undefined) return false;
	const expected = Buffer.from(deriveIngressProviderToken(authSecret));
	const actual = Buffer.from(presented);
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}
