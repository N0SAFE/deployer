import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { EMPTY } from 'rxjs';
import { ServiceService } from './service.service';
import { PreviewTopologyService } from './preview-topology.service';
import { RuntimeConfigurationAccessorService } from '@/core/modules/configuration/services/runtime-configuration-accessor.service';

describe('ServiceService', () => {
    let service: ServiceService;
    let mockRepository: any;
    let mockEventService: any;
    let mockCoreEventSyncService: any;
    let mockProjectAccessService: any;

    const now = '2024-01-01T00:00:00.000Z';

    const mockProject = {
        id: 'proj-1',
        ownerId: 'requester-1',
    };

    const mockService = {
        id: 'service-1',
        projectId: 'proj-1',
        name: 'My Service',
        type: 'web',
        description: null,
        providerId: null,
        builderId: null,
        providerConfig: null,
        builderConfig: null,
        port: 3000,
        isActive: true,
        environmentVariables: null,
        resourceLimits: null,
        healthCheckPath: '/health',
        healthCheckInterval: 30,
        healthCheckTimeout: 10,
        healthCheckRetries: 3,
        deploymentRetention: null,
        traefikConfig: null,
        customDomains: null,
        metadata: null,
        createdAt: now,
        updatedAt: now,
    };

    const mockDependency = {
        id: 'dep-1',
        serviceId: 'service-1',
        dependsOnServiceId: 'service-2',
        isRequired: true,
        createdAt: now,
    };

    beforeEach(async () => {
        mockRepository = {
            list: vi.fn(),
            findById: vi.fn(),
            findAncestors: vi.fn().mockResolvedValue([]),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            toggleActive: vi.fn(),
            getDependencies: vi.fn().mockResolvedValue([]),
            addDependency: vi.fn(),
            removeDependency: vi.fn(),
            dependencyExists: vi.fn(),
            listChildren: vi.fn().mockResolvedValue([]),
        };

        mockEventService = {
            emit: vi.fn(),
        };

        mockCoreEventSyncService = {
            registerNamespaceAdapter: vi.fn(),
            selectMany: vi.fn(),
        };

        mockProjectAccessService = {
            assertProjectAccess: vi.fn().mockResolvedValue(mockProject),
        };

        const mockPreviewTopologyService = {
            resolve: vi.fn(),
        } as unknown as PreviewTopologyService;

        const mockRuntimeConfigurationAccessor = {
            resolver: {
                resolveStrict: vi.fn(),
            },
            resolveStrict: vi.fn(() => ({
                scope: 'project',
                context: {},
                project: { metadata: null },
                service: { metadata: null },
                user: { metadata: null },
                effective: {
                    deployment: { strategy: 'rolling', autoDeployEnabled: true, previewEnabled: true, requireApprovalForProduction: false },
                    routing: { forceHttps: false, domains: [] },
                    execution: { providerType: 'github', runnerType: 'docker' },
                    replicas: { min: 0, desired: 1, max: 3 },
                    resources: { cpuMillicores: 100, memoryMb: 128 },
                    envPolicy: { required: [], allowList: [], denyList: [] },
                    traefik: { enabled: true, entryPoints: ['web'], middlewares: [], stripPrefix: null, domains: [], tls: { enabled: false, resolver: null } },
                    lifecycle: { current: 'active', allowedNextStates: [] },
                    environmentDomains: { build: {}, runtime: {}, deployment: {}, network: {}, traefik: {}, provider: {}, runner: {}, security: {} },
                    environment: {},
                    featureFlags: {},
                    constraints: {
                        canDeployToRequestedEnvironment: true,
                        providerAllowed: true,
                        runnerAllowed: true,
                        replicasWithinLimits: true,
                        resourcesWithinProjectLimits: true,
                        envPolicyValid: true,
                        lifecycleTransitionAllowed: true,
                        reason: null,
                        reasons: [],
                    },
                },
                dispatchAudit: { evaluatedRules: 0, appliedRuleIds: [] },
            })),
            resolve: vi.fn(),
            resolveForDeployment: vi.fn(),
            projectConfigFromSettings: vi.fn(),
            serviceConfigFromRecord: vi.fn(),
        } as unknown as RuntimeConfigurationAccessorService;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                {
                    provide: ServiceService,
                    useFactory: () => new ServiceService(
                        mockRepository,
                        mockEventService,
                        mockCoreEventSyncService,
                        mockProjectAccessService,
                        mockPreviewTopologyService,
                        mockRuntimeConfigurationAccessor,
                    ),
                },
            ],
        }).compile();

        service = module.get<ServiceService>(ServiceService);
        vi.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    // ========================================
    // listServices
    // ========================================

    describe('listServices', () => {
        it('should delegate to repository list', async () => {
            const input = { limit: 10, offset: 0 };
            const mockResponse = { data: [mockService], meta: { total: 1, limit: 10, offset: 0, hasMore: false } };
            mockRepository.list.mockResolvedValue(mockResponse);

            const result = await service.listServices(input);

            expect(result).toEqual(mockResponse);
            expect(mockRepository.list).toHaveBeenCalledWith(input);
        });
    });

    // ========================================
    // getServiceById
    // ========================================

    describe('getServiceById', () => {
        it('should return service when found', async () => {
            mockRepository.findById.mockResolvedValue(mockService);

            const result = await service.getServiceById('service-1');

            expect(result).toMatchObject(mockService);
            expect(result.effectiveConfig).toBeDefined();
            expect(mockRepository.findById).toHaveBeenCalledWith('service-1');
            expect(mockRepository.findAncestors).toHaveBeenCalledWith('service-1');
        });

        it('should throw NotFoundException when service not found', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.getServiceById('missing')).rejects.toThrow(NotFoundException);
        });
    });

    // ========================================
    // createService
    // ========================================

    describe('createService', () => {
        it('should create a service and return it', async () => {
            mockRepository.create.mockResolvedValue(mockService);

            const result = await service.createService({ name: 'My Service', projectId: 'proj-1', type: 'web' } as any, 'requester-1');

            expect(result).toEqual(mockService);
            expect(mockRepository.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Service' }));
            expect(mockEventService.emit).toHaveBeenCalledWith(
                'serviceCreated',
                { projectId: mockService.projectId },
                expect.objectContaining({
                    serviceId: mockService.id,
                    projectId: mockService.projectId,
                    name: mockService.name,
                    type: mockService.type,
                    isActive: mockService.isActive,
                }),
            );
        });
    });

    // ========================================
    // updateService
    // ========================================

    describe('updateService', () => {
        it('should update and return the service', async () => {
            const updated = { ...mockService, name: 'Renamed' };
            mockRepository.findById.mockResolvedValue(mockService);
            mockRepository.update.mockResolvedValue(updated);

            const result = await service.updateService('service-1', { name: 'Renamed' }, 'requester-1');

            expect(result).toEqual(updated);
            expect(mockRepository.update).toHaveBeenCalledWith('service-1', expect.objectContaining({ name: 'Renamed' }));
            expect(mockEventService.emit).toHaveBeenCalledWith(
                'serviceUpdated',
                { serviceId: 'service-1' },
                expect.objectContaining({
                    serviceId: 'service-1',
                    projectId: updated.projectId,
                    changedFields: expect.arrayContaining(['name']),
                }),
            );
        });

        it('should throw NotFoundException when service not found before update', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.updateService('missing', { name: 'X' } as any, 'requester-1')).rejects.toThrow(NotFoundException);
        });

        it('should throw NotFoundException when update returns null', async () => {
            mockRepository.findById.mockResolvedValue(mockService);
            mockRepository.update.mockResolvedValue(null);

            await expect(service.updateService('service-1', { name: 'X' } as any, 'requester-1')).rejects.toThrow(NotFoundException);
        });
    });

    // ========================================
    // deleteService
    // ========================================

    describe('deleteService', () => {
        it('should delete the service', async () => {
            mockRepository.findById.mockResolvedValue(mockService);
            mockRepository.delete.mockResolvedValue(undefined);

            await expect(service.deleteService('service-1', 'requester-1')).resolves.toBeUndefined();
            expect(mockRepository.delete).toHaveBeenCalledWith('service-1');
        });

        it('should throw NotFoundException when service not found', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.deleteService('missing', 'requester-1')).rejects.toThrow(NotFoundException);
        });
    });

    // ========================================
    // toggleActive
    // ========================================

    describe('toggleActive', () => {
        it('should toggle active state', async () => {
            const toggled = { ...mockService, isActive: false };
            mockRepository.findById.mockResolvedValue(mockService);
            mockRepository.toggleActive.mockResolvedValue(toggled);

            const result = await service.toggleActive('service-1', false, 'requester-1');

            expect(result).toEqual(toggled);
            expect(mockRepository.toggleActive).toHaveBeenCalledWith('service-1', false);
        });

        it('should throw NotFoundException when service not found', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.toggleActive('missing', true, 'requester-1')).rejects.toThrow(NotFoundException);
        });

        it('should throw NotFoundException when toggle returns null', async () => {
            mockRepository.findById.mockResolvedValue(mockService);
            mockRepository.toggleActive.mockResolvedValue(null);

            await expect(service.toggleActive('service-1', false, 'requester-1')).rejects.toThrow(NotFoundException);
        });
    });

    // ========================================
    // getDependencies
    // ========================================

    describe('getDependencies', () => {
        it('should return dependencies for a valid service', async () => {
            mockRepository.findById.mockResolvedValue(mockService);
            mockRepository.getDependencies.mockResolvedValue([mockDependency]);

            const result = await service.getDependencies('service-1');

            expect(result).toMatchObject({ dependencies: [mockDependency] });
            expect(mockRepository.getDependencies).toHaveBeenCalledWith('service-1');
        });

        it('should throw NotFoundException when service not found', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.getDependencies('missing')).rejects.toThrow(NotFoundException);
        });
    });

    // ========================================
    // addDependency
    // ========================================

    describe('addDependency', () => {
        it('should add a dependency between two services', async () => {
            const service2 = { ...mockService, id: 'service-2' };
            mockRepository.findById.mockImplementation((id: string) => {
                if (id === 'service-1') return Promise.resolve(mockService);
                if (id === 'service-2') return Promise.resolve(service2);
                return Promise.resolve(null);
            });
            mockRepository.dependencyExists.mockResolvedValue(false);
            mockRepository.addDependency.mockResolvedValue(mockDependency);

            const result = await service.addDependency('service-1', 'service-2', true, 'requester-1');

            expect(result).toEqual(mockDependency);
            expect(mockRepository.addDependency).toHaveBeenCalledWith('service-1', 'service-2', true);
            expect(mockEventService.emit).toHaveBeenCalledWith(
                'serviceDependencyAdded',
                { serviceId: 'service-1' },
                expect.objectContaining({
                    serviceId: 'service-1',
                    dependsOnServiceId: 'service-2',
                    isRequired: true,
                }),
            );
        });

        it('should throw BadRequestException when service depends on itself', async () => {
            await expect(service.addDependency('service-1', 'service-1', true, 'requester-1')).rejects.toThrow(BadRequestException);
        });

        it('should throw NotFoundException when first service not found', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.addDependency('missing', 'service-2', true, 'requester-1')).rejects.toThrow(NotFoundException);
        });

        it('should throw ConflictException when dependency already exists', async () => {
            const service2 = { ...mockService, id: 'service-2' };
            mockRepository.findById.mockImplementation((id: string) => {
                if (id === 'service-1') return Promise.resolve(mockService);
                if (id === 'service-2') return Promise.resolve(service2);
                return Promise.resolve(null);
            });
            mockRepository.dependencyExists.mockResolvedValue(true);

            await expect(service.addDependency('service-1', 'service-2', false, 'requester-1')).rejects.toThrow(ConflictException);
        });

        it('should reject dependencies across different projects', async () => {
            const service2 = { ...mockService, id: 'service-2', projectId: 'proj-2' };
            mockRepository.findById.mockImplementation((id: string) => {
                if (id === 'service-1') return Promise.resolve(mockService);
                if (id === 'service-2') return Promise.resolve(service2);
                return Promise.resolve(null);
            });
            mockRepository.dependencyExists.mockResolvedValue(false);

            await expect(service.addDependency('service-1', 'service-2', true, 'requester-1')).rejects.toThrow(BadRequestException);
            expect(mockRepository.addDependency).not.toHaveBeenCalled();
        });

        it('should reject dependencies that introduce a cycle', async () => {
            const service2 = { ...mockService, id: 'service-2' };
            const service3 = { ...mockService, id: 'service-3' };

            mockRepository.findById.mockImplementation((id: string) => {
                if (id === 'service-1') return Promise.resolve(mockService);
                if (id === 'service-2') return Promise.resolve(service2);
                if (id === 'service-3') return Promise.resolve(service3);
                return Promise.resolve(null);
            });
            mockRepository.dependencyExists.mockResolvedValue(false);
            mockRepository.getDependencies.mockImplementation((id: string) => {
                if (id === 'service-2') {
                    return Promise.resolve([
                        {
                            id: 'dep-2-3',
                            serviceId: 'service-2',
                            dependsOnServiceId: 'service-3',
                            isRequired: true,
                            createdAt: now,
                        },
                    ]);
                }

                if (id === 'service-3') {
                    return Promise.resolve([
                        {
                            id: 'dep-3-1',
                            serviceId: 'service-3',
                            dependsOnServiceId: 'service-1',
                            isRequired: true,
                            createdAt: now,
                        },
                    ]);
                }

                return Promise.resolve([]);
            });

            await expect(service.addDependency('service-1', 'service-2', true, 'requester-1')).rejects.toThrow(BadRequestException);
            expect(mockRepository.addDependency).not.toHaveBeenCalled();
        });
    });

    // ========================================
    // removeDependency
    // ========================================

    describe('removeDependency', () => {
        it('should remove a dependency', async () => {
            mockRepository.findById.mockResolvedValue(mockService);
            mockRepository.removeDependency.mockResolvedValue(undefined);

            await expect(service.removeDependency('service-1', 'dep-1', 'requester-1')).resolves.toBeUndefined();
            expect(mockRepository.removeDependency).toHaveBeenCalledWith('dep-1', 'service-1');
            expect(mockEventService.emit).toHaveBeenCalledWith(
                'serviceDependencyRemoved',
                { serviceId: 'service-1' },
                expect.objectContaining({
                    serviceId: 'service-1',
                    dependencyId: 'dep-1',
                }),
            );
        });

        it('should throw NotFoundException when service not found', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.removeDependency('missing', 'dep-1', 'requester-1')).rejects.toThrow(NotFoundException);
        });
    });

    describe('streamQueryEvents', () => {
        it('should apply fluent filters and fuzzy search when provided', () => {
            const queryBuilder = {
                whereEventName: vi.fn().mockReturnThis(),
                wherePayload: vi.fn().mockReturnThis(),
                whereFuzzy: vi.fn().mockReturnThis(),
                execute: vi.fn().mockReturnValue(EMPTY),
            };
            mockCoreEventSyncService.selectMany.mockReturnValue(queryBuilder);

            const iterable = service.streamQueryEvents({
                serviceId: 'service-1',
                projectId: 'proj-1',
                serviceType: 'web',
                isActive: true,
                eventTypes: ['serviceUpdated'],
                fuzzy: 'renamed',
                replay: false,
                replayLimit: 20,
            } as any);

            expect(iterable).toBeDefined();
            expect(mockCoreEventSyncService.selectMany).toHaveBeenCalledTimes(1);
            expect(queryBuilder.whereEventName).toHaveBeenCalledTimes(1);
            expect(queryBuilder.wherePayload).toHaveBeenCalledTimes(4);
            expect(queryBuilder.whereFuzzy).toHaveBeenCalledWith('renamed');
            expect(queryBuilder.execute).toHaveBeenCalledTimes(1);
        });
    });
});
