import { ConflictError, NotFoundError, ValidationError } from "@deployer/errors";
import { generateVAPIDKeys } from "web-push";

import type { PushRepository, PushStats, PushSubscription } from "../repositories/push.repository";

/** The caller, as resolved by the BFF and forwarded over the boundary. */
export interface Actor {
	readonly userId: string;
	readonly role: string;
}

/** The VAPID keypair handed to a browser so it can subscribe. */
export interface PublicKey {
	readonly publicKey: string;
}

/** A browser's subscription request. */
export interface SubscribeRequest {
	readonly endpoint: string;
	readonly keys: { readonly p256dh: string; readonly auth: string };
	readonly deviceName?: string | undefined;
	readonly userAgent?: string | undefined;
}

/** The stored subscription, as `subscribe` reports it. */
export interface SubscribeResult {
	readonly id: string;
	readonly deviceName: string | null;
	readonly createdAt: Date;
}

/** What a delivery attempt achieved. */
export interface DeliveryReport {
	readonly success: number;
	readonly failed: number;
	readonly total: number;
}

/**
 * A push endpoint must be an HTTPS URL.
 *
 * ── WHY THIS IS VALIDATED AT ALL ────────────────────────────────────────────
 * The endpoint is not decoration: the server POSTs to it, so an unchecked value is a
 * server-side request to an arbitrary host — the shape of an SSRF. Browsers only ever
 * produce `https://` push endpoints, so rejecting anything else costs a legitimate
 * client nothing while removing the ability to aim this service at an internal address.
 */
const PUSH_ENDPOINT_PATTERN = /^https:\/\/[^\s]+$/;

/**
 * The push domain's rules.
 *
 * ── WHAT BELONGS HERE ───────────────────────────────────────────────────────
 * Decisions about SUBSCRIPTIONS: is this endpoint usable, does this key material look
 * like a subscription, may this actor remove this row, is a delivery worth attempting.
 *
 * Not here: SQL (the repository), the HTTP shape (the controller), or the notification
 * PAYLOAD — composing what a message says is a caller's concern, and a notification
 * whose text is assembled inside this domain would be the reason a second consumer
 * could not reuse the transport.
 *
 * ── WHY THE RULES ARE METHODS ON A CLASS AND NOT FREE FUNCTIONS ─────────────
 * Unlike the user domain's `userRules`, these have no pure, testable shape worth
 * isolating: every one is a precondition for a database write, so putting them here
 * keeps the service readable as "validate, then act" rather than as a pass-through to
 * two other files.
 */
export class PushService {
	constructor(private readonly subscriptions: PushRepository) {}

	/**
	 * The VAPID public key this user's browser should subscribe with, generating the
	 * keypair on first use.
	 *
	 * ── WHY IT GENERATES LAZILY ─────────────────────────────────────────────
	 * A keypair is only needed once somebody subscribes, and the overwhelming majority of
	 * accounts never do. Minting one at signup would put a row and a keypair on every
	 * user for a feature most will not use; minting on demand means the table holds keys
	 * only for accounts that actually receive notifications.
	 */
	async publicKey(actor: Actor): Promise<PublicKey> {
		const existing = await this.subscriptions.findVapidKeys(actor.userId);
		if (existing !== null) return { publicKey: existing.publicKey };

		const keys = await this.subscriptions.insertVapidKeys({
			userId: actor.userId,
			...generateVAPIDKeys(),
			// The VAPID spec requires a contact so a push service can report a misbehaving
			// sender. A `mailto:` with a local domain is deliberate: it is a valid, unique
			// principal that leaks no real address and needs no configuration to work.
			subject: `mailto:user-${actor.userId}@notifications.local`,
		});
		return { publicKey: keys.publicKey };
	}

	/**
	 * Register a device.
	 *
	 * ── WHY THESE VALIDATIONS EXIST ─────────────────────────────────────────
	 * `endpoint` is fetched by the server (see `PUSH_ENDPOINT_PATTERN`), and
	 * `p256dh`/`auth` are the keys an encrypted payload is sealed with. A malformed key
	 * does not fail here — it fails at DELIVERY time, days later, as an opaque 400 from
	 * the push service, by which point the connection between cause and symptom is gone.
	 * Rejecting it now is what keeps that failure legible.
	 *
	 * The shapes are checked structurally (base64url, plausible length) rather than
	 * cryptographically. This is a guard against a WRONG value, not against a hostile
	 * one: the push service is the authority on whether a keypair works, and an
	 * over-strict check here would reject valid material the moment the spec changes.
	 */
	async subscribe(actor: Actor, request: SubscribeRequest): Promise<SubscribeResult> {
		assertUsableEndpoint(request.endpoint);
		assertUsableKey(request.keys.p256dh, "p256dh", 60);
		assertUsableKey(request.keys.auth, "auth", 12);

		// The VAPID keypair is ensured BEFORE the subscription is stored. A subscription
		// with no keypair cannot be delivered to, so storing one first would create a row
		// that looks live and silently cannot be used.
		await this.publicKey(actor);

		const stored = await this.subscriptions.upsert({
			userId: actor.userId,
			endpoint: request.endpoint,
			p256dh: request.keys.p256dh,
			auth: request.keys.auth,
			deviceName: request.deviceName,
			userAgent: request.userAgent,
		});

		return { id: stored.id, deviceName: stored.deviceName, createdAt: stored.createdAt };
	}

