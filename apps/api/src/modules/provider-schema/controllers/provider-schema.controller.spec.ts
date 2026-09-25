import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderSchemaController } from "./provider-schema.controller";
import { ProviderSchemaService } from "../services/provider-schema.service";

/**
 * Resolve a built procedure's handler.
 *
 * oRPC v2 keeps it on the `~orpc` descriptor; v1 exposed it as a top-level
 * property. Reading both keeps this assertion about the CONTRACT ("the
 * controller exposes a callable handler") rather than about the internal layout
 * of whichever oRPC version is installed.
 */
function procedureHandler(procedure: unknown): (...args: never[]) => unknown {
    const p = procedure as { handler?: unknown; "~orpc"?: { handler?: unknown } };
    const handler = p?.handler ?? p?.["~orpc"]?.handler;
    if (typeof handler !== "function") {
        throw new TypeError("procedure does not expose a handler");
    }
    return handler as (...args: never[]) => unknown;
}


function createImplementMock() {
    type HandlerFn = (opts: { input: unknown; context: unknown }) => unknown;

    return {
        use: vi.fn().mockReturnThis(),
        handler: vi.fn((fn: HandlerFn) => ({ handler: fn })),
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

vi.mock("@/core/modules/auth/orpc/middlewares", () => ({
    requireAuth: vi.fn(() => ({})),
}));

describe("ProviderSchemaController", () => {
    let controller: ProviderSchemaController;

    beforeEach(async () => {
        const mockProviderSchemaService = {
            getAllProviders: vi.fn(),
            getProviderSchema: vi.fn(),
            getCompatibleBuilders: vi.fn(),
            getAllBuilders: vi.fn(),
            getBuilderSchema: vi.fn(),
            getCompatibleProviders: vi.fn(),
            validateProviderConfig: vi.fn(),
            validateBuilderConfig: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ProviderSchemaController],
            providers: [
                {
                    provide: ProviderSchemaService,
                    useFactory: () => mockProviderSchemaService,
                },
            ],
        }).compile();

        controller = module.get<ProviderSchemaController>(ProviderSchemaController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });

    describe("ORPC implementation methods", () => {
        const methods: Array<keyof ProviderSchemaController> = [
            "getAllProviders",
            "getProviderSchema",
            "getCompatibleBuilders",
            "getAllBuilders",
            "getBuilderSchema",
            "getCompatibleProviders",
            "validateProviderConfig",
            "validateBuilderConfig",
        ];

        for (const method of methods) {
            it(`${method} should return an implementation with a handler`, () => {
                const implementation = (controller[method] as () => any)();
                expect(implementation).toBeDefined();
                expect(typeof procedureHandler(implementation)).toBe("function");
            });
        }
    });
});
