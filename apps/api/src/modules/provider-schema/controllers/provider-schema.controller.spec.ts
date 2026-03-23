import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderSchemaController } from "./provider-schema.controller";
import { ProviderSchemaService } from "../services/provider-schema.service";

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
                expect(typeof implementation.handler).toBe("function");
            });
        }
    });
});
