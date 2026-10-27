import { Context, Effect } from "effect";
import { generateVAPIDKeys } from "web-push";

import { DatabasePort } from "@identity/core/database/database.port";

import { pushSubscriptionNotFound } from "../domain/push.errors";
import { pushRules } from "../domain/push.rules";
import type {
	Actor,
	PublicKey,
	PushStats,
	PushSubscription,
	SubscribeRequest,
	SubscribeResult,
} from "../domain/push.types";
import { PushRepository } from "../repositories/push.repository";
import { PushServiceFailure } from "../push.failures";
import { mapErrors, rule } from "./push.service.utils";

/** What `recordDelivery` learns from the transport that actually sent. */
export type DeliveryOutcome = {
	readonly delivered: boolean;
	readonly gone: boolean;
};

/** The callers of this domain expect the actor type from here, as in the user module. */
export type { Actor };

export interface PushServiceShape {
	readonly publicKey: (actor: Actor) => Effect.Effect<PublicKey, PushServiceFailure, PushRepository | DatabasePort>;
	readonly subscribe: (
		actor: Actor,
		request: SubscribeRequest,
	) => Effect.Effect<SubscribeResult, PushServiceFailure, PushRepository | DatabasePort>;
	readonly unsubscribe: (
		actor: Actor,
		endpoint: string,
	) => Effect.Effect<{ readonly success: boolean }, PushServiceFailure, PushRepository | DatabasePort>;
	readonly list: (
		actor: Actor,
	) => Effect.Effect<PushSubscription[], PushServiceFailure, PushRepository | DatabasePort>;
	readonly stats: (actor: Actor) => Effect.Effect<PushStats, PushServiceFailure, PushRepository | DatabasePort>;
	readonly deliverableCount: () => Effect.Effect<number, PushServiceFailure, PushRepository | DatabasePort>;
	readonly recordDelivery: (
		id: string,
		outcome: DeliveryOutcome,
	) => Effect.Effect<void, PushServiceFailure, PushRepository | DatabasePort>;
}

/** Effect key = NestJS token. The implementation is below. */
export class PushService extends Context.Service<PushService, PushServiceShape>()("identity/PushService") {}

/**
 * The push domain's use cases, composed as Effects.
 *
 * Rules stay synchronous and are lifted with `rule`; database work is already an
 * Effect from `PushRepository`. `mapErrors` collapses the two error channels into
 * the single `PushServiceFailure` the controller maps.
 *
 * Not here: SQL (the repository), the HTTP shape (the controller), or the
 * notification PAYLOAD — composing what a message says is a caller's concern.
 */
export class PushServiceImpl implements PushServiceShape {
	/**
	 * The VAPID public key this user's browser should subscribe with, generating the
	 * keypair on first use.
	 *
	 * Lazy because a keypair is only needed once somebody subscribes: minting one at
	 * signup would put a row and a keypair on every user for a feature most will not
	 * use.
	 */
	publicKey(actor: Actor): Effect.Effect<PublicKey, PushServiceFailure, PushRepository | DatabasePort> {
		return mapErrors(
			Effect.gen(function* () {
				const subscriptions = yield* PushRepository;
				const existing = yield* subscriptions.findVapidKeys(actor.userId);
				if (existing !== null) return { publicKey: existing.publicKey };

				const generated = yield* rule(() => generateVAPIDKeys());
				const keys = yield* subscriptions.insertVapidKeys({
					userId: actor.userId,
					...generated,
					// The VAPID spec requires a contact so a push service can report a
					// misbehaving sender. A `mailto:` with a local domain is deliberate: a
					// valid, unique principal that leaks no real address.
					subject: `mailto:user-${actor.userId}@notifications.local`,
				});
				return { publicKey: keys.publicKey };
			}),
		);
	}

	/**
	 * Register a device.
	 *
	 * The shapes are checked structurally (base64url, plausible length) rather than
	 * cryptographically: this guards against a WRONG value, not a hostile one — the
	 * push service is the authority on whether a keypair works. A malformed key would
	 * otherwise fail at DELIVERY time, days later, as an opaque 400.
	 */
	subscribe(
		actor: Actor,
		request: SubscribeRequest,
	): Effect.Effect<SubscribeResult, PushServiceFailure, PushRepository | DatabasePort> {
		// Built here, RUN inside the generator: `Effect` values are lazy, so the keypair
		// is ensured after validation and before the subscription row is written.
		const keypair = this.publicKey(actor);

		return mapErrors(
			Effect.gen(function* () {
				const subscriptions = yield* PushRepository;

				yield* rule(() => {
					pushRules.assertUsableEndpoint(request.endpoint);
					pushRules.assertUsableKey(request.keys.p256dh, "p256dh", 60);
					pushRules.assertUsableKey(request.keys.auth, "auth", 12);
				});

				// A subscription with no keypair cannot be delivered to, so storing one
				// first would create a row that looks live and silently cannot be used.
				yield* keypair;

				const stored = yield* subscriptions.upsert({
					userId: actor.userId,
					endpoint: request.endpoint,
					p256dh: request.keys.p256dh,
					auth: request.keys.auth,
					deviceName: request.deviceName,
					userAgent: request.userAgent,
				});

				return { id: stored.id, deviceName: stored.deviceName, createdAt: stored.createdAt };
			}),
		);
	}

