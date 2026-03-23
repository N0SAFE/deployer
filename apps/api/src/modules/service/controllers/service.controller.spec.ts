import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceController } from './service.controller';
import { ServiceService } from '../services/service.service';

function createImplementMock() {
    type HandlerFn = (opts: { input: unknown; context: unknown }) => unknown;

    const chainable = {
        use: vi.fn().mockReturnThis(),
        handler: vi.fn((fn: HandlerFn) => ({ handler: fn })),
    };

    return chainable;
}

vi.mock('@orpc/nest', () => ({
    implement: vi.fn(() => createImplementMock()),
    Implement: vi.fn(() => () => {}),
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
                expect(typeof impl.handler).toBe('function');
            });
        }
    });
});
