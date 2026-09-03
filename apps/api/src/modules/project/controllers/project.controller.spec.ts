import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectController } from '@/modules/project/controllers/project.controller';
import { ProjectService } from '@/modules/project/services/project.service';
import { ProjectNetworkService } from '@/modules/project/services/project-network.service';

// Create a chainable mock for implement().use().handler()
function createImplementMock() {
    type HandlerFn = (opts: { input: unknown; context: unknown }) => unknown;
    let handlerFn: HandlerFn | null = null;

    const chainable = {
        use: vi.fn().mockReturnThis(),
        handler: vi.fn((fn: HandlerFn) => {
            handlerFn = fn;
            return {
                handler: fn,
                __handlerFn: handlerFn,
            };
        }),
    };

    return chainable;
}

// Mock @orpc/nest
vi.mock('@orpc/nest', () => ({
    implement: vi.fn(() => createImplementMock()),
    Implement: vi.fn(() => () => {}),
}));

// Mock requireAuth middleware
vi.mock('@/core/modules/auth/orpc/middlewares', () => ({
    requireAuth: vi.fn(() => ({})),
}));

describe('ProjectController', () => {
    let controller: ProjectController;
    let service: ProjectService;

    beforeEach(async () => {
        const mockProjectService = {
            listProjects: vi.fn(),
            getProjectById: vi.fn(),
            createProject: vi.fn(),
            updateProject: vi.fn(),
            deleteProject: vi.fn(),
            getCollaborators: vi.fn(),
            inviteCollaborator: vi.fn(),
            updateCollaborator: vi.fn(),
            removeCollaborator: vi.fn(),
            listEnvironments: vi.fn(),
            getEnvironment: vi.fn(),
            createEnvironment: vi.fn(),
            updateEnvironment: vi.fn(),
            deleteEnvironment: vi.fn(),
            cloneEnvironment: vi.fn(),
            listVariableTemplates: vi.fn(),
            getVariableTemplate: vi.fn(),
            createVariableTemplate: vi.fn(),
            updateVariableTemplate: vi.fn(),
            deleteVariableTemplate: vi.fn(),
            getGeneralConfig: vi.fn(),
            updateGeneralConfig: vi.fn(),
            getEnvironmentConfig: vi.fn(),
            updateEnvironmentConfig: vi.fn(),
            getDeploymentConfig: vi.fn(),
            updateDeploymentConfig: vi.fn(),
            getSecurityConfig: vi.fn(),
            updateSecurityConfig: vi.fn(),
            getResourceConfig: vi.fn(),
            updateResourceConfig: vi.fn(),
            getNotificationConfig: vi.fn(),
            updateNotificationConfig: vi.fn(),
            resolveVariables: vi.fn(),
            getAvailableVariables: vi.fn(),
            getEnvironmentStatus: vi.fn(),
            getAllEnvironmentStatuses: vi.fn(),
            refreshEnvironmentStatus: vi.fn(),
            streamQueryEvents: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [ProjectController],
            providers: [
                {
                    provide: ProjectService,
                    useFactory: () => mockProjectService,
                },
                {
                    provide: ProjectNetworkService,
                    useFactory: () => ({
                        getNetwork: vi.fn(),
                        saveNetwork: vi.fn(),
                    }),
                },
            ],
        }).compile();

        controller = module.get<ProjectController>(ProjectController);
        service = module.get<ProjectService>(ProjectService);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('ORPC implementation methods', () => {
        const methodsWithHandler: Array<keyof ProjectController> = [
            'list',
            'findById',
            'create',
            'update',
            'delete',
            'getCollaborators',
            'inviteCollaborator',
            'updateCollaborator',
            'removeCollaborator',
            'listEnvironments',
            'getEnvironment',
            'createEnvironment',
            'updateEnvironment',
            'deleteEnvironment',
            'cloneEnvironment',
            'listVariableTemplates',
            'getVariableTemplate',
            'createVariableTemplate',
            'updateVariableTemplate',
            'deleteVariableTemplate',
            'getGeneralConfig',
            'updateGeneralConfig',
            'getEnvironmentConfig',
            'updateEnvironmentConfig',
            'getDeploymentConfig',
            'updateDeploymentConfig',
            'getSecurityConfig',
            'updateSecurityConfig',
            'getResourceConfig',
            'updateResourceConfig',
            'getNotificationConfig',
            'updateNotificationConfig',
            'resolveVariables',
            'getAvailableVariables',
            'getEnvironmentStatus',
            'getAllEnvironmentStatuses',
            'refreshEnvironmentStatus',
            'streamQuery',
        ];

        for (const method of methodsWithHandler) {
            it(`should have ${method} method that returns an implementation with handler`, () => {
                 
                const implementation = (controller[method] as () => any)();
                expect(implementation).toBeDefined();
                expect(typeof implementation.handler).toBe('function');
            });
        }
    });

    describe('Service integration', () => {
        it('should have service injected properly', () => {
            expect(service).toBeDefined();
            expect(service.listProjects).toBeDefined();
            expect(service.getProjectById).toBeDefined();
            expect(service.createProject).toBeDefined();
            expect(service.updateProject).toBeDefined();
            expect(service.deleteProject).toBeDefined();
        });
    });
});
