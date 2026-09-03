import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeploymentQueueJob } from "@repo/contracts-entities";
import { DeploymentQueueLifecycleService } from "./deployment-queue-lifecycle.service";

describe("DeploymentQueueLifecycleService", () => {
    const basePayload = {
        deploymentId: "11111111-1111-4111-8111-111111111111",
        serviceId: "22222222-2222-4222-8222-222222222222",
        projectId: "33333333-3333-4333-8333-333333333333",
        environment: "production",
        context: {},
    } as const;

    let eventService: { emit: ReturnType<typeof vi.fn> };
    let meshQueueTransitionService: { appendAndReplicate: ReturnType<typeof vi.fn> };
    let service: DeploymentQueueLifecycleService;

    beforeEach(() => {
        eventService = {
            emit: vi.fn(),
        };
        meshQueueTransitionService = {
            appendAndReplicate: vi.fn().mockResolvedValue({ appended: true }),
        };
        service = new DeploymentQueueLifecycleService(
            eventService as never,
            meshQueueTransitionService as never,
        );
        vi.clearAllMocks();
    });

    it("replicates enqueue transition through internal mesh queue transition service", () => {
        const result = service.enqueueQueueJob({
            type: "deploy",
            idempotencyKey: "job:idem:1",
            payload: basePayload,
            maxAttempts: 3,
        });

        expect(result.enqueued).toBe(true);
        expect(meshQueueTransitionService.appendAndReplicate).toHaveBeenCalledWith(
            expect.objectContaining({
                queue: "deployment",
                fromStatus: null,
                toStatus: "queued",
                jobId: result.job.id,
                partitionKey: `deployment:${basePayload.deploymentId}`,
            }),
        );
    });

    it("emits NEWLY enqueued jobs on the typed channel (D-6) — deduplicates do not re-emit", () => {
        const seen: string[] = [];
        const sub = service.onJobQueued().subscribe((job) => seen.push(job.idempotencyKey));

        const first = service.enqueueQueueJob({
            type: "deploy",
            idempotencyKey: "job:idem:chan-1",
            payload: basePayload,
            maxAttempts: 3,
        });
        // Same idempotency key → deduplicated, NO re-emit.
        const dedup = service.enqueueQueueJob({
            type: "deploy",
            idempotencyKey: "job:idem:chan-1",
            payload: basePayload,
            maxAttempts: 3,
        });
        const second = service.enqueueQueueJob({
            type: "retry",
            idempotencyKey: "job:idem:chan-2",
            payload: basePayload,
            maxAttempts: 3,
        });

        expect(dedup.deduplicated).toBe(true);
        expect(seen).toEqual([first.job.idempotencyKey, second.job.idempotencyKey]);
        sub.unsubscribe();
    });

    it("re-emits a RETRIED job on the typed channel when it becomes available (W-Queue Q1)", () => {
        vi.useFakeTimers();
        try {
            const seen: Array<{ key: string; attempts: number; status: DeploymentQueueJob["status"] }> = [];
            const sub = service.onJobQueued().subscribe((job) =>
                seen.push({ key: job.idempotencyKey, attempts: job.attempts, status: job.status }),
            );

            const enqueued = service.enqueueQueueJob({
                type: "deploy",
                idempotencyKey: "job:idem:retry-channel-1",
                payload: basePayload,
                maxAttempts: 3,
            });

            const claimed = service.claimQueueJobs({
                workerId: "worker-retry-1",
                limit: 1,
                leaseDurationSec: 30,
            });
            const claimedJob = claimed.claimed[0];
            if (!claimedJob) {
                throw new Error("expected a claimed job");
            }

            const failed = service.failQueueJob(claimedJob.id, {
                workerId: "worker-retry-1",
                lockToken: claimedJob.lockToken ?? "",
                error: "transient build failure",
                retryable: true,
            });

            expect(failed?.movedToDeadLetter).toBe(false);
            expect(failed?.failedJob.status).toBe("queued");
            expect(failed?.failedJob.attempts).toBe(1);

            // Retry is NOT re-emitted immediately (availableAt = now + 5s) —
            // before the timer fires, only the initial enqueue emitted.
            expect(seen).toHaveLength(1);

            // Advance past the retry availability window → the retried job is
            // re-emitted on the worker channel with attempts = 1.
            vi.advanceTimersByTime(5_001);
            expect(seen).toHaveLength(2);
            expect(seen[1]).toEqual({
                key: enqueued.job.idempotencyKey,
                attempts: 1,
                status: "queued",
            });

            sub.unsubscribe();
        } finally {
            service.onModuleDestroy();
            vi.useRealTimers();
        }
    });

    it("skips the retry re-emit if the job is gone or no longer queued (timer race safety)", () => {
        vi.useFakeTimers();
        try {
            const seen: string[] = [];
            const sub = service.onJobQueued().subscribe((job) => seen.push(job.idempotencyKey));

            const enqueued = service.enqueueQueueJob({
                type: "deploy",
                idempotencyKey: "job:idem:retry-race-1",
                payload: basePayload,
                maxAttempts: 3,
            });

            const claimed = service.claimQueueJobs({ workerId: "worker-race-1", limit: 1, leaseDurationSec: 30 });
            const claimedJob = claimed.claimed[0];
            if (!claimedJob) {
                throw new Error("expected a claimed job");
            }

            service.failQueueJob(claimedJob.id, {
                workerId: "worker-race-1",
                lockToken: claimedJob.lockToken ?? "",
                error: "boom",
                retryable: true,
            });

            // Simulate the job being completed/removed before the retry timer fires
            // (e.g. DLQ replay + manual completion on a different worker).
            const current = service.getQueueJobsStore().get(claimedJob.id);
            expect(current?.status).toBe("queued");
            service.getQueueJobsStore().set(claimedJob.id, {
                ...current!,
                status: "running",
                workerId: "worker-other",
            });

            vi.advanceTimersByTime(5_001);

            // Only the initial enqueue emitted — the stale retry was NOT re-emitted.
            expect(seen).toHaveLength(1);
            expect(seen[0]).toBe(enqueued.job.idempotencyKey);
            sub.unsubscribe();
        } finally {
            service.onModuleDestroy();
            vi.useRealTimers();
        }
    });

    it("replicates claim transition through internal mesh queue transition service", () => {
        const enqueued = service.enqueueQueueJob({
            type: "deploy",
            idempotencyKey: "job:idem:2",
            payload: basePayload,
            maxAttempts: 3,
        });

        service.claimQueueJobs({
            workerId: "44444444-4444-4444-8444-444444444444",
            limit: 1,
            leaseDurationSec: 30,
        });

        expect(meshQueueTransitionService.appendAndReplicate).toHaveBeenCalledWith(
            expect.objectContaining({
                queue: "deployment",
                fromStatus: "queued",
                toStatus: "claimed",
                jobId: enqueued.job.id,
            }),
        );
    });

    it("does not replicate when enqueue is deduplicated", () => {
        service.enqueueQueueJob({
            type: "deploy",
            idempotencyKey: "job:idem:3",
            payload: basePayload,
            maxAttempts: 3,
        });

        vi.clearAllMocks();

        const duplicate = service.enqueueQueueJob({
            type: "deploy",
            idempotencyKey: "job:idem:3",
            payload: basePayload,
            maxAttempts: 3,
        });

        expect(duplicate.deduplicated).toBe(true);
        expect(meshQueueTransitionService.appendAndReplicate).not.toHaveBeenCalled();
    });

    it("claims a specific queued job by idempotency key", () => {
        const first = service.enqueueQueueJob({
            type: "deploy",
            idempotencyKey: "job:idem:4",
            payload: {
                ...basePayload,
                deploymentId: "aaaaaaaa-1111-4111-8111-111111111111",
            },
            maxAttempts: 3,
        });
        const second = service.enqueueQueueJob({
            type: "deploy",
            idempotencyKey: "job:idem:5",
            payload: {
                ...basePayload,
                deploymentId: "bbbbbbbb-2222-4222-8222-222222222222",
            },
            maxAttempts: 3,
        });

        const claimed = service.claimQueueJobByIdempotencyKey("job:idem:5", {
            workerId: "55555555-5555-4555-8555-555555555555",
            limit: 1,
            leaseDurationSec: 30,
            types: ["deploy"],
        });

        expect(claimed?.id).toBe(second.job.id);
        expect(service.findQueueJobById(first.job.id)?.status).toBe("queued");
        expect(service.findQueueJobById(second.job.id)?.status).toBe("claimed");
    });

    it("reaps claims whose lease expired and re-queues them claimable (W-Queue Q2)", () => {
        vi.useFakeTimers();
        try {
            service.enqueueQueueJob({
                type: "deploy",
                idempotencyKey: "job:idem:lease-1",
                payload: basePayload,
                maxAttempts: 3,
            });

            const claimed = service.claimQueueJobs({ workerId: "worker-leased", limit: 1, leaseDurationSec: 5 });
            const claimedJob = claimed.claimed[0];
            if (!claimedJob) {
                throw new Error("expected a claimed job");
            }

            // Lease expires 5s out; sweep BEFORE expiry → nothing reaped.
            expect(service.reapExpiredLeases()).toBe(0);
            expect(service.getQueueJobsStore().get(claimedJob.id)?.status).toBe("claimed");

            // Advance past the lease, sweep → released back to queued.
            vi.advanceTimersByTime(6_000);
            expect(service.reapExpiredLeases()).toBe(1);
            const released = service.getQueueJobsStore().get(claimedJob.id);
            expect(released?.status).toBe("queued");
            expect(released?.workerId).toBeNull();
            expect(released?.lockToken).toBeNull();
            expect(released?.leaseExpiresAt).toBeNull();
            expect(released?.attempts).toBe(0); // interrupted execution, not a failure

            // Advance past the re-claimability delay → a new worker can claim it.
            vi.advanceTimersByTime(2_000);
            const reClaimed = service.claimQueueJobs({ workerId: "worker-2", limit: 1, leaseDurationSec: 30 });
            expect(reClaimed.claimed[0]?.id).toBe(claimedJob.id);
        } finally {
            service.onModuleDestroy();
            vi.useRealTimers();
        }
    });

    it("does not reap jobs whose lease is still valid", () => {
        service.enqueueQueueJob({
            type: "deploy",
            idempotencyKey: "job:idem:lease-2",
            payload: basePayload,
            maxAttempts: 3,
        });
        service.claimQueueJobs({ workerId: "worker-live", limit: 1, leaseDurationSec: 120 });

        const reaped = service.reapExpiredLeases(Date.now() + 60_000);
        expect(reaped).toBe(0);
        const store = [...service.getQueueJobsStore().values()];
        expect(store[0]?.status).toBe("claimed");
    });
});
