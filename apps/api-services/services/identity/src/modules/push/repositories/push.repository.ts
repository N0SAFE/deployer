import { Injectable } from "@nestjs/common";
import { and, count, desc, eq } from "drizzle-orm";
import { user, userVapidKeys } from "@deployer/nest-schema/global/identity/auth";
import { pushSubscription } from "@deployer/nest-schema/global/identity/auth";
import { allOf, relationPredicates } from "@/core/modules/database/query/relation-predicates";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";

/** A stored subscription, as the contract declares it. */
export interface PushSubscription {
	readonly id: string;
	readonly userId: string;
	readonly endpoint: string;
	readonly p256dh: string;
	readonly auth: string;
	readonly deviceName: string | null;
	readonly userAgent: string | null;
	readonly isActive: boolean;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly lastUsedAt: Date | null;
}

/** What `subscribe` persists. */
export interface NewSubscription {
	readonly userId: string;
	readonly endpoint: string;
	readonly p256dh: string;
	readonly auth: string;
	readonly deviceName?: string | undefined;
	readonly userAgent?: string | undefined;
}

/** VAPID keys, as the contract's `getPublicKey` needs them. */
export interface VapidKeys {
	readonly userId: string;
	readonly publicKey: string;
	readonly privateKey: string;
	readonly subject: string;
}

/** Per-device usage the stats endpoint reports. */
export interface DeviceUsage {
	readonly deviceName: string;
	readonly lastUsed: Date;
}

export interface PushStats {
	readonly totalSubscriptions: number;
	readonly activeSubscriptions: number;
	readonly devices: DeviceUsage[];
}

/**
 * Data access for the push domain — the only reader/writer of `push_subscription` and
 * `user_vapid_keys`.
 *
 * ── WHY THE CROSS-TABLE QUERY LIVES HERE ────────────────────────────────────
 * `countDeliverableSubscriptions` asks a question about `push_subscription` whose
 * answer depends on `user` (see `deliverableWhere`). That is still THIS domain's
 * query — it is the domain that knows a subscription is worthless if its owner is
 * banned — so it belongs in this repository rather than being split across a service
 * boundary that does not exist. It is the first use of the relation builder and the
 * reason it was written.
 */
@Injectable()
export class PushRepository {
	constructor(private readonly database: GlobalDatabaseService) {}

	async findByEndpoint(endpoint: string): Promise<PushSubscription | null> {
		const rows = await this.database.db
			.select()
			.from(pushSubscription)
			.where(eq(pushSubscription.endpoint, endpoint))
			.limit(1);
		const row = rows[0];
		return row === undefined ? null : toSubscription(row);
	}

	async listByUser(userId: string, onlyActive: boolean): Promise<PushSubscription[]> {
		const where = allOf(
			eq(pushSubscription.userId, userId),
			onlyActive ? eq(pushSubscription.isActive, true) : undefined,
		);
		const rows = await this.database.db
			.select()
			.from(pushSubscription)
			.where(where)
			.orderBy(desc(pushSubscription.createdAt));
		return rows.map(toSubscription);
	}

	/**
	 * How many subscriptions this user has, optionally counting only active ones.
	 *
	 * A `count()` rather than loading rows: a user with 200 stale device rows must not
	 * pull 200 rows to display "2".
	 */
	async countByUser(userId: string, onlyActive: boolean): Promise<number> {
		const where = allOf(
			eq(pushSubscription.userId, userId),
			onlyActive ? eq(pushSubscription.isActive, true) : undefined,
		);
		const rows = await this.database.db.select({ value: count() }).from(pushSubscription).where(where);
		return rows[0]?.value ?? 0;
	}

	/**
	 * How many subscriptions are DELIVERABLE — active, and belonging to a user who is not
	 * banned.
	 *
	 * ── WHAT THE RELATION PREDICATE IS DOING HERE ───────────────────────────
	 * Sending a push to a banned account is the exact behaviour a ban is supposed to
	 * prevent, and `isActive` alone does not cover it: a ban does not reach in and flip
	 * every device row. The question is therefore "…where the OWNER is not banned", which
	 * is a predicate about a DIFFERENT table, and it is written as one:
	 *
	 *   existsIn(user, eq(user.id, pushSubscription.userId), eq(user.banned, false))
	 *
	 * `EXISTS` and not a JOIN, deliberately. A JOIN would return one row per matching
	 * subscription — fine for a count, wrong the moment this feeds a `GROUP BY` or a
	 * paginated list, because the duplicate rows quietly change the answer. Keeping the
	 * shape row-preserving means it can be reused for a count OR a list.
	 *
	 * A `user.banned = NULL` row means "never banned" rather than "unknown": the column
	 * defaults to `false`, so `eq(banned, false)` is the correct test and an
	 * `OR IS NULL` clause would be defensive noise against a schema that cannot produce it.
	 */
	async countDeliverable(): Promise<number> {
		const rel = relationPredicates(this.database.db);
		const rows = await this.database.db
			.select({ value: count() })
			.from(pushSubscription)
			.where(
				allOf(
					eq(pushSubscription.isActive, true),
					rel.existsIn(user, eq(user.id, pushSubscription.userId), eq(user.banned, false)),
				),
			);
		return rows[0]?.value ?? 0;
	}

