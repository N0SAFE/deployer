import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RuntimeNotFound } from "../../../core/runtime.errors";

import { makeDeploymentQueueLifecycle, type DeploymentQueueLifecycleShape } from "./deployment-queue-lifecycle.service";
import { makeInMemoryDeploymentQueueRepository } from "./repositories/in-memory-deployment-queue.repository";

/**
 * What the lifecycle service itself owns: the typed events, the RxJS
 * `onJobQueued` channel and the sweep that re-announces claimable jobs. The storage rules (idempotency, guarded
 * claims, retry vs dead-letter, lease reaping) are the repository's, proven against Postgres in
 * `deployment-queue.e2e-spec.ts`; here they run on the in-memory repository.
 */
describe("DeploymentQueueLifecycleService", () => {
    const basePayload = {
        deploymentId: "11111111-1111-4111-8111-111111111111",
        serviceId: "22222222-2222-4222-8222-222222222222",
        projectId: "33333333-3333-4333-8333-333333333333",
        environment: "production",
        context: {},
    } as const;

    let eventService: { emit: ReturnType<typeof vi.fn> };
    let service: DeploymentQueueLifecycleShape;
    let repository: ReturnType<typeof makeInMemoryDeploymentQueueRepository>;
    const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

    const claimInput = { workerId: "w1", limit: 1, leaseDurationSec: 60 };
    const enqueue = (key: string, extra: { maxAttempts?: number } = {}) =>
        run(service.enqueueQueueJob({ type: "deploy", idempotencyKey: key, payload: basePayload, maxAttempts: extra.maxAttempts ?? 3 }));
    const emitted = (event: string) => eventService.emit.mock.calls.filter((call) => call[0] === event);

    beforeEach(() => {
        eventService = { emit: vi.fn() };
        repository = makeInMemoryDeploymentQueueRepository();
        service = makeDeploymentQueueLifecycle({ repository, events: eventService as never });
    });

    afterEach(async () => {
        await run(service.onStop?.() ?? Effect.void);
        vi.useRealTimers();
    });

    it("emits jobEnqueued once for a new job", async () => {
        const result = await enqueue("k-enqueue");

        expect(result).toMatchObject({ enqueued: true, deduplicated: false });
        expect(emitted("jobEnqueued")).toHaveLength(1);
    });

    it("announces a new job on onJobQueued, but not a deduplicated enqueue", async () => {
        const seen: string[] = [];
        service.jobQueued$.subscribe((job) => seen.push(job.id));

        const first = await enqueue("k-dedupe");
        const second = await enqueue("k-dedupe");

        expect(second.deduplicated).toBe(true);
        expect(seen).toEqual([first.job.id]);
        expect(emitted("jobEnqueued")).toHaveLength(1);
    });

    it("emits claim, heartbeat and completion events for the holder only", async () => {
        const { job } = await enqueue("k-flow");
        const claimed = await run(service.claimQueueJobByIdempotencyKey("k-flow", claimInput));
        const lockToken = claimed?.lockToken ?? "";

        expect(await run(service.heartbeatQueueJob(job.id, { workerId: "intruder", lockToken, extendLeaseSec: 60 }))).toBeNull();
        const beat = await run(service.heartbeatQueueJob(job.id, { workerId: "w1", lockToken, extendLeaseSec: 60 }));
        expect(beat?.acknowledged).toBe(true);

        const done = await run(service.completeQueueJob(job.id, "w1", lockToken, { image: "x" }));
        expect(done?.job.status).toBe("succeeded");
        expect(emitted("jobClaimed")).toHaveLength(1);
        expect(emitted("jobHeartbeat")).toHaveLength(1);
        expect(emitted("jobCompleted")).toHaveLength(1);
    });

    it("re-announces a retry when it becomes claimable, and dead-letters once attempts are spent", async () => {
        vi.useFakeTimers();
        const seen: string[] = [];
        service.jobQueued$.subscribe((job) => seen.push(job.id));
        const { job } = await enqueue("k-retry", { maxAttempts: 2 });
        const first = await run(service.claimQueueJobByIdempotencyKey("k-retry", claimInput));

        const retried = await run(service.failQueueJob(job.id, { workerId: "w1", lockToken: first?.lockToken ?? "", error: "boom", retryable: true }));
        expect(retried?.movedToDeadLetter).toBe(false);
        expect(seen).toEqual([job.id]);

        await vi.advanceTimersByTimeAsync(5_001);
        expect(seen).toEqual([job.id, job.id]);

        const second = await run(service.claimQueueJobByIdempotencyKey("k-retry", { ...claimInput, workerId: "w2" }));
        const dead = await run(service.failQueueJob(job.id, { workerId: "w2", lockToken: second?.lockToken ?? "", error: "again", retryable: true }));
        expect(dead?.movedToDeadLetter).toBe(true);
        expect(emitted("jobFailed").map((call) => call[2].movedToDeadLetter)).toEqual([false, true]);
        expect((await run(service.listDeadLetterJobs({ limit: 10, offset: 0 }))).total).toBe(1);
    });

    it("cancelling a queued retry stops its re-announcement", async () => {
        vi.useFakeTimers();
        const seen: string[] = [];
        const { job } = await enqueue("k-cancel");
        const claimed = await run(service.claimQueueJobByIdempotencyKey("k-cancel", claimInput));
        await run(service.failQueueJob(job.id, { workerId: "w1", lockToken: claimed?.lockToken ?? "", error: "boom", retryable: true }));
        service.jobQueued$.subscribe((queued) => seen.push(queued.id));

        const cancelled = await run(service.cancelQueueJob(job.id, "operator"));
        await vi.advanceTimersByTimeAsync(10_000);

        expect(cancelled?.status).toBe("cancelled");
        expect(seen).toEqual([]);
    });

    it("reaps an expired lease back to the pool and reports it as a non-dead-letter failure", async () => {
        const { job } = await enqueue("k-reap");
        await run(service.claimQueueJobByIdempotencyKey("k-reap", claimInput));

        expect(await run(service.reapExpiredLeases(new Date()))).toBe(0);
        expect(await run(service.reapExpiredLeases(new Date(Date.now() + 120_000)))).toBe(1);

        expect((await run(service.findQueueJobById(job.id)))?.status).toBe("queued");
        expect(emitted("jobFailed")[0]?.[2]).toMatchObject({ movedToDeadLetter: false, error: expect.stringContaining("lease expired") });
    });

    it("the sweep re-announces jobs that were enqueued before a restart", async () => {
        const { job } = await enqueue("k-sweep");
        const restarted = makeDeploymentQueueLifecycle({ repository, events: eventService as never });
        const seen: string[] = [];
        restarted.jobQueued$.subscribe((queued) => seen.push(queued.id));

        await run(restarted.sweep());

        expect(seen).toEqual([job.id]);
    });

    it("replays a dead letter as a fresh job and refuses an unknown one", async () => {
        const { job } = await enqueue("k-replay", { maxAttempts: 1 });
        const claimed = await run(service.claimQueueJobByIdempotencyKey("k-replay", claimInput));
        const dead = await run(service.failQueueJob(job.id, { workerId: "w1", lockToken: claimed?.lockToken ?? "", error: "bad", retryable: false }));
        const deadId = dead?.movedToDeadLetter ? (await run(service.listDeadLetterJobs({ limit: 1, offset: 0 }))).items[0]?.id ?? "" : "";

        const replayed = await run(service.replayDeadLetterJob({ deadLetterJobId: deadId, replayMode: "same_payload", requestedBy: "op", reason: "retry" }));
        expect(replayed).toMatchObject({ replayed: true, replayCount: 1 });
        expect(emitted("deadLetterReplayed")).toHaveLength(1);

        const refused = await run(
            Effect.flip(service.replayDeadLetterJob({ deadLetterJobId: "00000000-0000-4000-8000-000000000000", replayMode: "same_payload", requestedBy: "op", reason: "x" })),
        );
        expect(refused).toBeInstanceOf(RuntimeNotFound);
    });

    it("cancelling a deployment cancels its live jobs and tells the worker", async () => {
        const { job } = await enqueue("k-cancel-deployment");
        await run(service.claimQueueJobByIdempotencyKey("k-cancel-deployment", claimInput));
        const cancelled: string[] = [];
        service.jobCancelled$.subscribe((item) => cancelled.push(item.id));

        const result = await run(service.cancelJobsForDeployment(basePayload.deploymentId, "operator"));

        expect(result.map((item) => item.id)).toEqual([job.id]);
        expect(cancelled).toEqual([job.id]);
        expect((await run(service.findQueueJobById(job.id)))?.status).toBe("cancelled");
        expect(await run(service.cancelJobsForDeployment(basePayload.deploymentId, "again"))).toEqual([]);
    });
});
