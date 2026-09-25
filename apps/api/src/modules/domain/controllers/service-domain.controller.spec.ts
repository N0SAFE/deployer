import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceDomainController } from "./service-domain.controller";
import { DomainServiceService } from "../services/domain-service.service";

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
                expect(typeof procedureHandler(implementation)).toBe("function");
            });
        }
    });
});