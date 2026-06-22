import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeploymentController } from "./deployment.controller";
import { DeploymentService } from "../services/deployment.service";
import { DeploymentStreamOrchestratorService } from "../mesh/services/deployment-stream-orchestrator.service";

function createImplementMock() {
    type HandlerFn = (opts: { input: unknown; context: unknown }) => unknown;

    return {
        use: vi.fn().mockReturnThis(),
        handler: vi.fn((fn: HandlerFn) => ({ handler: fn })),
    };
}

vi.mock("@orpc/nest", () => ({
    implement: vi.fn(() => createImplementMock()),
    Implement: vi.fn(() => () => {}),
}));

vi.mock("@/core/modules/auth/orpc/middlewares", () => ({
    requireAuth: vi.fn(() => ({})),
    requireMesh: vi.fn(() => ({})),
    requirePlatformRole: vi.fn(() => ({})),
}));

describe("DeploymentController", () => {
    let controller: DeploymentController;
    let mockDeploymentService: {
        listDeployments: ReturnType<typeof vi.fn>;
        getDeploymentById: ReturnType<typeof vi.fn>;
        triggerDeployment: ReturnType<typeof vi.fn>;
        cancelDeployment: ReturnType<typeof vi.fn>;
        rollbackDeployment: ReturnType<typeof vi.fn>;
        getDeploymentLogs: ReturnType<typeof vi.fn>;
        deleteDeployment: ReturnType<typeof vi.fn>;
        retryDeployment: ReturnType<typeof vi.fn>;
        getRollbackHistory: ReturnType<typeof vi.fn>;
        streamDeploymentEvents: ReturnType<typeof vi.fn>;
        streamServiceEvents: ReturnType<typeof vi.fn>;
        streamQueryEvents: ReturnType<typeof vi.fn>;
        listStreamDefinitions: ReturnType<typeof vi.fn>;
        getStreamDefinitionById: ReturnType<typeof vi.fn>;
    };
    let mockDeploymentStreamOrchestratorService: {
        openDeploymentStream: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        mockDeploymentService = {
            listDeployments: vi.fn(),
            getDeploymentById: vi.fn(),
            triggerDeployment: vi.fn(),
            cancelDeployment: vi.fn(),
            rollbackDeployment: vi.fn(),
            getDeploymentLogs: vi.fn(),
            deleteDeployment: vi.fn(),
            retryDeployment: vi.fn(),
            getRollbackHistory: vi.fn(),
            streamDeploymentEvents: vi.fn(),
            streamServiceEvents: vi.fn(),
            streamQueryEvents: vi.fn(),
            listStreamDefinitions: vi.fn(),
            getStreamDefinitionById: vi.fn(),
        };

        mockDeploymentStreamOrchestratorService = {
            openDeploymentStream: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [DeploymentController],
            providers: [
                { provide: DeploymentService, useFactory: () => mockDeploymentService },
                {
                    provide: DeploymentStreamOrchestratorService,
                    useFactory: () => mockDeploymentStreamOrchestratorService,
                },
            ],
        }).compile();

        controller = module.get<DeploymentController>(DeploymentController);
    });

    it("should expose all handlers", () => {
        const methods: Array<keyof DeploymentController> = [
            "list",
            "findById",
            "trigger",
            "cancel",
            "rollback",
            "getLogs",
            "delete",
            "retry",
            "getRollbackHistory",
            "stream",
            "streamInternal",
            "streamService",
            "streamQuery",
            "streamsList",
            "streamFindById",
        ];

        for (const method of methods) {
            const impl = (controller[method] as () => unknown).call(controller) as { handler: unknown };
            expect(impl).toBeDefined();
            expect(typeof impl.handler).toBe("function");
        }
    });

    it("getLogs should forward pagination and filters to deployment service", async () => {
        const expected = { logs: [], total: 0, hasMore: false };
        mockDeploymentService.getDeploymentLogs.mockResolvedValue(expected);

        const impl = controller.getLogs() as any;
        const result = await impl.handler({
            input: {
                params: { id: "00000000-0000-0000-0000-000000000010" },
                query: {
                    limit: 100,
                    offset: 20,
                    includeRetrySummary: true,
                    level: "info",
                    phase: "deploying",
                    step: "convergence_policy",
                },
            },
            context: {},
        });

        expect(mockDeploymentService.getDeploymentLogs).toHaveBeenCalledWith(
            "00000000-0000-0000-0000-000000000010",
            100,
            20,
            {
                level: "info",
                phase: "deploying",
                step: "convergence_policy",
            },
            { includeRetrySummary: true },
        );
        expect(result).toEqual(expected);
    });

    it("stream should delegate orchestration to deployment stream orchestrator", () => {
        const proxiedStream = {
            async *[Symbol.asyncIterator]() {
                await Promise.resolve();
                yield {
                    type: "statusChanged",
                    status: "queued",
                    replayed: false,
                    sequence: 1,
                };
            },
        };
        mockDeploymentStreamOrchestratorService.openDeploymentStream.mockReturnValue(proxiedStream);

        const impl = controller.stream() as any;
        const returnedStream = impl.handler({
            input: {
                params: { id: "00000000-0000-0000-0000-000000000010" },
                query: { replay: true, replayLimit: 25 },
            },
            context: {
                request: {
                    headers: new Headers({
                        authorization: "Bearer test-token",
                        cookie: "sid=abc",
                    }),
                },
            },
        });

        expect(mockDeploymentStreamOrchestratorService.openDeploymentStream).toHaveBeenCalledWith({
            deploymentId: "00000000-0000-0000-0000-000000000010",
            replay: true,
            replayLimit: 25,
            context: expect.any(Object),
        });
        expect(returnedStream).toBe(proxiedStream);
    });

    it("streamQuery should delegate stream creation to deployment service", () => {
        const serviceStream = {
            async *[Symbol.asyncIterator]() {
                await Promise.resolve();
                yield { type: "statusChanged", sequence: 1, replayed: true };
            },
        };
        mockDeploymentService.streamQueryEvents.mockReturnValue(serviceStream);

        const impl = controller.streamQuery() as any;
        const returned = impl.handler({
            input: {
                query: {
                    deploymentId: "00000000-0000-0000-0000-000000000001",
                    replay: true,
                    replayLimit: 10,
                },
            },
            context: {},
        });

        expect(mockDeploymentService.streamQueryEvents).toHaveBeenCalledWith({
            deploymentId: "00000000-0000-0000-0000-000000000001",
            serviceId: undefined,
            projectId: undefined,
            aggregateId: undefined,
            eventType: undefined,
            since: undefined,
            cursor: undefined,
            replay: true,
            replayLimit: 10,
        });
        expect(returned).toBe(serviceStream);
    });

    it("streamInternal should delegate stream creation to deployment service", () => {
        const serviceStream = {
            async *[Symbol.asyncIterator]() {
                await Promise.resolve();
                yield { type: "statusChanged", sequence: 1, replayed: false };
            },
        };
        mockDeploymentService.streamDeploymentEvents.mockReturnValue(serviceStream);

        const impl = controller.streamInternal() as any;
        const returned = impl.handler({
            input: {
                params: { id: "00000000-0000-0000-0000-000000000001" },
                query: { replay: false, replayLimit: 10 },
            },
            context: {},
        });

        expect(mockDeploymentService.streamDeploymentEvents).toHaveBeenCalledWith({
            deploymentId: "00000000-0000-0000-0000-000000000001",
            replay: false,
            replayLimit: 10,
        });
        expect(returned).toBe(serviceStream);
    });
});
