import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationDomainController } from "./organization-domain.controller";
import { DomainOrganizationService } from "../services/domain-organization.service";

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

describe("OrganizationDomainController", () => {
    let controller: OrganizationDomainController;

    beforeEach(async () => {
        const mockDomainOrganizationService = {
            listOrganizationDomains: vi.fn(),
            addOrganizationDomain: vi.fn(),
            getOrganizationDomain: vi.fn(),
            verifyOrganizationDomain: vi.fn(),
            deleteOrganizationDomain: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [OrganizationDomainController],
            providers: [
                {
                    provide: DomainOrganizationService,
                    useFactory: () => mockDomainOrganizationService,
                },
            ],
        }).compile();

        controller = module.get<OrganizationDomainController>(OrganizationDomainController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });

    describe("ORPC implementation methods", () => {
        const methods: Array<keyof OrganizationDomainController> = [
            "listOrganizationDomains",
            "addOrganizationDomain",
            "getOrganizationDomain",
            "verifyOrganizationDomain",
            "deleteOrganizationDomain",
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