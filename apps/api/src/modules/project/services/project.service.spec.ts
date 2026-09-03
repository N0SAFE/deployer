import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { EMPTY } from 'rxjs';
import { ProjectService } from './project.service';

describe('ProjectService', () => {
    let service: ProjectService;
     
    let mockRepository: any;
    let mockEventService: any;
    let mockCoreEventSyncService: any;
    let mockRuntimeConfigurationAccessor: any;

    const now = '2024-01-01T00:00:00.000Z';

    const mockProject = {
        id: 'proj-1',
        name: 'Test Project',
        description: 'A test project',
        baseDomain: null,
        ownerId: 'user-1',
        settings: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
    };

    const mockCollaborator = {
        id: 'collab-1',
        projectId: 'proj-1',
        userId: 'user-2',
        role: 'developer',
        permissions: null,
        invitedBy: 'user-1',
        invitedAt: now,
        acceptedAt: null,
        createdAt: now,
        updatedAt: now,
    };

    const mockEnvironment = {
        id: 'env-1',
        projectId: 'proj-1',
        name: 'production',
        slug: 'production',
        type: 'production',
        status: 'pending',
        description: null,
        isActive: true,
        domainConfig: null,
        deploymentConfig: null,
        metadata: null,
        createdBy: 'user-1',
        createdAt: now,
        updatedAt: now,
    };

    const mockTemplate = {
        id: 'tmpl-1',
        name: 'Default Template',
        description: null,
        variables: [],
        isSystem: false,
        usageCount: 0,
        createdBy: 'user-1',
        lastUsed: null,
        createdAt: now,
        updatedAt: now,
    };

    const mockUser = {
        id: 'user-2',
        email: 'other@example.com',
        name: 'Other User',
    };

    beforeEach(async () => {
        mockRepository = {
            findMany: vi.fn(),
            findById: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            getProjectStats: vi.fn(),
            findCollaboratorsByProject: vi.fn(),
            findCollaboratorByUserAndProject: vi.fn(),
            createCollaborator: vi.fn(),
            updateCollaborator: vi.fn(),
            deleteCollaboratorByUserAndProject: vi.fn(),
            findEnvironmentsByProject: vi.fn(),
            findEnvironmentById: vi.fn(),
            createEnvironment: vi.fn(),
            updateEnvironment: vi.fn(),
            deleteEnvironment: vi.fn(),
            findTemplatesByProject: vi.fn(),
            findTemplateById: vi.fn(),
            createTemplate: vi.fn(),
            updateTemplate: vi.fn(),
            deleteTemplate: vi.fn(),
            findUserByEmail: vi.fn(),
        };

        mockEventService = {
            emit: vi.fn(),
        };

        mockCoreEventSyncService = {
            registerNamespaceAdapter: vi.fn(),
            selectMany: vi.fn(),
        };

        mockRuntimeConfigurationAccessor = {
            resolveStrict: vi.fn(),
            resolve: vi.fn(),
            resolveForDeployment: vi.fn(),
            projectConfigFromSettings: vi.fn(),
            serviceConfigFromRecord: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                {
                    provide: ProjectService,
                    useFactory: () => new ProjectService(
                        mockRepository,
                        mockEventService,
                        mockRuntimeConfigurationAccessor,
                        mockCoreEventSyncService,
                    ),
                },
            ],
        }).compile();

        service = module.get<ProjectService>(ProjectService);
        vi.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    // ========================================
    // listProjects
    // ========================================

    describe('listProjects', () => {
        it('should delegate to repository findMany', async () => {
            const input = { limit: 10, offset: 0 };
            const mockResponse = { data: [mockProject], meta: { total: 1, limit: 10, offset: 0, hasMore: false } };
            mockRepository.findMany.mockResolvedValue(mockResponse);

            const result = await service.listProjects(input);

            expect(result).toEqual(mockResponse);
            expect(mockRepository.findMany).toHaveBeenCalledWith(input);
        });
    });

    // ========================================
    // getProjectById
    // ========================================

    describe('getProjectById', () => {
        it('should return project with stats when found', async () => {
            const stats = { _count: { services: 2, deployments: 5, collaborators: 1 }, latestDeployment: null };
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.getProjectStats.mockResolvedValue(stats);

            const result = await service.getProjectById('proj-1');

            expect(result).toEqual({ ...mockProject, ...stats });
            expect(mockRepository.findById).toHaveBeenCalledWith('proj-1');
        });

        it('should throw NotFoundException when project not found', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.getProjectById('missing')).rejects.toThrow(NotFoundException);
        });
    });

    // ========================================
    // createProject
    // ========================================

    describe('createProject', () => {
        it('should create a project', async () => {
            mockRepository.create.mockResolvedValue(mockProject);

            const result = await service.createProject({ name: 'Test', ownerId: 'user-1' });

            expect(result).toEqual(mockProject);
            expect(mockRepository.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Test', ownerId: 'user-1' }));
            expect(mockEventService.emit).toHaveBeenCalledWith(
                'projectCreated',
                { ownerId: 'user-1' },
                expect.objectContaining({
                    projectId: mockProject.id,
                    ownerId: mockProject.ownerId,
                    name: mockProject.name,
                }),
            );
        });
    });

    // ========================================
    // updateProject
    // ========================================

    describe('updateProject', () => {
        it('should update when requester is owner', async () => {
            const updated = { ...mockProject, name: 'Renamed' };
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findCollaboratorByUserAndProject.mockResolvedValue(null);
            mockRepository.update.mockResolvedValue(updated);

            const result = await service.updateProject('proj-1', 'user-1', { name: 'Renamed' });

            expect(result).toEqual(updated);
            expect(mockEventService.emit).toHaveBeenCalledWith(
                'projectUpdated',
                { projectId: 'proj-1' },
                expect.objectContaining({
                    projectId: 'proj-1',
                    ownerId: updated.ownerId,
                    changedFields: expect.arrayContaining(['name']),
                }),
            );
        });

        it('should update when requester is admin collaborator', async () => {
            const updated = { ...mockProject, name: 'Renamed' };
            const adminCollab = { ...mockCollaborator, role: 'admin', userId: 'user-3' };
            mockRepository.findById.mockResolvedValue({ ...mockProject, ownerId: 'owner-x' });
            mockRepository.findCollaboratorByUserAndProject.mockResolvedValue(adminCollab);
            mockRepository.update.mockResolvedValue(updated);

            const result = await service.updateProject('proj-1', 'user-3', { name: 'Renamed' });

            expect(result).toEqual(updated);
        });

        it('should throw ForbiddenException when requester lacks permission', async () => {
            const devCollab = { ...mockCollaborator, role: 'developer' };
            mockRepository.findById.mockResolvedValue({ ...mockProject, ownerId: 'owner-x' });
            mockRepository.findCollaboratorByUserAndProject.mockResolvedValue(devCollab);

            await expect(service.updateProject('proj-1', 'user-2', { name: 'Fail' })).rejects.toThrow(ForbiddenException);
        });

        it('should throw NotFoundException when update returns null', async () => {
            mockRepository.findById.mockResolvedValue(mockProject); // owner access
            mockRepository.update.mockResolvedValue(null);

            await expect(service.updateProject('proj-1', 'user-1', { name: 'X' })).rejects.toThrow(NotFoundException);
        });
    });

    // ========================================
    // deleteProject
    // ========================================

    describe('deleteProject', () => {
        it('should delete when requester is owner', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.delete.mockResolvedValue(undefined);

            await expect(service.deleteProject('proj-1', 'user-1')).resolves.toBeUndefined();
            expect(mockRepository.delete).toHaveBeenCalledWith('proj-1');
        });

        it('should throw NotFoundException when project not found', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.deleteProject('missing', 'user-1')).rejects.toThrow(NotFoundException);
        });

        it('should throw ForbiddenException when requester is not owner', async () => {
            mockRepository.findById.mockResolvedValue(mockProject); // ownerId: 'user-1'

            await expect(service.deleteProject('proj-1', 'user-99')).rejects.toThrow(ForbiddenException);
        });
    });

    // ========================================
    // getCollaborators
    // ========================================

    describe('getCollaborators', () => {
        it('should return collaborators for a project member', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findCollaboratorsByProject.mockResolvedValue([mockCollaborator]);

            const result = await service.getCollaborators('proj-1', 'user-1');

            expect(result).toEqual([mockCollaborator]);
        });
    });

    // ========================================
    // inviteCollaborator
    // ========================================

    describe('inviteCollaborator', () => {
        it('should invite a new collaborator', async () => {
            mockRepository.findById.mockResolvedValue(mockProject); // owner
            mockRepository.findUserByEmail.mockResolvedValue(mockUser);
            mockRepository.findCollaboratorByUserAndProject.mockResolvedValue(null);
            mockRepository.createCollaborator.mockResolvedValue(mockCollaborator);

            const result = await service.inviteCollaborator('proj-1', 'user-1', {
                email: 'other@example.com',
                role: 'developer',
            });

            expect(result.inviteId).toBe('collab-1');
        });

        it('should throw NotFoundException when invited user does not exist', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findUserByEmail.mockResolvedValue(null);

            await expect(
                service.inviteCollaborator('proj-1', 'user-1', { email: 'nobody@example.com', role: 'developer' }),
            ).rejects.toThrow(NotFoundException);
        });

        it('should throw ConflictException when user is already a collaborator', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findUserByEmail.mockResolvedValue(mockUser);
            mockRepository.findCollaboratorByUserAndProject.mockResolvedValue(mockCollaborator);

            await expect(
                service.inviteCollaborator('proj-1', 'user-1', { email: 'other@example.com', role: 'developer' }),
            ).rejects.toThrow(ConflictException);
        });
    });

    // ========================================
    // removeCollaborator
    // ========================================

    describe('removeCollaborator', () => {
        it('should remove a collaborator', async () => {
            mockRepository.findById.mockResolvedValue(mockProject); // owner
            mockRepository.findCollaboratorByUserAndProject.mockResolvedValue(mockCollaborator);
            mockRepository.deleteCollaboratorByUserAndProject.mockResolvedValue(undefined);

            await expect(service.removeCollaborator('proj-1', 'user-1', 'user-2')).resolves.toBeUndefined();
            expect(mockEventService.emit).toHaveBeenCalledWith(
                'projectCollaboratorRemoved',
                { projectId: 'proj-1' },
                expect.objectContaining({
                    projectId: 'proj-1',
                    userId: 'user-2',
                }),
            );
        });

        it('should throw NotFoundException when collaborator not found', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findCollaboratorByUserAndProject.mockResolvedValue(null);

            await expect(service.removeCollaborator('proj-1', 'user-1', 'user-99')).rejects.toThrow(NotFoundException);
        });

        it('should throw ForbiddenException when trying to remove owner', async () => {
            const ownerCollab = { ...mockCollaborator, role: 'owner' };
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findCollaboratorByUserAndProject.mockResolvedValue(ownerCollab);

            await expect(service.removeCollaborator('proj-1', 'user-1', 'user-2')).rejects.toThrow(ForbiddenException);
        });
    });

    // ========================================
    // listEnvironments / getEnvironment
    // ========================================

    describe('listEnvironments', () => {
        it('should return environments for a project member', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findEnvironmentsByProject.mockResolvedValue([mockEnvironment]);

            const result = await service.listEnvironments('proj-1', 'user-1');

            expect(result).toEqual([mockEnvironment]);
        });
    });

    describe('getEnvironment', () => {
        it('should return environment when found in project', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findEnvironmentById.mockResolvedValue(mockEnvironment);

            const result = await service.getEnvironment('proj-1', 'user-1', 'env-1');

            expect(result).toEqual(mockEnvironment);
        });

        it('should throw NotFoundException when environment belongs to different project', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findEnvironmentById.mockResolvedValue({ ...mockEnvironment, projectId: 'other-proj' });

            await expect(service.getEnvironment('proj-1', 'user-1', 'env-1')).rejects.toThrow(NotFoundException);
        });

        it('should throw NotFoundException when environment not found', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findEnvironmentById.mockResolvedValue(null);

            await expect(service.getEnvironment('proj-1', 'user-1', 'env-1')).rejects.toThrow(NotFoundException);
        });
    });

    // ========================================
    // createEnvironment / deleteEnvironment
    // ========================================

    describe('createEnvironment', () => {
        it('should create an environment', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.createEnvironment.mockResolvedValue(mockEnvironment);

            const result = await service.createEnvironment('proj-1', 'user-1', {
                name: 'production',
                kind: 'stable',
            });

            expect(result).toEqual(mockEnvironment);
        });
    });

    describe('deleteEnvironment', () => {
        it('should delete an environment', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findEnvironmentById.mockResolvedValue(mockEnvironment);
            mockRepository.deleteEnvironment.mockResolvedValue(undefined);

            await expect(service.deleteEnvironment('proj-1', 'user-1', 'env-1')).resolves.toBeUndefined();
        });
    });

    // ========================================
    // Variable templates
    // ========================================

    describe('listVariableTemplates', () => {
        it('should return templates', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findTemplatesByProject.mockResolvedValue([mockTemplate]);

            const result = await service.listVariableTemplates('proj-1', 'user-1');

            expect(result).toEqual([mockTemplate]);
        });
    });

    describe('deleteVariableTemplate', () => {
        it('should delete a non-system template', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findTemplateById.mockResolvedValue(mockTemplate);
            mockRepository.deleteTemplate.mockResolvedValue(undefined);

            await expect(service.deleteVariableTemplate('proj-1', 'user-1', 'tmpl-1')).resolves.toBeUndefined();
        });

        it('should throw BadRequestException for system template', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findTemplateById.mockResolvedValue({ ...mockTemplate, isSystem: true });

            await expect(service.deleteVariableTemplate('proj-1', 'user-1', 'tmpl-1')).rejects.toThrow(BadRequestException);
        });

        it('should throw NotFoundException when template not found', async () => {
            mockRepository.findById.mockResolvedValue(mockProject);
            mockRepository.findTemplateById.mockResolvedValue(null);

            await expect(service.deleteVariableTemplate('proj-1', 'user-1', 'tmpl-1')).rejects.toThrow(NotFoundException);
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
                projectId: 'proj-1',
                ownerId: 'user-1',
                eventTypes: ['projectUpdated'],
                fuzzy: 'rename',
                replay: false,
                replayLimit: 20,
            } as any);

            expect(iterable).toBeDefined();
            expect(mockCoreEventSyncService.selectMany).toHaveBeenCalledTimes(1);
            expect(queryBuilder.whereEventName).toHaveBeenCalledTimes(1);
            expect(queryBuilder.wherePayload).toHaveBeenCalledTimes(2);
            expect(queryBuilder.whereFuzzy).toHaveBeenCalledWith('rename');
            expect(queryBuilder.execute).toHaveBeenCalledTimes(1);
        });
    });
});
