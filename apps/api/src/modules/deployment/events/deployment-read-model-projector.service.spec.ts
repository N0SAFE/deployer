import { describe, expect, it, vi, beforeEach } from "vitest";
import type { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import type { DeploymentRepository } from "../repositories/deployment.repository";
import { DeploymentReadModelProjectorService } from "./deployment-read-model-projector.service";

function createEventRow(input: {
    id: string;
    createdAt: string;
    deploymentId: string;
    logId: string;
    eventType?: string;
}) {
    return {
        id: input.id,
        topic: "deployment.lifecycle",
        state: "sent",
        payload: {
            eventId: `${input.id}0000-0000-4000-8000-000000000000`.slice(0, 36),
            aggregateType: "deployment",
            aggregateId: input.deploymentId,
            eventType: input.eventType ?? "deployment.lifecycle.build.build_completed",
            version: "1",
            occurredAt: input.createdAt,
            payload: {
                deploymentId: input.deploymentId,
                logId: input.logId,
                level: "info",
                phase: "building",
                step: "build_completed",
                timestamp: input.createdAt,
            },
            metadata: { source: "test" },
        },
        createdAt: new Date(input.createdAt),
    };
}

describe("DeploymentReadModelProjectorService", () => {
    let selectQueue: unknown[][];
    let mockDb: GlobalDatabaseService;
    let mockRepository: DeploymentRepository;
    let service: DeploymentReadModelProjectorService;

    beforeEach(() => {
        selectQueue = [];

        mockDb = {
            db: {
                select: vi.fn(() => ({
                    from: vi.fn(() => ({
                        where: vi.fn(() => ({
                            orderBy: vi.fn(() => ({
                                limit: vi.fn(async () => selectQueue.shift() ?? []),
                            })),
                        })),
                    })),
                })),
            },
        } as unknown as GlobalDatabaseService;

        mockRepository = {
            findLogs: vi.fn(async () => []),
        } as unknown as DeploymentRepository;

        service = new DeploymentReadModelProjectorService(mockDb, mockRepository);
    });

    it("processes canonical outbox envelopes into deployment projections", async () => {
        selectQueue.push([
            createEventRow({
                id: "11111111-1111-4111-8111-111111111111",
                createdAt: "2026-03-21T20:00:00.000Z",
                deploymentId: "deploy-1",
                logId: "log-1",
            }),
        ]);

        const processed = await service.processOutboxBatch(10);

        expect(processed).toBe(1);
        expect(service.getProjection("deploy-1")).toMatchObject({
            deploymentId: "deploy-1",
            lastLogId: "log-1",
            lastEventType: "deployment.lifecycle.build.build_completed",
        });
    });

    it("rebuildAll replays all batches and refreshes latest projection snapshot", async () => {
        selectQueue.push(
            [
                createEventRow({
                    id: "11111111-1111-4111-8111-111111111111",
                    createdAt: "2026-03-21T20:00:00.000Z",
                    deploymentId: "deploy-1",
                    logId: "log-1",
                }),
            ],
            [
                createEventRow({
                    id: "22222222-2222-4222-8222-222222222222",
                    createdAt: "2026-03-21T20:01:00.000Z",
                    deploymentId: "deploy-1",
                    logId: "log-2",
                    eventType: "deployment.lifecycle.runtime.runtime_completed",
                }),
            ],
            [],
        );

        const replayed = await service.rebuildAll();

        expect(replayed).toBe(2);
        expect(service.getProjection("deploy-1")).toMatchObject({
            lastLogId: "log-2",
            lastEventType: "deployment.lifecycle.runtime.runtime_completed",
        });
    });

    it("detects drift when projection and latest source log diverge", async () => {
        selectQueue.push([
            createEventRow({
                id: "11111111-1111-4111-8111-111111111111",
                createdAt: "2026-03-21T20:00:00.000Z",
                deploymentId: "deploy-1",
                logId: "log-1",
            }),
        ]);

        await service.processOutboxBatch(10);

        vi.mocked(mockRepository.findLogs).mockResolvedValue([
            {
                id: "log-2",
                deploymentId: "deploy-1",
                level: "info",
                message: "newer",
                phase: "deploying",
                step: "runtime_execute",
                service: null,
                stage: "runtime",
                correlationId: null,
                traceId: null,
                spanId: null,
                metadata: null,
                timestamp: "2026-03-21T20:03:00.000Z",
            },
        ]);

        const report = await service.detectDrift("deploy-1");

        expect(report).toEqual({
            deploymentId: "deploy-1",
            driftDetected: true,
            reason: "last_log_mismatch",
            projectionLogId: "log-1",
            sourceLogId: "log-2",
        });
    });
});
