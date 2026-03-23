import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeploymentQueueLifecycleService } from "./deployment-queue-lifecycle.service";

describe("DeploymentQueueLifecycleService", () => {
    const basePayload = {
        deploymentId: "11111111-1111-4111-8111-111111111111",
        serviceId: "22222222-2222-4222-8222-222222222222",
        projectId: "33333333-3333-4333-8333-333333333333",
        environment: "production",
        observability: null,
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
        } as never);

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

    it("replicates claim transition through internal mesh queue transition service", () => {
        const enqueued = service.enqueueQueueJob({
            type: "deploy",
            idempotencyKey: "job:idem:2",
            payload: basePayload,
            maxAttempts: 3,
        } as never);

        service.claimQueueJobs({
            workerId: "44444444-4444-4444-8444-444444444444",
            limit: 1,
            leaseDurationSec: 30,
        } as never);

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
        } as never);

        vi.clearAllMocks();

        const duplicate = service.enqueueQueueJob({
            type: "deploy",
            idempotencyKey: "job:idem:3",
            payload: basePayload,
            maxAttempts: 3,
        } as never);

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
        } as never);
        const second = service.enqueueQueueJob({
            type: "deploy",
            idempotencyKey: "job:idem:5",
            payload: {
                ...basePayload,
                deploymentId: "bbbbbbbb-2222-4222-8222-222222222222",
            },
            maxAttempts: 3,
        } as never);

        const claimed = service.claimQueueJobByIdempotencyKey("job:idem:5", {
            workerId: "55555555-5555-4555-8555-555555555555",
            limit: 1,
            leaseDurationSec: 30,
            types: ["deploy"],
        } as never);

        expect(claimed?.id).toBe(second.job.id);
        expect(service.findQueueJobById(first.job.id)?.status).toBe("queued");
        expect(service.findQueueJobById(second.job.id)?.status).toBe("claimed");
    });
});
