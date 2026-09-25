import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDomainController } from "./project-domain.controller";
import { DomainProjectService } from "../services/domain-project.service";

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
                expect(typeof procedureHandler(implementation)).toBe("function");
            });
        }
    });
});