	/**
	 * Remove a device.
	 *
	 * ── WHY OWNERSHIP IS CHECKED AND THE DELETION IS SCOPED ─────────────────
	 * The lookup and the delete are both keyed on the actor. Checking in one then deleting
	 * in the other would leave a window where a re-owned endpoint is deleted by the
	 * previous holder, so the repository's delete carries the `userId` as well: the check
	 * and the write are the same predicate, which is the only version of this that cannot
	 * race.
	 */
	async unsubscribe(actor: Actor, endpoint: string): Promise<{ success: boolean }> {
		const existing = await this.subscriptions.findByEndpoint(endpoint);
		// A 404 rather than `{ success: false }`: the contract declares an error for an
		// unknown endpoint, and a caller that mistyped an endpoint should be told, not
		// handed a success-shaped body with a false inside it.
		if (existing === null) throw new NotFoundError("push subscription", endpoint);
		if (existing.userId !== actor.userId) {
			// Deliberately the SAME error as "not found". Distinguishing them would confirm
			// that an endpoint belongs to somebody else, which is information a caller has
			// no reason to have.
			throw new NotFoundError("push subscription", endpoint);
		}

		const deleted = await this.subscriptions.deleteByEndpointForUser(actor.userId, endpoint);
		if (!deleted) throw new NotFoundError("push subscription", endpoint);
		return { success: true };
	}

	/** This user's devices — active only, because a retired endpoint is not deliverable. */
	async list(actor: Actor): Promise<PushSubscription[]> {
		return this.subscriptions.listByUser(actor.userId, true);
	}

	/**
	 * This user's subscription statistics.
	 *
	 * ── WHY THE COUNT IS SEPARATE FROM THE DEVICE LIST ──────────────────────
	 * The three numbers are not derived from one query: `total` counts every row while
	 * `devices` lists only active ones, so computing the total from the list would report
	 * a number that disagrees with the table. Each figure is asked of the database for
	 * exactly the set it describes.
	 */
	async stats(actor: Actor): Promise<PushStats> {
		const [total, active, subscriptions] = await Promise.all([
			this.subscriptions.countByUser(actor.userId, false),
			this.subscriptions.countByUser(actor.userId, true),
			this.subscriptions.listByUser(actor.userId, true),
		]);

		return {
			totalSubscriptions: total,
			activeSubscriptions: active,
			// `lastUsedAt ?? createdAt` rather than a null: the contract declares a required
			// date, and "never used" genuinely means "not used since it was registered", so
			// the registration time is the honest answer rather than a fabricated `now()`.
			// `now()` would make an unused device look like the most recently active one.
			devices: subscriptions.map((subscription) => ({
				deviceName: subscription.deviceName ?? "Unknown Device",
				lastUsed: subscription.lastUsedAt ?? subscription.createdAt,
			})),
		};
	}

	/**
	 * How many subscriptions could actually receive a notification right now.
	 *
	 * ── WHY THIS IS NOT `activeSubscriptions` SUMMED ACROSS USERS ───────────
	 * Activity is necessary and not sufficient: a subscription belonging to a banned
	 * account must not be delivered to, and a ban does not flip the device rows. This is
	 * the one figure that accounts for it, via the cross-table predicate in
	 * `PushRepository.countDeliverable` — and it is the number a send should be planned
	 * against.
	 */
	async deliverableCount(): Promise<number> {
		return this.subscriptions.countDeliverable();
	}

	/**
	 * Record the outcome of a delivery the transport layer already performed.
	 *
	 * ── WHY THIS DOES NOT SEND ANYTHING ────────────────────────────────────
	 * Speaking web-push means holding a VAPID keypair per user and interpreting the push
	 * service's status codes, which is transport work with its own failure modes. Keeping
	 * the OUTCOME here — "this worked, this endpoint is gone" — means the one piece of
	 * knowledge that must persist (a retired endpoint) is recorded authoritatively,
	 * while the sending itself can live wherever it is cheapest to run.
	 *
	 * `gone` is a separate flag rather than an echo of the status code because only one
	 * thing matters for the future: whether to try this endpoint again.
	 */
	async recordDelivery(id: string, outcome: { readonly delivered: boolean; readonly gone: boolean }): Promise<void> {
		if (outcome.delivered) {
			await this.subscriptions.markUsed(id);
			return;
		}
		if (outcome.gone) {
			await this.subscriptions.deactivate(id);
		}
	}
}

/** A push endpoint must be an HTTPS URL, or the server could be aimed anywhere. */
function assertUsableEndpoint(endpoint: string): void {
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
}

/**
 * A subscription key must look like base64url of a plausible length.
 *
 * The length floor comes from the spec rather than a preference: `p256dh` is an
 * uncompressed P-256 point (65 bytes → 87 base64url characters) and `auth` is 16 bytes
 * (→ 22). The floors are set below those so a different encoding is still accepted,
 * while a truncated or empty value — the realistic mistake — is not.
 */
function assertUsableKey(value: string, field: string, minimumLength: number): void {
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
}

// Re-exported so the controller has one import for the domain's vocabulary.
export { ConflictError };
export type { PushStats, PushSubscription };
