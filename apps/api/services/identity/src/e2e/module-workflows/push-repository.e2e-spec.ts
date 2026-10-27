import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { getSharedApiRuntimeContext, type SharedApiRuntimeContext } from "@/e2e/runtime";
import { GlobalDatabaseService } from "@deployer/shared/core/modules/database/services/global-database.service";
import { user } from "@deployer/nest-schema/global/identity/auth";
import { DatabasePort, type DatabaseShape } from "@identity/core/database/database.port";
import { PushRepository, type PushRepositoryShape } from "@/modules/push/repositories/push.repository";
import type { PushRepositoryFailure } from "@/modules/push/push.failures";

/**
 * The push repository against a REAL Postgres.
 *
 * Its behaviour is SQL: an upsert that re-binds an endpoint to a new owner, a delete scoped to
 * the owner, a deliverable count that excludes banned users. A stubbed query chain would assert
 * the calls rather than the outcome, so these run against the database the harness provides.
 */
describe("Push repository e2e: the SQL rules", () => {
	let repository: PushRepositoryShape;
	let database: DatabaseShape;
	let db: GlobalDatabaseService["db"];

	const run = <A>(effect: Effect.Effect<A, PushRepositoryFailure, DatabasePort>) =>
		Effect.runPromise(effect.pipe(Effect.provideService(DatabasePort, database)));

	const newUser = async (overrides: { banned?: boolean } = {}) => {
		const id = `e2e-push-${randomUUID()}`;
		const now = new Date();
		await db.insert(user).values({
			id,
			name: id,
			email: `${id}@example.test`,
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
			role: "viewer",
			...(overrides.banned === undefined ? {} : { banned: overrides.banned }),
		});
		return id;
	};

	const endpoint = () => `https://push.example.test/send/${randomUUID()}`;
	const subscription = (userId: string, overrides: Partial<{ endpoint: string; p256dh: string }> = {}) => ({
		userId,
		endpoint: overrides.endpoint ?? endpoint(),
		p256dh: overrides.p256dh ?? "p".repeat(80),
		auth: "a".repeat(20),
	});

	beforeAll(async () => {
		const runtime: SharedApiRuntimeContext = await getSharedApiRuntimeContext();
		const globalDatabase = runtime.serviceMapper.get(GlobalDatabaseService);
		db = globalDatabase.db;
		database = { db };
		repository = runtime.serviceMapper.get(PushRepository) as unknown as PushRepositoryShape;
	});

	it("stores a subscription and finds it by endpoint", async () => {
		const owner = await newUser();
		const input = subscription(owner);

		const stored = await run(repository.upsert(input));
		const found = await run(repository.findByEndpoint(input.endpoint));

		expect(stored).toMatchObject({ userId: owner, endpoint: input.endpoint, isActive: true });
		expect(found?.id).toBe(stored.id);
		await expect(run(repository.findByEndpoint(endpoint()))).resolves.toBeNull();
	});

	it("re-binds an existing endpoint to the new owner and refreshes its keys, instead of failing", async () => {
		const first = await newUser();
		const second = await newUser();
		const input = subscription(first);
		const original = await run(repository.upsert(input));

		const rebound = await run(repository.upsert({ ...input, userId: second, p256dh: "q".repeat(80) }));

		expect(rebound.id).toBe(original.id);
		expect(rebound).toMatchObject({ userId: second, p256dh: "q".repeat(80), isActive: true });
		await expect(run(repository.listByUser(first, false))).resolves.toHaveLength(0);
	});

	it("re-activates a deactivated endpoint when it subscribes again", async () => {
		const owner = await newUser();
		const input = subscription(owner);
		const stored = await run(repository.upsert(input));
		await run(repository.deactivate(stored.id));

		const again = await run(repository.upsert(input));

		expect(again.isActive).toBe(true);
	});

	it("lists and counts a user's devices, optionally only the active ones", async () => {
		const owner = await newUser();
		const active = await run(repository.upsert(subscription(owner)));
		const retired = await run(repository.upsert(subscription(owner)));
		await run(repository.deactivate(retired.id));

		await expect(run(repository.countByUser(owner, false))).resolves.toBe(2);
		await expect(run(repository.countByUser(owner, true))).resolves.toBe(1);
		const listed = await run(repository.listByUser(owner, true));
		expect(listed.map((row) => row.id)).toEqual([active.id]);
	});

	it("deletes an endpoint only for its owner", async () => {
		const owner = await newUser();
		const stranger = await newUser();
		const input = subscription(owner);
		await run(repository.upsert(input));

		await expect(run(repository.deleteByEndpointForUser(stranger, input.endpoint))).resolves.toBe(false);
		await expect(run(repository.findByEndpoint(input.endpoint))).resolves.not.toBeNull();

		await expect(run(repository.deleteByEndpointForUser(owner, input.endpoint))).resolves.toBe(true);
		await expect(run(repository.findByEndpoint(input.endpoint))).resolves.toBeNull();
	});

	it("records the last use of a subscription", async () => {
		const owner = await newUser();
		const stored = await run(repository.upsert(subscription(owner)));
		expect(stored.lastUsedAt ?? null).toBeNull();

		await run(repository.markUsed(stored.id));

		const after = await run(repository.findByEndpoint(stored.endpoint));
		expect(after?.lastUsedAt).toBeInstanceOf(Date);
	});

	it("counts as deliverable only active subscriptions of users who are not banned", async () => {
		const before = await run(repository.countDeliverable());
		const healthy = await newUser();
		const banned = await newUser({ banned: true });
		await run(repository.upsert(subscription(healthy)));
		const retired = await run(repository.upsert(subscription(healthy)));
		await run(repository.deactivate(retired.id));
		await run(repository.upsert(subscription(banned)));

		const after = await run(repository.countDeliverable());

		// +1: the healthy user's active device. Not the retired one, not the banned user's.
		expect(after - before).toBe(1);
	});

	it("keeps one VAPID keypair per user: a second insert returns the first", async () => {
		const owner = await newUser();
		await expect(run(repository.findVapidKeys(owner))).resolves.toBeNull();

		const first = await run(
			repository.insertVapidKeys({ userId: owner, publicKey: "pub-1", privateKey: "priv-1", subject: "mailto:a@b.c" }),
		);
		const second = await run(
			repository.insertVapidKeys({ userId: owner, publicKey: "pub-2", privateKey: "priv-2", subject: "mailto:x@y.z" }),
		);

		expect(first.publicKey).toBe("pub-1");
		expect(second.publicKey).toBe("pub-1");
		await expect(run(repository.findVapidKeys(owner))).resolves.toMatchObject({ publicKey: "pub-1" });
	});
});
