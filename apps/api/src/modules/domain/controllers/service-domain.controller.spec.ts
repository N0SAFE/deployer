import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceDomainController } from "./service-domain.controller";
import { DomainServiceService } from "../services/domain-service.service";

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

describe("ServiceDomainController", () => {
    let controller: ServiceDomainController;

    beforeEach(async () => {
        const mockDomainServiceService = {
            checkSubdomainAvailability: vi.fn(),
            listServiceDomains: vi.fn(),
            addServiceDomain: vi.fn(),
            updateServiceDomain: vi.fn(),
            setPrimaryServiceDomain: vi.fn(),
            removeServiceDomain: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ServiceDomainController],
            providers: [
                {
                    provide: DomainServiceService,
                    useFactory: () => mockDomainServiceService,
                },
            ],
        }).compile();

        controller = module.get<ServiceDomainController>(ServiceDomainController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });

    describe("ORPC implementation methods", () => {
        const methods: Array<keyof ServiceDomainController> = [
            "checkSubdomainAvailability",
            "listServiceDomains",
            "addServiceDomain",
            "updateServiceDomain",
            "setPrimaryServiceDomain",
            "removeServiceDomain",
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