	/** Insert, or re-activate an existing endpoint for this user. */
	async upsert(input: NewSubscription): Promise<PushSubscription> {
		const now = new Date();
		const rows = await this.database.db
			.insert(pushSubscription)
			.values({
				id: crypto.randomUUID(),
				userId: input.userId,
				endpoint: input.endpoint,
				p256dh: input.p256dh,
				auth: input.auth,
				deviceName: input.deviceName ?? null,
				userAgent: input.userAgent ?? null,
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			// A browser that re-subscribes after clearing storage sends the SAME endpoint with
			// fresh keys. Treating that as "already exists" would leave the stored keys stale
			// and every later notification would fail with 400 — so the conflicting row is
			// re-bound to the caller and its keys are refreshed.
			.onConflictDoUpdate({
				target: pushSubscription.endpoint,
				set: {
					userId: input.userId,
					p256dh: input.p256dh,
					auth: input.auth,
					deviceName: input.deviceName ?? null,
					userAgent: input.userAgent ?? null,
					isActive: true,
					updatedAt: now,
				},
			})
			.returning();

		const row = rows[0];
		if (row === undefined) {
			// `returning()` on a successful insert always yields a row; its absence is a
			// driver-contract violation, not a user error.
			throw new Error("upsert into push_subscription returned no row");
		}
		return toSubscription(row);
	}

	/** Delete one endpoint, scoped to its owner so a caller cannot remove another's. */
	async deleteByEndpointForUser(userId: string, endpoint: string): Promise<boolean> {
		const rows = await this.database.db
			.delete(pushSubscription)
			.where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)))
			.returning({ id: pushSubscription.id });
		return rows.length > 0;
	}

	/** Record that a delivery succeeded, so "last used" reflects reality. */
	async markUsed(id: string): Promise<void> {
		await this.database.db
			.update(pushSubscription)
			.set({ lastUsedAt: new Date(), updatedAt: new Date() })
			.where(eq(pushSubscription.id, id));
	}

	/**
	 * Retire a subscription the push service rejected.
	 *
	 * The push service answers 404 or 410 for an endpoint that no longer exists, and
	 * retrying those forever wastes every future send. Marking them inactive keeps the row
	 * (so a re-subscribe on the same endpoint can re-activate it) while removing it from
	 * the delivery set.
	 */
	async deactivate(id: string): Promise<void> {
		await this.database.db
			.update(pushSubscription)
			.set({ isActive: false, updatedAt: new Date() })
			.where(eq(pushSubscription.id, id));
	}

	async findVapidKeys(userId: string): Promise<VapidKeys | null> {
		const rows = await this.database.db
			.select()
			.from(userVapidKeys)
			.where(eq(userVapidKeys.userId, userId))
			.limit(1);
		const row = rows[0];
		if (row === undefined) return null;
		return {
			userId: row.userId,
			publicKey: row.publicKey,
			privateKey: row.privateKey,
			subject: row.subject ?? "",
		};
	}

	/**
	 * Store a keypair, or return the one that already exists.
	 *
	 * ── WHY THIS ALWAYS RE-READS INSTEAD OF USING `returning()` ─────────────
	 * The unique constraint on `user_id` is the authority on "one keypair per user", so the
	 * insert is written to LOSE to it: `onConflictDoNothing` plus a read afterwards. Two
	 * racing callers (a page that loads and immediately subscribes) then both receive the
	 * SAME keypair — the winner's — instead of the loser failing its request.
	 *
	 * Re-reading unconditionally rather than pairing `onConflictDoNothing` with
	 * `returning()` is deliberate: that pair cannot express both outcomes (a row when it
	 * inserted, the existing row when it did not) in one statement, so it would still need
	 * this read on the conflict path. One always-run read is simpler than two paths and
	 * cannot be wrong about which one it took — and it avoids the overload-inference
	 * failure that `.returning()` hits here, because the insert's row shape is never used.
	 */
	async insertVapidKeys(keys: VapidKeys): Promise<VapidKeys> {
		await this.database.db
			.insert(userVapidKeys)
			.values({
				// `id` is the primary key and is NOT database-defaulted, so it must be supplied.
				// Generating it here rather than in the service keeps the row's identity next to
				// the insert that needs it, and stops a caller proposing an id.
				id: crypto.randomUUID(),
				userId: keys.userId,
				publicKey: keys.publicKey,
				privateKey: keys.privateKey,
				subject: keys.subject,
				createdAt: new Date(),
			})
			.onConflictDoNothing({ target: userVapidKeys.userId });

		const stored = await this.findVapidKeys(keys.userId);
		if (stored === null) {
			// The insert reported no conflict and the row is absent: the constraint and the read
			// disagree, which is a real inconsistency rather than a race worth retrying.
			throw new Error(`VAPID keys for ${keys.userId} were not stored and do not exist`);
		}
		return stored;
	}
}

/**
 * Map a row to the domain shape.
 *
 * `Date` values survive as dates because the push contract declares `z.date()` — unlike
 * the user entity, whose contract declares them as strings. The contract is the
 * authority, so the mapper satisfies it rather than applying a house style.
 */
function toSubscription(row: typeof pushSubscription.$inferSelect): PushSubscription {
	return {
		id: row.id,
		userId: row.userId,
		endpoint: row.endpoint,
		p256dh: row.p256dh,
		auth: row.auth,
		deviceName: row.deviceName ?? null,
		userAgent: row.userAgent ?? null,
		isActive: row.isActive,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		lastUsedAt: row.lastUsedAt ?? null,
	};
}
