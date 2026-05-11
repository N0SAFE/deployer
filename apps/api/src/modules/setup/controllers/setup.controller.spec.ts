import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupController } from "./setup.controller";
import { InitializationService } from "../services/setup.service";

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

    beforeEach(async () => {
        const mockInitializationService = {
            getSetupState: vi.fn(),
            getStateMachine: vi.fn(),
            initialize: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [SetupController],
            providers: [
                {
                    provide: InitializationService,
                    useFactory: () => mockInitializationService,
                },
            ],
        }).compile();

        controller = module.get<SetupController>(SetupController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });

    it("should expose getStatus ORPC implementation", () => {
        const implementation = controller.getStatus() as unknown as { handler: unknown };
        expect(implementation).toBeDefined();
        expect(typeof implementation.handler).toBe("function");
    });

    it("should expose getStateMachine ORPC implementation", () => {
        const implementation = controller.getStateMachine() as unknown as { handler: unknown };
        expect(implementation).toBeDefined();
        expect(typeof implementation.handler).toBe("function");
    });

    it("should expose initialize ORPC implementation", () => {
        const implementation = controller.initialize() as unknown as { handler: unknown };
        expect(implementation).toBeDefined();
        expect(typeof implementation.handler).toBe("function");
    });
});