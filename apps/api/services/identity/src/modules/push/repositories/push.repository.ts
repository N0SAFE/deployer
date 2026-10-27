import { Injectable } from "@nestjs/common";
import { Context, Effect } from "effect";
import { and, count, desc, eq } from "drizzle-orm";
import { pushSubscription, user, userVapidKeys } from "@deployer/nest-schema/global/identity/auth";
import { DatabasePort } from "@identity/core/database/database.port";
import { allOf, relationPredicates } from "@deployer/shared/core/modules/database/query/relation-predicates";

import { PushRepositoryFailure } from "../push.failures";
import { attempt } from "./push.repository.utils";
import type { NewSubscription, StoredSubscription, VapidKeys } from "./push.repository.types";

/**
 * Data access for the push domain — the only reader/writer of `push_subscription`
 * and `user_vapid_keys`.
 *
 * ── WHY THE CROSS-TABLE QUERY LIVES HERE ────────────────────────────────────
 * `countDeliverable` asks a question about `push_subscription` whose answer depends
 * on `user`. That is still THIS domain's query — the domain knows a subscription is
 * worthless if its owner is banned — so it belongs here rather than being split
 * across a service boundary that does not exist.
 */
export type PushRepositoryShape = {
	readonly findByEndpoint: (
		endpoint: string,
	) => Effect.Effect<StoredSubscription | null, PushRepositoryFailure, DatabasePort>;
	readonly listByUser: (
		userId: string,
		onlyActive: boolean,
	) => Effect.Effect<StoredSubscription[], PushRepositoryFailure, DatabasePort>;
	readonly countByUser: (
		userId: string,
		onlyActive: boolean,
	) => Effect.Effect<number, PushRepositoryFailure, DatabasePort>;
	readonly countDeliverable: () => Effect.Effect<number, PushRepositoryFailure, DatabasePort>;
	readonly upsert: (
		input: NewSubscription,
	) => Effect.Effect<StoredSubscription, PushRepositoryFailure, DatabasePort>;
	readonly deleteByEndpointForUser: (
		userId: string,
		endpoint: string,
	) => Effect.Effect<boolean, PushRepositoryFailure, DatabasePort>;
	readonly markUsed: (id: string) => Effect.Effect<void, PushRepositoryFailure, DatabasePort>;
	readonly deactivate: (id: string) => Effect.Effect<void, PushRepositoryFailure, DatabasePort>;
	readonly findVapidKeys: (
		userId: string,
	) => Effect.Effect<VapidKeys | null, PushRepositoryFailure, DatabasePort>;
	readonly insertVapidKeys: (
		keys: VapidKeys,
	) => Effect.Effect<VapidKeys, PushRepositoryFailure, DatabasePort>;
}

/** Effect key = NestJS token. The Drizzle implementation is below. */
export class PushRepository extends Context.Service<PushRepository, PushRepositoryShape>()(
	"identity/PushRepository",
) {}

