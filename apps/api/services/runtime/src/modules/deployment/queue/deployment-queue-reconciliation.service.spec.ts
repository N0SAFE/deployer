import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeploymentQueueReconciliationService } from "./deployment-queue-reconciliation.service";
import type { Deployment } from "@repo/contracts-entities";

const buildingRow = (id: string, metadata?: Record<string, unknown>): Deployment =>
    ({
        id,
        serviceId: "11111111-1111-4111-8111-111111111111",
        projectId: "33333333-3333-4333-8333-333333333333",
        environment: "production",
        status: "building",
        phase: "building",
        phaseProgress: 25,
        triggeredBy: null,
        environmentId: null,
        sourceType: "github",
        sourceConfig: { provider: "github", repository: "acme/app" },
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:05.000Z",
        metadata: metadata ?? null,
        buildStartedAt: "2026-08-29T00:00:01.000Z",
        buildCompletedAt: null,
        deployStartedAt: null,
        deployCompletedAt: null,
        containerName: null,
        containerImage: null,
        domainUrl: null,
        healthCheckUrl: null,
        errorMessage: null,
        phaseMetadata: null,
        phaseUpdatedAt: "2026-08-29T00:00:05.000Z",
    } as unknown as Deployment);

describe("DeploymentQueueReconciliationService", () => {
    let repository: {
        findMany: ReturnType<typeof vi.fn>;
        updateStatus: ReturnType<typeof vi.fn>;
        insertLog: ReturnType<typeof vi.fn>;
    };
    let queueLifecycle: { hasLiveJobForDeployment: ReturnType<typeof vi.fn> };
    let service: DeploymentQueueReconciliationService;

    beforeEach(() => {
        repository = {
            findMany: vi.fn(async () => ({ data: [], meta: { total: 0, limit: 500, offset: 0, hasMore: false } })),
            updateStatus: vi.fn(async () => null),
            insertLog: vi.fn(async () => undefined),
        };
        queueLifecycle = {
            hasLiveJobForDeployment: vi.fn(() => false),
        };
        service = new DeploymentQueueReconciliationService(repository as never, queueLifecycle as never);
        vi.clearAllMocks();
    });

    it("marks orphaned 'building' rows as failed with a crash-reason metadata + log (W-Queue Q3)", async () => {
        repository.findMany.mockResolvedValue({
            data: [buildingRow("deployment-a"), buildingRow("deployment-b", { buildExecution: { status: "started" } })],
            meta: { total: 2, limit: 500, offset: 0, hasMore: false },
        });

        const reconciled = await service.reconcileOrphanedInFlightDeployments();

        expect(reconciled).toEqual(["deployment-a", "deployment-b"]);
        expect(repository.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ filter: { status: { operator: "eq", value: "building" } } }),
        );
        expect(repository.updateStatus).toHaveBeenCalledTimes(2);
        expect(repository.updateStatus).toHaveBeenCalledWith(
            "deployment-a",
            "failed",
            expect.objectContaining({ crashReconciledAt: expect.any(String) }),
        );
        // metadata merge: preserves existing row metadata
        const secondCall = repository.updateStatus.mock.calls[1];
        expect(secondCall).toBeDefined();
        expect((secondCall as unknown[])[2]).toMatchObject({ buildExecution: { status: "started" } });
        expect(repository.insertLog).toHaveBeenCalledTimes(2);
        const logInput = repository.insertLog.mock.calls[0]?.[1];
        expect(logInput).toMatchObject({ level: "error", phase: "failed", step: "startup_reconcile" });
    });

    it("does NOT fail a 'building' row that still has a live queue job", async () => {
        repository.findMany.mockResolvedValue({
            data: [buildingRow("deployment-live")],
            meta: { total: 1, limit: 500, offset: 0, hasMore: false },
        });
        queueLifecycle.hasLiveJobForDeployment.mockReturnValue(true);

        const reconciled = await service.reconcileOrphanedInFlightDeployments();

        expect(reconciled).toEqual([]);
        expect(repository.updateStatus).not.toHaveBeenCalled();
        expect(repository.insertLog).not.toHaveBeenCalled();
    });

    it("reconciles nothing when there are no building rows", async () => {
        const reconciled = await service.reconcileOrphanedInFlightDeployments();
        expect(reconciled).toEqual([]);
        expect(repository.updateStatus).not.toHaveBeenCalled();
    });
});