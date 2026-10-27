import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The SYSTEM ACTOR: who a deployment belongs to when no person started it.
 *
 * ── WHY A SIGNED CLAIM ──────────────────────────────────────────────────────
 * A webhook carries a repository, not a session, so the user-based access check
 * (`assertDeploymentServiceAccess`) has nobody to check. Faking a user id would either trip
 * that check or pass it for the wrong reason. Instead the caller (fleet, which verified the
 * webhook's own signature) states "this is the system, acting for <source>" and signs it, so
 * a peer that merely reaches the port cannot claim it.
 *
 * ── WHAT THE CLAIM BINDS ────────────────────────────────────────────────────
 * - `aud`: the service the claim is for, so a claim captured on one hop cannot be replayed
 *   against another service.
 * - `exp`: short, because the claim only has to survive one call.
 * - `source` / `deliveryId`: audit trail ("which webhook deployed this?").
 *
 * The signing key is DERIVED from the platform secret with a purpose label, so the raw
 * secret is never used directly as an HMAC key for a second purpose.
 */

export const SYSTEM_ACTOR_HEADER = "x-deployer-system-actor";

/** A claim must be used within this window; the call it rides on takes milliseconds. */
export const SYSTEM_ACTOR_TTL_SECONDS = 60;

export type SystemActorClaim = {
	readonly kind: "system";
	/** What started it: "github-push", "schedule", … */
	readonly source: string;
	/** The provider's delivery id, when there is one. */
	readonly deliveryId: string | null;
	/** The service this claim is addressed to. */
	readonly aud: string;
	/** Expiry, seconds since the epoch. */
	readonly exp: number;
}

const deriveKey = (secret: string): Buffer =>
	createHmac("sha256", secret).update("deployer:system-actor:v1").digest();

const sign = (payload: string, secret: string): string =>
	createHmac("sha256", deriveKey(secret)).update(payload).digest("base64url");

/** `<base64url(json)>.<base64url(hmac)>` */
export function signSystemActorClaim(
	input: { source: string; deliveryId?: string | null; aud: string },
	secret: string,
	now: Date = new Date(),
): string {
	const claim: SystemActorClaim = {
		kind: "system",
		source: input.source,
		deliveryId: input.deliveryId ?? null,
		aud: input.aud,
		exp: Math.floor(now.getTime() / 1000) + SYSTEM_ACTOR_TTL_SECONDS,
	};
	const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
	return `${payload}.${sign(payload, secret)}`;
}

/** The claim, or `null` for anything that is not a valid, unexpired claim for `aud`. */
export function verifySystemActorClaim(
	token: string,
	secret: string,
	aud: string,
	now: Date = new Date(),
): SystemActorClaim | null {
	const [payload, signature, ...rest] = token.split(".");
	if (!payload || !signature || rest.length > 0) return null;

	const expected = Buffer.from(sign(payload, secret));
	const given = Buffer.from(signature);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

	let claim: unknown;
	try {
		claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	if (claim === null || typeof claim !== "object") return null;
	const c = claim as Partial<SystemActorClaim>;
	if (c.kind !== "system" || typeof c.source !== "string" || c.source.length === 0) return null;
	if (typeof c.aud !== "string" || c.aud !== aud) return null;
	if (typeof c.exp !== "number" || c.exp * 1000 < now.getTime()) return null;
	if (c.deliveryId !== null && typeof c.deliveryId !== "string") return null;
	return c as SystemActorClaim;
}
