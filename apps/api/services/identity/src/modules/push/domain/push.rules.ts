import { ValidationError } from "@deployer/errors";

import type { DeliveryReport } from "./push.types";

/**
 * A push endpoint must be an HTTPS URL.
 *
 * The endpoint is not decoration: the server POSTs to it, so an unchecked value
 * is a server-side request to an arbitrary host — the shape of an SSRF. Browsers
 * only ever produce `https://` push endpoints, so rejecting anything else costs a
 * legitimate client nothing while removing the ability to aim this service at an
 * internal address.
 */
const PUSH_ENDPOINT_PATTERN = /^https:\/\/[^\s]+$/;

/**
 * The push domain's rules. Pure: no database, no Effect, no HTTP.
 *
 * Decisions about SUBSCRIPTIONS live here — is this endpoint usable, does this key
 * material look like a subscription, what does a delivery report say. SQL belongs to
 * the repository and the wire shape to the contract.
 */
export const pushRules = {
	assertUsableEndpoint(endpoint: string): void {
		if (!PUSH_ENDPOINT_PATTERN.test(endpoint)) {
			throw new ValidationError("push endpoint is not usable", [
				{
					path: "endpoint",
					code: "invalid_format",
					severity: "error",
					message: "must be an https:// URL, because the server posts to it",
				},
			]);
		}
	},

	assertUsableKey(value: string, field: string, minimumLength: number): void {
		// `p256dh` is an uncompressed P-256 point (65 bytes → 87 base64url characters)
		// and `auth` is 16 bytes (→ 22). The floors are set below those so a different
		// encoding is still accepted, while a truncated or empty value — the realistic
		// mistake — is not.
		const isBase64Url = /^[A-Za-z0-9_-]+$/.test(value);
		if (!isBase64Url || value.length < minimumLength) {
			throw new ValidationError(`push key ${field} is not usable`, [
				{
					path: `keys.${field}`,
					code: "invalid_format",
					severity: "error",
					message: `must be base64url of at least ${String(minimumLength)} characters`,
				},
			]);
		}
	},

	/**
	 * `total` is the caller's own device count, so the report is about their devices;
	 * `success` is bounded by what is deliverable in total, so the number cannot exceed
	 * reality when the caller has no devices at all.
	 */
	deliveryReport(total: number, deliverable: number): DeliveryReport {
		const reachable = Math.min(total, deliverable);
		return { success: reachable, failed: total - reachable, total };
	},
} as const;
