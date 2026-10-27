import { Test, type TestingModule } from "@nestjs/testing";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { HealthController } from "./health.controller";
import { HealthService } from "../services/health.service";
import { AppLifecyclePhase } from "@deployer/nest-lifecycle";

// Mock auth user for requireAuth middleware
const mockAuthUser = {
    id: "auth-user-1",
    name: "Auth User",
    email: "auth@example.com",
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

// Create chainable mock for implement().use().handler() pattern
const createImplementMock = () => ({
    use: vi.fn(() => ({
        handler: vi.fn((handlerFn: (...args: unknown[]) => unknown) => {
            return {
                handler: handlerFn,
                context: { auth: { user: mockAuthUser } },
            };
        }),
    })),
    handler: vi.fn((handlerFn: (...args: unknown[]) => unknown) => {
        return {
            handler: handlerFn,
        };
    }),
});

// Mock @orpc/nest module
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

// Mock requireAuth middleware to do nothing (pass through)
vi.mock("@/core/modules/auth/orpc/middlewares", () => ({
    requireAuth: vi.fn(() => ({})),
}));

describe("HealthController", () => {
    let controller: HealthController;
    let service: HealthService;

    beforeEach(async () => {
        const mockHealthService = {
            getHealth: vi.fn(),
            getDetailedHealth: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [HealthController],
            providers: [
                {
                    provide: HealthService,
                    useFactory: () => mockHealthService,
                },
            ],
        }).compile();

        controller = module.get<HealthController>(HealthController);
        service = module.get<HealthService>(HealthService);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });

    describe("ORPC implementation methods", () => {
        // @orpc/nest's ImplementedProcedure TYPE omits the runtime-assigned
        // `handler` member; read it structurally instead of asserting against
        // an incomplete library declaration.
        const handlerOf = (impl: object): unknown => (impl as { handler?: unknown }).handler;

        it("should have check method that returns implementation handler", () => {
            const implementation = controller.check();
            expect(implementation).toBeDefined();
            expect(typeof handlerOf(implementation)).toBe("function");
        });

        it("should have detailed method that returns implementation handler", () => {
            const implementation = controller.detailed();
            expect(implementation).toBeDefined();
            expect(typeof handlerOf(implementation)).toBe("function");
        });
    });

    describe("Service integration", () => {
        it("should have service injected properly", () => {
            expect(service).toBeDefined();
            expect(service.getHealth).toBeDefined();
            expect(service.getDetailedHealth).toBeDefined();
        });

        it("should be able to call getHealth service method directly", () => {
            const mockHealth = {
                status: "ok" as const,
                timestamp: new Date(),
                service: "nestjs-api",
                lifecycle: {
                    phase: AppLifecyclePhase.INITIALIZED,
                    step: null,
                    message: expect.any(String),
                },
            };
            vi.mocked(service.getHealth).mockReturnValue(mockHealth);

            const result = service.getHealth();
            expect(result).toEqual(mockHealth);
            expect(service.getHealth).toHaveBeenCalledOnce();
        });

        it("should be able to call getDetailedHealth service method directly", async () => {
            const mockDetailedHealth = {
                status: "ok" as const,
                timestamp: new Date(),
                service: "nestjs-api",
                uptime: 123,
                // The contract's report shape: Terminus' own `info`/`error`/`details`
                // passed through, plus the flattened list a UI renders.
                info: { database: { status: "up" } },
                error: {},
                details: { database: { status: "up" } },
                // Both literals need `as const`: the service narrows `name` to the readiness
                // indicator union and `status` to the contract's up/down enum, so a widened
                // `string` would not be assignable back into its own return type.
                indicators: [
                    { name: "database" as const, status: "up" as const, latencyMs: 0, detail: {} },
                ],
                supervisors: [],
            };
            vi.mocked(service.getDetailedHealth).mockResolvedValue(mockDetailedHealth);

            const result = await service.getDetailedHealth();
            expect(result).toEqual(mockDetailedHealth);
            expect(service.getDetailedHealth).toHaveBeenCalledOnce();
        });
    });
});
