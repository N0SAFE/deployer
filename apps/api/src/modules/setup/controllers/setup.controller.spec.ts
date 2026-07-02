import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORPCError } from "@orpc/server";
import { SetupController } from "./setup.controller";
import { InitializationService } from "@/core/modules/setup/services/initialization.service";
import { ReachabilityService } from "@/core/modules/reachability/services/reachability.service";

function createImplementMock() {
    const chainable = {
        use: vi.fn().mockReturnThis(),
        handler: vi.fn((fn: unknown) => ({ handler: fn })),
    };

    return chainable;
}

vi.mock("@orpc/nest", () => ({
    implement: vi.fn(() => createImplementMock()),
    Implement: vi.fn(() => () => {}),
}));

vi.mock("@/core/modules/auth/orpc/middlewares", () => ({
    publicAccess: vi.fn(() => ({})),
}));

describe("SetupController", () => {
    let controller: SetupController;
    let mockInitializationService: {
        getSetupState: ReturnType<typeof vi.fn>;
        getNodeStatus: ReturnType<typeof vi.fn>;
    };
    let mockReachabilityService: {
        checkMeshUrlReachability: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        mockInitializationService = {
            getSetupState: vi.fn(),
            getNodeStatus: vi.fn(),
        };
        mockReachabilityService = {
            checkMeshUrlReachability: vi.fn(),
        };

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
            ],
        }).compile();

        controller = module.get<SetupController>(SetupController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });

    it("should expose getStatus REST fallback delegating to InitializationService.getSetupState", () => {
        const mockState = {
            state: "not_started",
            needsSetup: true,
            strategy: null,
            currentStep: "choose_strategy",
            progressPercent: 0,
            steps: [],
            completedAt: null,
        };
        mockInitializationService.getSetupState.mockReturnValue(mockState);
        expect(controller.getState()).toEqual(mockState);
    });

    // ─── remoteAuth ───────────────────────────────────────────────────────────

    describe("remoteAuth", () => {
        // Each test in this block targets a specific handler created by
        // `controller.remoteAuth().handler(fn)`. The mock chainable stores
        // the underlying fn and we invoke it directly.
        const getRemoteAuthHandler = () => {
            // Re-create the handler chain (the implement mock is shared
            // across all `.remoteAuth()` invocations so the latest call wins).
            controller.remoteAuth();
            // Grab the most recent handler fn registered with the chainable.
            const impl = createImplementMock();
            return impl.handler.mock.calls.at(-1)?.[0] as (
                args: { input: { meshUrl: string; username: string; password: string } },
            ) => Promise<{ status: number; headers: Record<string, string>; body: unknown }>;
        };

        let fetchMock: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            fetchMock = vi.fn();
            vi.stubGlobal("fetch", fetchMock);
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it("returns a session token on successful Better Auth signin (200 + JSON body)", async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        token: "session-abc-123",
                        user: { id: "u-1", email: "admin@example.com" },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                ),
            );

            const handler = getRemoteAuthHandler();
            const result = await handler({
                input: {
                    meshUrl: "https://mesh.example.com",
                    username: "admin@example.com",
                    password: "hunter2",
                },
            });

            expect(result.status).toBe(201);
            expect(result.body).toMatchObject({
                authToken: "session-abc-123",
                userId: "u-1",
                email: "admin@example.com",
                meshUrl: "https://mesh.example.com",
            });
            // Confirms we hit the right endpoint
            expect(fetchMock).toHaveBeenCalledWith(
                "https://mesh.example.com/api/auth/sign-in/email",
                expect.objectContaining({
                    method: "POST",
                    headers: expect.objectContaining({
                        "Content-Type": "application/json",
                    }),
                }),
            );
        });

        it("falls back to extracting the session cookie when no body token is returned", async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({}), {
                    status: 200,
                    headers: {
                        "content-type": "application/json",
                        "set-cookie":
                            "better-auth.session_token=cookie-xyz; Path=/; HttpOnly",
                    },
                }),
            );

            const handler = getRemoteAuthHandler();
            const result = await handler({
                input: {
                    meshUrl: "https://mesh.example.com",
                    username: "admin@example.com",
                    password: "hunter2",
                },
            });

            expect(result.body).toMatchObject({
                authToken: "better-auth.session_token=cookie-xyz",
            });
        });

        it("throws ORPCError UNAUTHORIZED on 401", async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ message: "Invalid email" }), {
                    status: 401,
                }),
            );

            const handler = getRemoteAuthHandler();

            await expect(
                handler({
                    input: {
                        meshUrl: "https://mesh.example.com",
                        username: "admin@example.com",
                        password: "wrong",
                    },
                }),
            ).rejects.toMatchObject({
                name: "ORPCError",
                code: "UNAUTHORIZED",
                message: "Invalid email",
            });
        });

        it("throws ORPCError UNAUTHORIZED on 400 with a default message", async () => {
            fetchMock.mockResolvedValueOnce(
                new Response("not-json", { status: 400 }),
            );

            const handler = getRemoteAuthHandler();

            await expect(
                handler({
                    input: {
                        meshUrl: "https://mesh.example.com",
                        username: "admin@example.com",
                        password: "wrong",
                    },
                }),
            ).rejects.toBeInstanceOf(ORPCError);
        });

        it("throws ORPCError BAD_REQUEST on a malformed mesh URL", async () => {
            const handler = getRemoteAuthHandler();

            await expect(
                handler({
                    input: {
                        meshUrl: "not-a-url",
                        username: "admin@example.com",
                        password: "hunter2",
                    },
                }),
            ).rejects.toMatchObject({
                code: "BAD_REQUEST",
            });
        });

        it("throws ORPCError INTERNAL_SERVER_ERROR when mesh returns 200 without a session token", async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({}), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
            );

            const handler = getRemoteAuthHandler();

            await expect(
                handler({
                    input: {
                        meshUrl: "https://mesh.example.com",
                        username: "admin@example.com",
                        password: "hunter2",
                    },
                }),
            ).rejects.toBeInstanceOf(ORPCError);
        });
    });
});
