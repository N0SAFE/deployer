import type { PushSubscription } from "../domain/push.types";

/**
 * A stored subscription plus the columns the contract deliberately hides.
 *
 * `userId` is what ownership checks are made against and `p256dh`/`auth` are the
 * keys a delivery seals its payload with — none of them belongs in an API response.
 */
export type StoredSubscription = PushSubscription & {
	readonly userId: string;
	readonly p256dh: string;
	readonly auth: string;
	readonly updatedAt: Date;
};

/** What `subscribe` persists. */
export type NewSubscription = {
	readonly userId: string;
	readonly endpoint: string;
	readonly p256dh: string;
	readonly auth: string;
	readonly deviceName?: string | undefined;
	readonly userAgent?: string | undefined;
};

/** VAPID keys, as `getPublicKey` needs them. */
export type VapidKeys = {
	readonly userId: string;
	readonly publicKey: string;
	readonly privateKey: string;
	readonly subject: string;
};
