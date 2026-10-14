import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceController } from './service.controller';
import { ServiceService } from '../services/service.service';
import { ServiceNetworkService } from '../services/service-network.service';

/**
 * Resolve a built procedure's handler.
 *
 * oRPC v2 keeps it on the `~orpc` descriptor; v1 exposed it as a top-level
 * property. Reading both keeps this assertion about the CONTRACT ("the
 * controller exposes a callable handler") rather than about the internal shape
 * of whichever oRPC version is installed.
 */
function procedureHandler(procedure: unknown): (...args: unknown[]) => unknown {
    const p = procedure as { handler?: unknown; "~orpc"?: { handler?: unknown } };
    const handler = p?.handler ?? p?.["~orpc"]?.handler;
    if (typeof handler !== "function") {
        throw new TypeError("procedure does not expose a handler");
    }
    return handler as (...args: unknown[]) => unknown;
}


function createImplementMock() {
    type HandlerFn = (opts: { input: unknown; context: unknown }) => unknown;

    const chainable = {
        use: vi.fn().mockReturnThis(),
        handler: vi.fn((fn: HandlerFn) => ({ handler: fn })),
    };

    return chainable;
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

vi.mock('@/core/modules/auth/orpc/middlewares', () => ({
    requireAuth: vi.fn(() => ({})),
}));

describe('ServiceController', () => {
    let controller: ServiceController;

    beforeEach(async () => {
        const mockServiceService = {
            listServices: vi.fn(),
            getServiceById: vi.fn(),
            createService: vi.fn(),
            updateService: vi.fn(),
            deleteService: vi.fn(),
            toggleActive: vi.fn(),
            getDependencies: vi.fn(),
            addDependency: vi.fn(),
            removeDependency: vi.fn(),
            streamQueryEvents: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ServiceController],
            providers: [
                {
                    provide: ServiceService,
                    useFactory: () => mockServiceService,
                },
                {
                    provide: ServiceNetworkService,
                    useFactory: () => ({
                        getNetwork: vi.fn(),
                        saveNetwork: vi.fn(),
                    }),
                },
            ],
        }).compile();

        controller = module.get<ServiceController>(ServiceController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('ORPC implementation methods', () => {
        const methods: Array<keyof ServiceController> = [
            'list',
            'findById',
            'create',
            'update',
            'delete',
            'toggleActive',
            'getDependencies',
            'addDependency',
            'removeDependency',
            'streamQuery',
        ];

        for (const method of methods) {
            it(`${method} should return an implementation with a handler`, () => {
                const impl = (controller[method] as () => any)();
                expect(impl).toBeDefined();
                expect(typeof procedureHandler(impl)).toBe('function');
            });
        }
    });
});
