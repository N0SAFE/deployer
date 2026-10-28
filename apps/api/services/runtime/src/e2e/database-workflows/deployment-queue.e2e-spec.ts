import { randomUUID } from "node:crypto";

import { Effect } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { GlobalDatabaseService } from "@deployer/shared/core/modules/database/services/global-database.service";

import { RuntimeDatabasePort, RuntimeDb } from "@/core/database/runtime-db";
import { getSharedApiRuntimeContext } from "@/e2e/runtime";
import {
	DeploymentQueueRepository,
	type DeploymentQueueRepositoryShape,
} from "@/modules/deployment/queue/repositories/deployment-queue.repository";

/**
 * The durable queue against a REAL Postgres: what only a server can prove is that two workers claiming at the
 * same time never receive the same row, and that every write ending a claim is refused once the lease is gone.
 */
describe("DeploymentQueueRepository e2e", () => {
	let database: GlobalDatabaseService;
	const run = <A, E>(use: (queue: DeploymentQueueRepositoryShape) => Effect.Effect<A, E>) =>
		Effect.runPromise(
			Effect.gen(function* () {
				return yield* use(yield* DeploymentQueueRepository);
			}).pipe(
				Effect.provide(DeploymentQueueRepository.Live),
				Effect.provide(RuntimeDb.Live),
				Effect.provideService(RuntimeDatabasePort, database),
			),
		);

	/** A key no other test shares, so suites running against the same database never collide. */
	const key = (label: string) => `${label}-${randomUUID()}`;
	const enqueueInput = (idempotencyKey: string, extra: { maxAttempts?: number; availableAt?: string } = {}) => ({
		type: "deploy" as const,
		idempotencyKey,
		payload: { deploymentId: randomUUID(), context: {} },
		maxAttempts: extra.maxAttempts ?? 3,
		...(extra.availableAt === undefined ? {} : { availableAt: extra.availableAt }),
	});
	const claimInput = (workerId: string, limit = 1, leaseDurationSec = 60) => ({ workerId, limit, leaseDurationSec });

	beforeAll(async () => {
		const context = await getSharedApiRuntimeContext();
		database = context.serviceMapper.get(GlobalDatabaseService);
	});

	it("enqueues once per idempotency key and returns the first job the second time", async () => {
		const input = enqueueInput(key("dedupe"));
		const first = await run((q) => q.enqueue(input));
		const second = await run((q) => q.enqueue(input));

		expect(first.deduplicated).toBe(false);
		expect(second.deduplicated).toBe(true);
		expect(second.job.id).toBe(first.job.id);
		expect(first.job.status).toBe("queued");
	});

	it("never hands one job to two workers claiming at once", async () => {
		const label = key("race");
		const created = await Promise.all(Array.from({ length: 6 }, (_, i) => run((q) => q.enqueue(enqueueInput(`${label}-${String(i)}`)))));
		const ids = new Set(created.map((c) => c.job.id));

		const claims = await Promise.all(
			Array.from({ length: 4 }, (_, i) =>
				run((q) => q.claimByIdempotencyKey(`${label}-${String(i % 6)}`, claimInput(`w${String(i)}`))),
			),
		);
		const claimedIds = claims.filter((job) => job !== null).map((job) => job.id);
		expect(new Set(claimedIds).size).toBe(claimedIds.length);
		for (const id of claimedIds) expect(ids.has(id)).toBe(true);

		// Contend for the SAME rows from several workers: each row is delivered exactly once.
		const contended = await Promise.all(
			Array.from({ length: 5 }, (_, i) => run((q) => q.claim({ ...claimInput(`c${String(i)}`, 10), types: ["deploy"] }))),
		);
		const delivered = contended.flat().map((job) => job.id);
		expect(new Set(delivered).size).toBe(delivered.length);
	});

	it("only the holder can heartbeat or complete; after completion nobody can", async () => {
		const { job } = await run((q) => q.enqueue(enqueueInput(key("holder"))));
		const claimed = await run((q) => q.claimByIdempotencyKey(job.idempotencyKey, claimInput("w1")));
		expect(claimed?.status).toBe("claimed");
		const lockToken = claimed?.lockToken ?? "";

		expect(await run((q) => q.heartbeat(job.id, { workerId: "w2", lockToken, extendLeaseSec: 60 }))).toBeNull();
		expect(await run((q) => q.heartbeat(job.id, { workerId: "w1", lockToken: "stale", extendLeaseSec: 60 }))).toBeNull();

		const beat = await run((q) => q.heartbeat(job.id, { workerId: "w1", lockToken, extendLeaseSec: 60 }));
		expect(beat?.status).toBe("running");
		expect(beat?.lastHeartbeatAt).not.toBeNull();

		const done = await run((q) => q.complete(job.id, "w1", lockToken, { ok: true }));
		expect(done?.status).toBe("succeeded");
		expect(done?.metadata).toMatchObject({ result: { ok: true } });
		expect(await run((q) => q.complete(job.id, "w1", lockToken, undefined))).toBeNull();
	});

	it("re-queues a retryable failure, then dead-letters it once the attempts are spent", async () => {
		const { job } = await run((q) => q.enqueue(enqueueInput(key("retry"), { maxAttempts: 2 })));
		const first = await run((q) => q.claimByIdempotencyKey(job.idempotencyKey, claimInput("w1")));
		const retried = await run((q) =>
			q.fail(job.id, { workerId: "w1", lockToken: first?.lockToken ?? "", error: "boom", retryable: true, retryAt: new Date(Date.now() - 1000).toISOString() }),
		);
		expect(retried?.movedToDeadLetter).toBe(false);
		expect(retried?.job).toMatchObject({ status: "queued", attempts: 1, lastError: "boom", workerId: null });

		const second = await run((q) => q.claimByIdempotencyKey(job.idempotencyKey, claimInput("w2")));
		const dead = await run((q) => q.fail(job.id, { workerId: "w2", lockToken: second?.lockToken ?? "", error: "again", retryable: true }));
		expect(dead?.movedToDeadLetter).toBe(true);
		expect(dead?.job.status).toBe("failed");
		expect(dead?.deadLetterJob).toMatchObject({ originalJobId: job.id, reason: "max_attempts_exceeded", attempts: 2 });
	});

	it("dead-letters a non-retryable failure at once, and a replay enqueues a fresh job", async () => {
		const { job } = await run((q) => q.enqueue(enqueueInput(key("poison"))));
		const claimed = await run((q) => q.claimByIdempotencyKey(job.idempotencyKey, claimInput("w1")));
		const dead = await run((q) => q.fail(job.id, { workerId: "w1", lockToken: claimed?.lockToken ?? "", error: "bad config", retryable: false }));
		expect(dead?.deadLetterJob?.reason).toBe("non_retryable_error");

		const replayed = await run((q) =>
			q.replayDeadLetter(dead?.deadLetterJob?.id ?? "", { payload: job.payload, metadata: { replayMode: "same_payload" } }),
		);
		expect(replayed?.deadLetter.replayCount).toBe(1);
		expect(replayed?.job.status).toBe("queued");
		expect(replayed?.job.idempotencyKey).toBe(`${job.idempotencyKey}:replay:1`);
		expect(await run((q) => q.replayDeadLetter(randomUUID(), { payload: job.payload, metadata: {} }))).toBeNull();
	});

	it("cancels a live job once, and refuses to cancel a finished one", async () => {
		const { job } = await run((q) => q.enqueue(enqueueInput(key("cancel"))));
		const claimed = await run((q) => q.claimByIdempotencyKey(job.idempotencyKey, claimInput("w1")));

		const cancelled = await run((q) => q.cancel(job.id, "operator asked"));
		expect(cancelled).toMatchObject({ status: "cancelled", lastError: "operator asked", lockToken: null });
		expect(await run((q) => q.cancel(job.id, "again"))).toBeNull();
		// The worker that held it can no longer finish it.
		expect(await run((q) => q.complete(job.id, "w1", claimed?.lockToken ?? "", undefined))).toBeNull();
	});

	it("releases a job whose lease expired and leaves live leases alone", async () => {
		const expired = await run((q) => q.enqueue(enqueueInput(key("expired"))));
		const alive = await run((q) => q.enqueue(enqueueInput(key("alive"))));
		await run((q) => q.claimByIdempotencyKey(expired.job.idempotencyKey, claimInput("w1", 1, 10)));
		await run((q) => q.claimByIdempotencyKey(alive.job.idempotencyKey, claimInput("w2", 1, 600)));

		const released = await run((q) => q.reapExpiredLeases(new Date(Date.now() + 60_000)));
		const ids = released.map((j) => j.id);
		expect(ids).toContain(expired.job.id);
		expect(ids).not.toContain(alive.job.id);
		expect(released.find((j) => j.id === expired.job.id)).toMatchObject({ status: "queued", workerId: null, lockToken: null });
	});

	it("knows which deployments still have a live job", async () => {
		const input = enqueueInput(key("live"));
		const deploymentId = input.payload.deploymentId;
		expect(await run((q) => q.hasLiveJobForDeployment(deploymentId))).toBe(false);
		const { job } = await run((q) => q.enqueue(input));
		expect(await run((q) => q.hasLiveJobForDeployment(deploymentId))).toBe(true);
		await run((q) => q.cancel(job.id, "done"));
		expect(await run((q) => q.hasLiveJobForDeployment(deploymentId))).toBe(false);
	});

	it("lists by status and finds a job by id", async () => {
		const { job } = await run((q) => q.enqueue(enqueueInput(key("list"))));
		const found = await run((q) => q.findById(job.id));
		expect(found?.id).toBe(job.id);
		const page = await run((q) => q.list({ status: "queued", deploymentId: job.payload.deploymentId ?? "", limit: 10, offset: 0 }));
		expect(page.items.map((j) => j.id)).toEqual([job.id]);
		expect(page.total).toBe(1);
	});
});
