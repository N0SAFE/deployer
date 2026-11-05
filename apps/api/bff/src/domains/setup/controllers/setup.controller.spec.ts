import { Effect } from "effect";
import { Test } from "@nestjs/testing";
import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NodeConfigRepository } from "@deployer/node-state"

import {  EgressService } from "@/core/modules/egress/egress.service";
import { ReachabilityService } from "@/core/modules/reachability/services/reachability.service";
import { InitializationService } from "@/core/modules/setup/services/initialization.service";




import { SetupController } from "./setup.controller";


import type { TestingModule } from "@nestjs/testing";

/** Every handler the controller registers, in order: a Promise `handler` or an Effect generator `effect`. */
const registered: { kind: "handler" | "effect"; fn: unknown }[] = [];

function createImplementMock() {
    const chainable = {
        use: vi.fn().mockReturnThis(),
        handler: vi.fn((fn: unknown) => {
            registered.push({ kind: "handler", fn });
            return { handler: fn };
        }),
        effect: vi.fn((fn: unknown) => {
            registered.push({ kind: "effect", fn });
            return { effect: fn };
        }),
    };

    return chainable;
}

/**
 * Singleton chainable shared by every `implement()` call so handler fns
 * registered by the controller are observable via `handler.mock.calls`.
 */
const implementChainable = createImplementMock();

// oRPC v2 split these across packages: the `Implement` DECORATOR stays
// in `@orpc/nest`, lowercase `implement` lives in `@orpc/server`.
vi.mock("@orpc/nest", () => ({
    Implement: vi.fn(() => () => undefined),
}));
vi.mock("@orpc/server", async (importOriginal) => ({
    // Spread the REAL module: these specs also import `ORPCError` from
    // here, and replacing the module wholesale would make it undefined.
    ...(await importOriginal<typeof import("@orpc/server")>()),
    implement: vi.fn(() => implementChainable),
}));

vi.mock("@/core/modules/auth/orpc/middlewares", () => ({
    publicAccess: vi.fn(() => ({})),
}));

/**
 * Test double for the ORPC typed-errors parameter. Mirrors the runtime
 * behavior of `createORPCErrorConstructorMap`: accessing any code returns a
 * factory producing a real `ORPCError` so `instanceof` / `code` assertions
 * keep working.
 */
function makeErrorsParam(): Record<string, (options?: { message?: string; data?: unknown }) => ORPCError<string, unknown>> {
    return new Proxy({}, {
        get: (_target, code: string) =>
            (options?: { message?: string; data?: unknown }) =>
                new ORPCError(code, options ?? {}),
    });
}

describe("SetupController", () => {
    let controller: SetupController;
    let mockInitializationService: {
        getSetupState: ReturnType<typeof vi.fn>;
        getNodeStatus: ReturnType<typeof vi.fn>;
        assertSetupMutable: ReturnType<typeof vi.fn>;
        assertDatabaseProbeAllowed: ReturnType<typeof vi.fn>;
        triggerInitialize: ReturnType<typeof vi.fn>;
    };
    let mockReachabilityService: {
        checkMeshUrlReachability: ReturnType<typeof vi.fn>;
    };
    let mockEgress: { operator: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        mockInitializationService = {
            getSetupState: vi.fn(),
            getNodeStatus: vi.fn(),
            assertSetupMutable: vi.fn(() => Effect.void),
            assertDatabaseProbeAllowed: vi.fn(() => Effect.void),
            triggerInitialize: vi.fn(() => Effect.succeed({ accepted: true, delivered: true })),
        };
        mockReachabilityService = {
            checkMeshUrlReachability: vi.fn(),
        };
        mockEgress = { operator: vi.fn() };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [SetupController],
            providers: [
                {
                    provide: InitializationService,
                    useFactory: () => mockInitializationService,
                },
                {
                    provide: ReachabilityService,
                    useFactory: () => mockReachabilityService,
                },
                {
                    provide: EgressService,
                    useFactory: () => mockEgress,
                },
                {
                    provide: NodeConfigRepository,
                    useValue: { find: vi.fn(), upsert: vi.fn() },
                },
            ],
        }).compile();

        controller = module.get<SetupController>(SetupController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });

    it("should expose getStatus REST fallback delegating to InitializationService.getSetupState", async () => {
        const mockState = {
            state: "not_started",
            needsSetup: true,
            strategy: null,
            currentStep: "choose_strategy",
            progressPercent: 0,
            steps: [],
            completedAt: null,
        };
        mockInitializationService.getSetupState.mockReturnValue(Effect.succeed(mockState));
        controller.getState();
        expect(await lastHandler()({})).toBe(mockState);
    });

    /** The handler the controller registered last. */
    const lastHandler = () => {
        const last = registered.at(-1);
        if (last === undefined) throw new Error("no handler registered");
        if (last.kind === "handler") return last.fn as (args: unknown) => Promise<unknown>;
        // An Effect handler: run it with the collaborators the module would provide.
        return (args: unknown) =>
            Effect.runPromise(
                Effect.gen(() => (last.fn as (a: unknown) => Generator<never, unknown>)(args) as never).pipe(
                    Effect.provideService(InitializationService, mockInitializationService as never),
                    Effect.provideService(NodeConfigRepository, { find: vi.fn(), upsert: vi.fn() } as never),
                ) as never,
            );
    };

    /**
     * SEC-012 / SETUP-002 — `/setup/*` is anonymous. Once the node is
     * configured every MUTATION must refuse; the controller's job is only to ask
     * the service, where the rule lives.
     */
    describe("post-setup refusal", () => {
        const conflict = () =>
            new ORPCError("CONFLICT", { message: "Setup is already complete on this node" });

        beforeEach(() => {
            mockInitializationService.assertSetupMutable.mockReturnValue(Effect.fail(conflict()));
        });

        it("refuses triggerInitialize", async () => {
            controller.triggerInitialize();

            await expect(lastHandler()({ input: { strategy: "local" } })).rejects.toMatchObject({
                code: "CONFLICT",
            });
            expect(mockInitializationService.triggerInitialize).not.toHaveBeenCalled();
        });

        it("refuses probeDatabase", async () => {
            controller.probeDatabase();

            await expect(
                lastHandler()({ input: { databaseUrl: "postgresql://u:p@93.184.216.34:5432/db" } }),
            ).rejects.toMatchObject({ code: "CONFLICT" });
        });

        it("refuses dismissPostSetupHint", async () => {
            controller.setupDismissPostSetupHint();

            await expect(
                lastHandler()({ input: { hintId: "scanning" }, errors: makeErrorsParam() }),
            ).rejects.toMatchObject({ code: "CONFLICT" });
        });

        it("still allows triggerInitialize while setup is in progress", async () => {
            mockInitializationService.assertSetupMutable.mockReturnValue(Effect.void);
            controller.triggerInitialize();

            await expect(lastHandler()({ input: { strategy: "local" } })).resolves.toMatchObject({
                status: 201,
            });
        });
    });

    it("refuses a probe target the network policy forbids", async () => {
        mockInitializationService.assertDatabaseProbeAllowed.mockReturnValue(
            Effect.fail(new ORPCError("BAD_REQUEST", { message: "127.0.0.1 is a loopback address" })),
        );
        controller.probeDatabase();

        await expect(
            lastHandler()({ input: { databaseUrl: "postgresql://u:p@127.0.0.1:5432/db" } }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
});
