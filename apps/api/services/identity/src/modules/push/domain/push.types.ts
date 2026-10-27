import type { z } from "zod/v4";
import type {
	getPublicKeyOutputSchema,
	getStatsOutputSchema,
	sendTestNotificationOutputSchema,
	subscribeInputSchema,
	subscribeOutputSchema,
	subscriptionSchema,
} from "@deployer/identity-contracts";

/**
 * The push domain's vocabulary, inferred from the contract schemas so the
 * transport and the domain cannot drift.
 */
export type PushSubscription = z.output<typeof subscriptionSchema>;

export type PushStats = z.output<typeof getStatsOutputSchema>;

/** The VAPID keypair handed to a browser so it can subscribe. */
export type PublicKey = z.output<typeof getPublicKeyOutputSchema>;

/** A browser's subscription request. */
export type SubscribeRequest = z.output<typeof subscribeInputSchema>;

/** The stored subscription, as `subscribe` reports it. */
export type SubscribeResult = z.output<typeof subscribeOutputSchema>;

/** What a delivery attempt achieved. */
export type DeliveryReport = z.output<typeof sendTestNotificationOutputSchema>;

export type { Actor } from "@identity/core/utils/actor.utils";
