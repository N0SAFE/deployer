import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeploymentStreamOrchestratorService } from "../mesh/services/deployment-stream-orchestrator.service";
import { DeploymentService } from "../services/deployment.service";

import { DeploymentController } from "./deployment.controller";

/**
 * Resolve a built procedure's handler.
 *
 * oRPC v2 keeps it on the `~orpc` descriptor; v1 exposed it as a top-level
 * property. Reading both keeps this assertion about the CONTRACT ("the
 * controller exposes a callable handler") rather than about the internal shape
 * of whichever oRPC version is installed.
 */
function procedureHandler(procedure: unknown): (...args: unknown[]) => unknown {
    const p = procedure as { handler?: unknown; "~orpc"?: { handler?: unknown } };
    const handler = p?.handler ?? p?.["~orpc"]?.handler;
    if (typeof handler !== "function") {
        throw new TypeError("procedure does not expose a handler");
    }
    return handler as (...args: unknown[]) => unknown;
}


function createImplementMock() {
    type HandlerFn = (opts: { input: unknown; context: unknown }) => unknown;

    return {
        use: vi.fn().mockReturnThis(),
        handler: vi.fn((fn: HandlerFn) => ({ handler: fn })),
        // `.effect()` handlers are generator functions; the procedure still exposes a callable handler.
        effect: vi.fn((fn: HandlerFn) => ({ handler: fn })),
    };
}

// oRPC v2 split these across packages: the `Implement` DECORATOR stays
// in `@orpc/nest`, lowercase `implement` lives in `@orpc/server`.
vi.mock("@orpc/nest", () => ({
    Implement: vi.fn(() => () => {}),
}));
vi.mock("@orpc/server", async (importOriginal) => ({
    // Spread the REAL module: these specs also import `ORPCError` from
    // here, and replacing the module wholesale would make it undefined.
    ...(await importOriginal<typeof import("@orpc/server")>()),
    implement: vi.fn(() => createImplementMock()),
}));

vi.mock("@deployer/shared/core/modules/auth/orpc/middlewares", () => ({
    requireAuth: vi.fn(() => ({})),
    requireMesh: vi.fn(() => ({})),
    requirePlatformRole: vi.fn(() => ({})),
    requireSystemActor: vi.fn(() => ({})),
}));

/** Drive an Effect handler with the deployment service (and the orchestrator) faked in the context. */
function runHandler(handler: (...args: unknown[]) => unknown, args: unknown, services: { deployments: unknown; orchestrator?: unknown }) {
    return Effect.runPromise(
        Effect.gen(function* () {
            return yield* handler(args) as Generator<never, unknown>;
        }).pipe(
            Effect.provideService(DeploymentService, services.deployments as never),
            Effect.provideService(DeploymentStreamOrchestratorService, (services.orchestrator ?? {}) as never),
        ),
    );
}

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

    beforeEach(() => {
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


        controller = new DeploymentController();
    });

    it("should expose all handlers", () => {
        const methods: (keyof DeploymentController)[] = [
            "list",
            "findById",
            "trigger",
            "triggerFromEvent",
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
            expect(typeof procedureHandler(impl)).toBe("function");
        }
    });


    it("getLogs should forward pagination and filters to deployment service", async () => {
        const expected = { logs: [], total: 0, hasMore: false };
        mockDeploymentService.getDeploymentLogs.mockReturnValue(Effect.succeed(expected));

        const impl = controller.getLogs() as any;
        const result = await runHandler(procedureHandler(impl), {
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
            context: {
                auth: { isLoggedIn: true, session: { id: "s1" }, user: { id: "u1", role: "admin" } },
                request: { headers: new Headers({ authorization: "Bearer test-token" }) },
            },
        }, { deployments: mockDeploymentService });

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

    it("stream should delegate orchestration to deployment stream orchestrator", async () => {
        const proxiedStream = { subscribe: vi.fn() };
        mockDeploymentStreamOrchestratorService.openDeploymentStream.mockReturnValue(Effect.succeed(proxiedStream));

        // The handler is an Effect generator: drive it with the orchestrator in the context.
        const handler = procedureHandler(controller.stream());
        const returnedStream = await Effect.runPromise(
            Effect.gen(function* () {
                return yield* handler({
                    input: {
                        params: { id: "00000000-0000-0000-0000-000000000010" },
                        query: { replay: true, replayLimit: 25 },
                    },
                    context: {
                        auth: { isLoggedIn: true, session: { id: "s1" }, user: { id: "u1", role: "admin" } },
                        request: { headers: new Headers({ authorization: "Bearer test-token" }) },
                    },
                } as never) as Generator<never, unknown>;
            }).pipe(
                Effect.provideService(DeploymentStreamOrchestratorService, mockDeploymentStreamOrchestratorService as never),
            ),
        );

        expect(mockDeploymentStreamOrchestratorService.openDeploymentStream).toHaveBeenCalledWith({
            deploymentId: "00000000-0000-0000-0000-000000000010",
            replay: true,
            replayLimit: 25,
        });
        expect(returnedStream).toBe(proxiedStream);
    });

    it("streamQuery should delegate stream creation to deployment service", async () => {
        const serviceStream = {
            async *[Symbol.asyncIterator]() {
                await Promise.resolve();
                yield { type: "statusChanged", sequence: 1, replayed: true };
            },
        };
        mockDeploymentService.streamQueryEvents.mockReturnValue(serviceStream);

        const impl = controller.streamQuery() as any;
        const returned = await runHandler(procedureHandler(impl), {
            input: {
                query: {
                    deploymentId: "00000000-0000-0000-0000-000000000001",
                    replay: true,
                    replayLimit: 10,
                },
            },
            context: {},
        }, { deployments: mockDeploymentService });

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

    it("streamInternal should delegate stream creation to deployment service", async () => {
        const serviceStream = {
            async *[Symbol.asyncIterator]() {
                await Promise.resolve();
                yield { type: "statusChanged", sequence: 1, replayed: false };
            },
        };
        mockDeploymentService.streamDeploymentEvents.mockReturnValue(serviceStream);

        const impl = controller.streamInternal() as any;
        const returned = await runHandler(procedureHandler(impl), {
            input: {
                params: { id: "00000000-0000-0000-0000-000000000001" },
                query: { replay: false, replayLimit: 10 },
            },
            context: {},
        }, { deployments: mockDeploymentService });

        expect(mockDeploymentService.streamDeploymentEvents).toHaveBeenCalledWith({
            deploymentId: "00000000-0000-0000-0000-000000000001",
            replay: false,
            replayLimit: 10,
        });
        expect(returned).toBe(serviceStream);
    });
});
