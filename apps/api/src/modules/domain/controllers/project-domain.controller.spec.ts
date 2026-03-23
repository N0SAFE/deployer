import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDomainController } from "./project-domain.controller";
import { DomainProjectService } from "../services/domain-project.service";

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

describe("ProjectDomainController", () => {
    let controller: ProjectDomainController;

    beforeEach(async () => {
        const mockDomainProjectService = {
            listProjectDomains: vi.fn(),
            getAvailableDomains: vi.fn(),
            getAvailableDomainsForService: vi.fn(),
            addProjectDomain: vi.fn(),
            updateProjectDomain: vi.fn(),
            removeProjectDomain: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ProjectDomainController],
            providers: [
                {
                    provide: DomainProjectService,
                    useFactory: () => mockDomainProjectService,
                },
            ],
        }).compile();

        controller = module.get<ProjectDomainController>(ProjectDomainController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });

    describe("ORPC implementation methods", () => {
        const methods: Array<keyof ProjectDomainController> = [
            "listProjectDomains",
            "getAvailableDomains",
            "getAvailableDomainsForService",
            "addProjectDomain",
            "updateProjectDomain",
            "removeProjectDomain",
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