/** Drizzle implementation. No constructor injection: every method yields `DatabasePort`. */
@Injectable()
export class PushRepositoryImpl implements PushRepositoryShape {
	findByEndpoint(
		endpoint: string,
	): Effect.Effect<StoredSubscription | null, PushRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const rows = await db
					.select()
					.from(pushSubscription)
					.where(eq(pushSubscription.endpoint, endpoint))
					.limit(1);
				return rows[0] ?? null;
			});
		});
	}

	listByUser(
		userId: string,
		onlyActive: boolean,
	): Effect.Effect<StoredSubscription[], PushRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const where = allOf(
					eq(pushSubscription.userId, userId),
					onlyActive ? eq(pushSubscription.isActive, true) : undefined,
				);
				return db
					.select()
					.from(pushSubscription)
					.where(where)
					.orderBy(desc(pushSubscription.createdAt));
			});
		});
	}

	/**
	 * A `count()` rather than loading rows: a user with 200 stale device rows must
	 * not pull 200 rows to display "2".
	 */
	countByUser(
		userId: string,
		onlyActive: boolean,
	): Effect.Effect<number, PushRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const where = allOf(
					eq(pushSubscription.userId, userId),
					onlyActive ? eq(pushSubscription.isActive, true) : undefined,
				);
				const rows = await db.select({ value: count() }).from(pushSubscription).where(where);
				return rows[0]?.value ?? 0;
			});
		});
	}

	/**
	 * How many subscriptions are DELIVERABLE — active, and belonging to a user who
	 * is not banned.
	 *
	 * `isActive` alone does not cover it: a ban does not reach in and flip every
	 * device row. `EXISTS` and not a JOIN, deliberately — a JOIN returns one row per
	 * matching subscription, which is fine for a count but silently changes a
	 * paginated list. A `user.banned = NULL` row means "never banned" (the column
	 * defaults to `false`), so `eq(banned, false)` is the correct test.
	 */
	countDeliverable(): Effect.Effect<number, PushRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const rel = relationPredicates(db);
				const rows = await db
					.select({ value: count() })
					.from(pushSubscription)
					.where(
						allOf(
							eq(pushSubscription.isActive, true),
							rel.existsIn(user, eq(user.id, pushSubscription.userId), eq(user.banned, false)),
						),
					);
				return rows[0]?.value ?? 0;
			});
		});
	}

	/**
	 * Insert, or re-activate an existing endpoint for this user.
	 *
	 * A browser that re-subscribes after clearing storage sends the SAME endpoint with
	 * fresh keys. Treating that as "already exists" would leave the stored keys stale
	 * and every later notification would fail with 400, so the conflicting row is
	 * re-bound to the caller and its keys are refreshed.
	 */
	upsert(input: NewSubscription): Effect.Effect<StoredSubscription, PushRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const now = new Date();
				const rows = await db
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
					// `returning()` on a successful insert always yields a row; its absence is
					// a driver-contract violation, not a user error.
					throw new Error("upsert into push_subscription returned no row");
				}
				return row;
			});
		});
	}

	/** Delete one endpoint, scoped to its owner so a caller cannot remove another's. */
	deleteByEndpointForUser(
		userId: string,
		endpoint: string,
	): Effect.Effect<boolean, PushRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const rows = await db
					.delete(pushSubscription)
					.where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)))
					.returning({ id: pushSubscription.id });
				return rows.length > 0;
			});
		});
	}

	/** Record that a delivery succeeded, so "last used" reflects reality. */
	markUsed(id: string): Effect.Effect<void, PushRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				await db
					.update(pushSubscription)
					.set({ lastUsedAt: new Date(), updatedAt: new Date() })
					.where(eq(pushSubscription.id, id));
			});
		});
	}

	/**
	 * Retire a subscription the push service rejected.
	 *
	 * The push service answers 404 or 410 for an endpoint that no longer exists, and
	 * retrying those forever wastes every future send. Marking them inactive keeps the
	 * row (so a re-subscribe on the same endpoint can re-activate it) while removing it
	 * from the delivery set.
	 */
	deactivate(id: string): Effect.Effect<void, PushRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				await db
					.update(pushSubscription)
					.set({ isActive: false, updatedAt: new Date() })
					.where(eq(pushSubscription.id, id));
			});
		});
	}

	findVapidKeys(
		userId: string,
	): Effect.Effect<VapidKeys | null, PushRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const rows = await db
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
			});
		});
	}

	/**
	 * Store a keypair, or return the one that already exists.
	 *
	 * The unique constraint on `user_id` is the authority on "one keypair per user", so
	 * the insert is written to LOSE to it: `onConflictDoNothing` plus a read afterwards.
	 * Two racing callers then both receive the SAME keypair — the winner's — instead of
	 * the loser failing its request.
	 */
	insertVapidKeys(keys: VapidKeys): Effect.Effect<VapidKeys, PushRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				await db
					.insert(userVapidKeys)
					.values({
						// `id` is the primary key and is NOT database-defaulted, so it must be
						// supplied — and generated next to the insert that needs it, so a caller
						// cannot propose one.
						id: crypto.randomUUID(),
						userId: keys.userId,
						publicKey: keys.publicKey,
						privateKey: keys.privateKey,
						subject: keys.subject,
						createdAt: new Date(),
					})
					.onConflictDoNothing({ target: userVapidKeys.userId });

				const rows = await db
					.select()
					.from(userVapidKeys)
					.where(eq(userVapidKeys.userId, keys.userId))
					.limit(1);
				const stored = rows[0];
				if (stored === undefined) {
					// No conflict reported and no row present: the constraint and the read
					// disagree, which is a real inconsistency rather than a race worth retrying.
					throw new Error(`VAPID keys for ${keys.userId} were not stored and do not exist`);
				}
				return {
					userId: stored.userId,
					publicKey: stored.publicKey,
					privateKey: stored.privateKey,
					subject: stored.subject ?? "",
				};
			});
		});
	}
}
