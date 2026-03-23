import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrganizationController } from '@/modules/organization/controllers/organization.controller';
import { OrganizationService } from '@/modules/organization/services/organization.service';

// Chainable mock for implement().use().handler()
function createImplementMock() {
    type HandlerFn = (opts: { input: unknown; context: unknown }) => unknown;
    return {
        use: vi.fn().mockReturnThis(),
        handler: vi.fn((fn: HandlerFn) => ({ handler: fn })),
    };
}

vi.mock('@orpc/nest', () => ({
    implement: vi.fn(() => createImplementMock()),
    Implement: vi.fn(() => () => {}),
}));

vi.mock('@/core/modules/auth/orpc/middlewares', () => ({
    requireAuth: vi.fn(() => ({})),
}));

describe('OrganizationController', () => {
    let controller: OrganizationController;
    let service: OrganizationService;

    beforeEach(async () => {
        const mockOrganizationService = {
            listAll: vi.fn(),
            listMembers: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [OrganizationController],
            providers: [
                {
                    provide: OrganizationService,
                    useFactory: () => mockOrganizationService,
                },
            ],
        }).compile();

        controller = module.get<OrganizationController>(OrganizationController);
        service = module.get<OrganizationService>(OrganizationService);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('ORPC implementation methods', () => {
        it('should have listAll method that returns implementation with handler', () => {
            const impl = controller.listAll() as unknown as { handler: unknown };
            expect(impl).toBeDefined();
            expect(typeof impl.handler).toBe('function');
        });

        it('should have listMembers method that returns implementation with handler', () => {
            const impl = controller.listMembers() as unknown as { handler: unknown };
            expect(impl).toBeDefined();
            expect(typeof impl.handler).toBe('function');
        });
    });

    describe('Service integration', () => {
        it('should have service injected', () => {
            expect(service).toBeDefined();
            expect(service.listAll).toBeDefined();
            expect(service.listMembers).toBeDefined();
        });
    });
});