	/**
	 * Remove a device.
	 *
	 * The lookup and the delete are both keyed on the actor: checking in one then
	 * deleting in the other would leave a window where a re-owned endpoint is deleted
	 * by the previous holder, so the repository's delete carries the `userId` too.
	 *
	 * "Not yours" and "not found" return the SAME error, because distinguishing them
	 * would confirm that an endpoint belongs to somebody else.
	 */
	unsubscribe(
		actor: Actor,
		endpoint: string,
	): Effect.Effect<{ readonly success: boolean }, PushServiceFailure, PushRepository | DatabasePort> {
		return mapErrors(
			Effect.gen(function* () {
				const subscriptions = yield* PushRepository;

				const existing = yield* subscriptions.findByEndpoint(endpoint);
				if (existing === null || existing.userId !== actor.userId) {
					return yield* Effect.fail(
						new PushServiceFailure({ cause: pushSubscriptionNotFound(endpoint) }),
					);
				}

				const deleted = yield* subscriptions.deleteByEndpointForUser(actor.userId, endpoint);
				if (!deleted) {
					return yield* Effect.fail(
						new PushServiceFailure({ cause: pushSubscriptionNotFound(endpoint) }),
					);
				}
				return { success: true };
			}),
		);
	}

	/** This user's devices — active only, because a retired endpoint is not deliverable. */
	list(actor: Actor): Effect.Effect<PushSubscription[], PushServiceFailure, PushRepository | DatabasePort> {
		return mapErrors(
			Effect.gen(function* () {
				const subscriptions = yield* PushRepository;
				return yield* subscriptions.listByUser(actor.userId, true);
			}),
		);
	}

	/**
	 * This user's subscription statistics.
	 *
	 * Each figure is asked of the database for exactly the set it describes: `total`
	 * counts every row while `devices` lists only active ones, so deriving the total
	 * from the list would report a number that disagrees with the table.
	 */
	stats(actor: Actor): Effect.Effect<PushStats, PushServiceFailure, PushRepository | DatabasePort> {
		return mapErrors(
			Effect.gen(function* () {
				const subscriptions = yield* PushRepository;

				const total = yield* subscriptions.countByUser(actor.userId, false);
				const active = yield* subscriptions.countByUser(actor.userId, true);
				const rows = yield* subscriptions.listByUser(actor.userId, true);

				return {
					totalSubscriptions: total,
					activeSubscriptions: active,
					// `lastUsedAt ?? createdAt` rather than a null: the contract declares a
					// required date, and "never used" means "not used since registration".
					// `now()` would make an unused device look like the most recent one.
					devices: rows.map((row) => ({
						deviceName: row.deviceName ?? "Unknown Device",
						lastUsed: row.lastUsedAt ?? row.createdAt,
					})),
				};
			}),
		);
	}

	/**
	 * How many subscriptions could actually receive a notification right now.
	 *
	 * Activity is necessary and not sufficient: a subscription belonging to a banned
	 * account must not be delivered to, and a ban does not flip the device rows.
	 */
	deliverableCount(): Effect.Effect<number, PushServiceFailure, PushRepository | DatabasePort> {
		return mapErrors(
			Effect.gen(function* () {
				const subscriptions = yield* PushRepository;
				return yield* subscriptions.countDeliverable();
			}),
		);
	}

	/**
	 * Record the outcome of a delivery the transport layer already performed.
	 *
	 * Speaking web-push means holding a VAPID keypair per user and interpreting the
	 * push service's status codes. Keeping the OUTCOME here means the one piece of
	 * knowledge that must persist (a retired endpoint) is recorded authoritatively.
	 */
	recordDelivery(
		id: string,
		outcome: DeliveryOutcome,
	): Effect.Effect<void, PushServiceFailure, PushRepository | DatabasePort> {
		return mapErrors(
			Effect.gen(function* () {
				const subscriptions = yield* PushRepository;
				if (outcome.delivered) {
					yield* subscriptions.markUsed(id);
					return;
				}
				if (outcome.gone) {
					yield* subscriptions.deactivate(id);
				}
			}),
		);
	}
}
