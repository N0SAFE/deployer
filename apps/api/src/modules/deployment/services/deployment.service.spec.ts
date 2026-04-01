import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { firstValueFrom, take, toArray } from 'rxjs';
import { DeploymentService } from './deployment.service';
import { DeploymentEventService } from '../events/deployment-event.service';
import { SourceProviderRegistryService } from '../providers/source-provider-registry.service';
import { GithubSourceProviderService } from '../providers/github/github-source-provider.service';
import { UploadSourceProviderService } from '../providers/upload/upload-source-provider.service';
import { UploadBundleRegistryService } from '../providers/upload/upload-bundle-registry.service';
import { CustomSourceProviderService } from '../providers/custom/custom-source-provider.service';
import { RuntimeRunnerRegistryService } from '../runners/runtime-runner-registry.service';
import { DockerRuntimeRunnerService } from '../runners/docker/docker-runtime-runner.service';
import { DeploymentLoadBalancerSyncAdapter } from '../adapters/deployment-load-balancer-sync.adapter';
import { DeploymentExecutionWorkflowService } from './deployment-execution-workflow.service';
import { DeploymentQueueLifecycleService } from '../queue/deployment-queue-lifecycle.service';
import { DeploymentBullQueueService } from '../queue/deployment-bull-queue.service';
import { DeploymentQueueEventService } from '../queue/deployment-queue-event.service';
import { StorageProviderRegistryService } from '../storage/storage-provider-registry.service';
import { LocalStorageProviderService } from '../storage/local/local-storage-provider.service';
import { S3StorageProviderService } from '../storage/s3/s3-storage-provider.service';
import { NfsStorageProviderService } from '../storage/nfs/nfs-storage-provider.service';
import { VolumeStorageProviderService } from '../storage/volume/volume-storage-provider.service';
import { StoragePolicyResolverRegistryService } from '../storage/policy/storage-policy-resolver-registry.service';
import { ServiceCustomDataStoragePolicyResolverService } from '../storage/policy/service-custom-data-storage-policy-resolver.service';
import { ServiceTopLevelStoragePolicyResolverService } from '../storage/policy/service-top-level-storage-policy-resolver.service';
import { RuntimeConfigurationStoragePolicyResolverService } from '../storage/policy/runtime-configuration-storage-policy-resolver.service';
import { EnvService } from '@/config/env/env.service';
import { DeploymentProviderBuilderRunnerStateMachineService } from '@/core/modules/deployment/services/deployment-provider-builder-runner-state-machine.service';

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
    for (const item of items) {
        await Promise.resolve();
        yield item;
    }
}

describe('DeploymentService', () => {
    let service: DeploymentService;
    let mockRepository: any;
    let mockDeploymentEventService: any;
    let mockCoreEventSyncService: any;
    let mockGitService: any;
    let mockDockerService: any;
    let mockTraefikService: any;
    let mockDeploymentBullQueueService: any;
    let mockDeploymentQueueEventService: any;
    let mockProjectAccessService: any;
    let mockUploadBundleRegistryService: any;

    const now = '2024-01-01T00:00:00.000Z';

    const mockDeployment = {
        id: 'deploy-1',
        serviceId: 'service-1',
        triggeredBy: 'user-1',
        status: 'queued' as const,
        environment: 'production' as const,
        sourceType: 'github' as const,
        sourceConfig: { branch: 'main' },
        containerName: null,
        containerImage: null,
        domainUrl: null,
        healthCheckUrl: null,
        errorMessage: null,
        buildStartedAt: null,
        buildCompletedAt: null,
        deployStartedAt: null,
        deployCompletedAt: null,
        metadata: null,
        createdAt: now,
        updatedAt: now,
    };

    const mockSuccessDeployment = {
        ...mockDeployment,
        id: 'deploy-2',
        status: 'success' as const,
    };

    const mockFailedDeployment = {
        ...mockDeployment,
        id: 'deploy-failed',
        status: 'failed' as const,
    };

    const mockRollback = {
        id: 'rollback-1',
        fromDeploymentId: 'deploy-1',
        toDeploymentId: 'deploy-2',
        triggeredBy: 'user-1',
        status: 'completed' as const,
        reason: null,
        startedAt: now,
        completedAt: now,
        failedAt: null,
        errorMessage: null,
        metadata: null,
        createdAt: now,
        updatedAt: now,
    };

    const mockLog = {
        id: 'log-1',
        deploymentId: 'deploy-1',
        level: 'info' as const,
        message: 'Build started',
        phase: 'build',
        step: null,
        service: null,
        stage: null,
        metadata: null,
        timestamp: now,
    };

    const mockEventLog = {
        id: 'log-event-1',
        deploymentId: 'deploy-1',
        level: 'info' as const,
        message: 'Deployment queued',
        phase: 'queued',
        step: null,
        service: null,
        stage: 'queue',
        metadata: null,
        timestamp: now,
    };

    beforeEach(async () => {
        mockRepository = {
            findMany: vi.fn(),
            findById: vi.fn(),
            create: vi.fn(),
            updateStatus: vi.fn(),
            persistBuildArtifacts: vi.fn(),
            delete: vi.fn(),
            findLogs: vi.fn(),
            countLogs: vi.fn(),
            findRollbacks: vi.fn(),
            createRollback: vi.fn(),
            updateRollbackStatus: vi.fn(),
            updatePhase: vi.fn(),
            insertLog: vi.fn(),
            findRecentDeployments: vi.fn(),
            findRecentLogs: vi.fn(),
            findServiceIdsByProject: vi.fn(),
            getServiceProjectId: vi.fn(),
            getRuntimeConfigurationSeed: vi.fn(),
            getServiceDependencies: vi.fn(),
        };

        mockProjectAccessService = {
            findProjectById: vi.fn(),
            findCollaboratorByUserAndProject: vi.fn(),
        };

        mockDeploymentEventService = {
            emit: vi.fn(),
            subscribe: vi.fn(),
        };

        mockCoreEventSyncService = {
            registerNamespaceAdapter: vi.fn(),
            createStream: vi.fn(),
            updateStream: vi.fn(),
            deleteStream: vi.fn(),
        };

        mockGitService = {
            validateRepository: vi.fn(),
        };

        mockDockerService = {
            stopContainersByDeployment: vi.fn(),
            listContainersByDeployment: vi.fn(),
            removeContainer: vi.fn(),
            createContainer: vi.fn(),
            startContainer: vi.fn(),
            waitForContainerHealth: vi.fn(),
        };

        mockTraefikService = {
            syncServiceConfiguration: vi.fn(),
            getHealthStatus: vi.fn(),
        };

        mockDeploymentBullQueueService = {
            enqueueFromQueueJob: vi.fn().mockResolvedValue(null),
        };

        mockDeploymentQueueEventService = {
            emit: vi.fn(),
        };

        mockUploadBundleRegistryService = {
            register: vi.fn((record: any) => ({
                ...record,
                uploadedAt: now,
            })),
            findByUploadId: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                {
                    provide: DeploymentService,
                    useFactory: (
                        sourceProviderRegistryService: SourceProviderRegistryService,
                        storageProviderRegistryService: StorageProviderRegistryService,
                        storagePolicyResolverRegistryService: StoragePolicyResolverRegistryService,
                        deploymentExecutionWorkflowService: DeploymentExecutionWorkflowService,
                        deploymentQueueLifecycleService: DeploymentQueueLifecycleService,
                        deploymentBullQueueService: DeploymentBullQueueService,
                        deploymentProviderBuilderRunnerStateMachineService: DeploymentProviderBuilderRunnerStateMachineService,
                        uploadBundleRegistryService: UploadBundleRegistryService,
                    ) =>
                        new DeploymentService(
                            mockRepository,
                            mockDeploymentEventService,
                            mockCoreEventSyncService,
                            sourceProviderRegistryService,
                            storageProviderRegistryService,
                            storagePolicyResolverRegistryService,
                            deploymentExecutionWorkflowService,
                            deploymentQueueLifecycleService,
                            deploymentBullQueueService,
                            deploymentProviderBuilderRunnerStateMachineService,
                            uploadBundleRegistryService,
                            mockProjectAccessService,
                        ),
                    inject: [
                        SourceProviderRegistryService,
                        StorageProviderRegistryService,
                        StoragePolicyResolverRegistryService,
                        DeploymentExecutionWorkflowService,
                        DeploymentQueueLifecycleService,
                        DeploymentBullQueueService,
                        DeploymentProviderBuilderRunnerStateMachineService,
                        UploadBundleRegistryService,
                    ],
                },
                {
                    provide: DeploymentProviderBuilderRunnerStateMachineService,
                    useFactory: () => new DeploymentProviderBuilderRunnerStateMachineService(),
                },
                {
                    provide: DeploymentEventService,
                    useFactory: () => mockDeploymentEventService,
                },
                {
                    provide: GithubSourceProviderService,
                    useFactory: () => new GithubSourceProviderService(mockGitService),
                },
                {
                    provide: SourceProviderRegistryService,
                    useFactory: (
                        githubSourceProviderService: GithubSourceProviderService,
                        uploadSourceProviderService: UploadSourceProviderService,
                        customSourceProviderService: CustomSourceProviderService,
                    ) =>
                        new SourceProviderRegistryService([
                            githubSourceProviderService,
                            uploadSourceProviderService,
                            customSourceProviderService,
                        ]),
                    inject: [GithubSourceProviderService, UploadSourceProviderService, CustomSourceProviderService],
                },
                {
                    provide: UploadSourceProviderService,
                    useFactory: (uploadBundleRegistryService: UploadBundleRegistryService) =>
                        new UploadSourceProviderService(uploadBundleRegistryService),
                    inject: [UploadBundleRegistryService],
                },
                {
                    provide: UploadBundleRegistryService,
                    useFactory: () => mockUploadBundleRegistryService,
                },
                {
                    provide: CustomSourceProviderService,
                    useFactory: () => new CustomSourceProviderService(),
                },
                {
                    provide: DockerRuntimeRunnerService,
                    useFactory: () => {
                        const loadBalancerSyncAdapter = new DeploymentLoadBalancerSyncAdapter(
                            new EnvService(),
                        );
                        return new DockerRuntimeRunnerService(
                            mockDockerService,
                            mockTraefikService,
                            loadBalancerSyncAdapter,
                        );
                    },
                },
                {
                    provide: LocalStorageProviderService,
                    useFactory: () => new LocalStorageProviderService(),
                },
                {
                    provide: S3StorageProviderService,
                    useFactory: () => new S3StorageProviderService(),
                },
                {
                    provide: NfsStorageProviderService,
                    useFactory: () => new NfsStorageProviderService(),
                },
                {
                    provide: VolumeStorageProviderService,
                    useFactory: () => new VolumeStorageProviderService(),
                },
                {
                    provide: StorageProviderRegistryService,
                    useFactory: (
                        localStorageProviderService: LocalStorageProviderService,
                        s3StorageProviderService: S3StorageProviderService,
                        nfsStorageProviderService: NfsStorageProviderService,
                        volumeStorageProviderService: VolumeStorageProviderService,
                    ) =>
                        new StorageProviderRegistryService([
                            localStorageProviderService,
                            s3StorageProviderService,
                            nfsStorageProviderService,
                            volumeStorageProviderService,
                        ]),
                    inject: [
                        LocalStorageProviderService,
                        S3StorageProviderService,
                        NfsStorageProviderService,
                        VolumeStorageProviderService,
                    ],
                },
                {
                    provide: RuntimeConfigurationStoragePolicyResolverService,
                    useFactory: () => new RuntimeConfigurationStoragePolicyResolverService(),
                },
                {
                    provide: ServiceCustomDataStoragePolicyResolverService,
                    useFactory: () => new ServiceCustomDataStoragePolicyResolverService(),
                },
                {
                    provide: ServiceTopLevelStoragePolicyResolverService,
                    useFactory: () => new ServiceTopLevelStoragePolicyResolverService(),
                },
                {
                    provide: StoragePolicyResolverRegistryService,
                    useFactory: (
                        runtimeConfigurationStoragePolicyResolverService: RuntimeConfigurationStoragePolicyResolverService,
                        serviceCustomDataStoragePolicyResolverService: ServiceCustomDataStoragePolicyResolverService,
                        serviceTopLevelStoragePolicyResolverService: ServiceTopLevelStoragePolicyResolverService,
                    ) =>
                        new StoragePolicyResolverRegistryService([
                            runtimeConfigurationStoragePolicyResolverService,
                            serviceCustomDataStoragePolicyResolverService,
                            serviceTopLevelStoragePolicyResolverService,
                        ]),
                    inject: [
                        RuntimeConfigurationStoragePolicyResolverService,
                        ServiceCustomDataStoragePolicyResolverService,
                        ServiceTopLevelStoragePolicyResolverService,
                    ],
                },
                {
                    provide: RuntimeRunnerRegistryService,
                    useFactory: (dockerRuntimeRunnerService: DockerRuntimeRunnerService) =>
                        new RuntimeRunnerRegistryService(dockerRuntimeRunnerService),
                    inject: [DockerRuntimeRunnerService],
                },
                {
                    provide: DeploymentExecutionWorkflowService,
                    useFactory: (
                        runtimeRunnerRegistryService: RuntimeRunnerRegistryService,
                    ) =>
                        new DeploymentExecutionWorkflowService(
                            mockRepository,
                            runtimeRunnerRegistryService,
                            mockDeploymentEventService,
                        ),
                    inject: [RuntimeRunnerRegistryService],
                },
                {
                    provide: DeploymentQueueLifecycleService,
                    useFactory: () =>
                        new DeploymentQueueLifecycleService(
                            mockDeploymentQueueEventService,
                        ),
                },
                {
                    provide: DeploymentBullQueueService,
                    useFactory: () => mockDeploymentBullQueueService,
                },
                {
                    provide: DeploymentQueueEventService,
                    useFactory: () => mockDeploymentQueueEventService,
                },
            ],
        }).compile();

        service = module.get<DeploymentService>(DeploymentService);
        vi.clearAllMocks();

        mockRepository.getServiceProjectId.mockResolvedValue('proj-1');
        mockRepository.getRuntimeConfigurationSeed.mockResolvedValue({
            projectId: 'proj-1',
            projectSettings: null,
            service: {
                providerId: 'github',
                builderId: 'dockerfile',
                customDomains: null,
                environmentVariables: null,
                resourceLimits: null,
            },
        });
        mockRepository.getServiceDependencies.mockResolvedValue([]);
        mockProjectAccessService.findProjectById.mockResolvedValue({ id: 'proj-1', ownerId: 'user-1' });
        mockProjectAccessService.findCollaboratorByUserAndProject.mockResolvedValue(null);

        mockRepository.updatePhase.mockResolvedValue(mockDeployment);
        mockRepository.persistBuildArtifacts.mockResolvedValue(mockDeployment);
        mockRepository.insertLog.mockResolvedValue(mockEventLog);
        mockRepository.createRollback.mockResolvedValue({
            id: 'rb-1',
            fromDeploymentId: 'deploy-1',
            toDeploymentId: 'deploy-3',
            triggeredBy: 'user-1',
            status: 'pending',
            reason: null,
            startedAt: null,
            completedAt: null,
            failedAt: null,
            errorMessage: null,
            metadata: null,
            createdAt: now,
            updatedAt: now,
        });
        mockRepository.updateRollbackStatus.mockResolvedValue({
            id: 'rb-1',
            fromDeploymentId: 'deploy-1',
            toDeploymentId: 'deploy-3',
            triggeredBy: 'user-1',
            status: 'in_progress',
            reason: null,
            startedAt: now,
            completedAt: null,
            failedAt: null,
            errorMessage: null,
            metadata: null,
            createdAt: now,
            updatedAt: now,
        });
        mockDockerService.listContainersByDeployment.mockResolvedValue([]);
        mockDockerService.createContainer.mockResolvedValue({ id: 'container-1' });
        mockDockerService.startContainer.mockResolvedValue(undefined);
        mockDockerService.waitForContainerHealth.mockResolvedValue(true);
        mockTraefikService.syncServiceConfiguration.mockResolvedValue({
            configId: 'cfg-1',
            configName: 'service-route',
            success: true,
            action: 'updated',
            message: 'ok',
        });
        mockTraefikService.getHealthStatus.mockResolvedValue({ healthy: true });
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    // ========================================
    // listDeployments
    // ========================================

    describe('listDeployments', () => {
        it('should delegate to repository findMany', async () => {
            const input = { limit: 20, offset: 0 };
            const mockResult = { data: [mockDeployment], meta: { total: 1, limit: 20, offset: 0, hasMore: false } };
            mockRepository.findMany.mockResolvedValue(mockResult);

            const result = await service.listDeployments(input as any);

            expect(result).toEqual(mockResult);
            expect(mockRepository.findMany).toHaveBeenCalledWith(input);
        });
    });

    // ========================================
    // getDeploymentById
    // ========================================

    describe('getDeploymentById', () => {
        it('should return deployment when found', async () => {
            mockRepository.findById.mockResolvedValue(mockDeployment);

            const result = await service.getDeploymentById('deploy-1');

            expect(result).toEqual(mockDeployment);
            expect(mockRepository.findById).toHaveBeenCalledWith('deploy-1');
        });

        it('should throw NotFoundException when not found', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.getDeploymentById('missing')).rejects.toThrow(NotFoundException);
        });
    });

    describe('uploadBundle', () => {
        it('should register uploaded bundle metadata in registry', async () => {
            const file = new File([new Uint8Array([1, 2, 3, 4])], 'bundle.zip', {
                type: 'application/zip',
            });

            const result = await service.uploadBundle({ file });

            expect(result.uploadId).toBeTruthy();
            expect(result.fileName).toBe('bundle.zip');
            expect(result.fileSize).toBe(4);
            expect(mockUploadBundleRegistryService.register).toHaveBeenCalledWith(
                expect.objectContaining({
                    uploadId: result.uploadId,
                    uploadPath: result.uploadPath,
                    fileName: 'bundle.zip',
                    fileSize: 4,
                    mimeType: 'application/zip',
                }),
            );
        });
    });

    // ========================================
    // triggerDeployment
    // ========================================

    describe('triggerDeployment', () => {
        it('should create a deployment record and return it', async () => {
            mockRepository.create.mockResolvedValue(mockDeployment);
            mockGitService.validateRepository.mockResolvedValue(true);

            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'github',
                sourceConfig: { repositoryUrl: 'https://github.com/acme/repo', branch: 'main' },
            } as any;
            const result = await service.triggerDeployment(input, 'user-1');

            expect(result).toEqual(mockDeployment);
            expect(mockRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({ serviceId: 'service-1', triggeredBy: 'user-1' }),
            );
            expect(mockRepository.insertLog).toHaveBeenCalledWith(
                'deploy-1',
                expect.objectContaining({
                    stage: 'provider',
                    step: 'checkout_resolved',
                    phase: 'queued',
                }),
            );
        });

        it('should enqueue a deploy orchestration queue job', async () => {
            mockRepository.create.mockResolvedValue(mockDeployment);
            mockGitService.validateRepository.mockResolvedValue(true);

            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'github',
                sourceConfig: { repositoryUrl: 'https://github.com/acme/repo', branch: 'main' },
            } as any;
            await service.triggerDeployment(input, 'user-1');

            const jobs = Array.from((service as any).queueJobs.values());
            expect(jobs).toHaveLength(1);
            expect(jobs[0]).toMatchObject({
                type: 'deploy',
                status: 'queued',
                idempotencyKey: 'deploy:deploy-1:trigger',
                payload: {
                    deploymentId: 'deploy-1',
                    serviceId: 'service-1',
                    projectId: 'proj-1',
                    environment: 'production',
                    context: {
                        dependencyGraph: {
                            serviceId: 'service-1',
                            dependencies: [],
                            requiredServiceIds: [],
                        },
                        sourceCheckout: {
                            provider: 'github',
                            repositoryUrl: 'https://github.com/acme/repo',
                            branch: 'main',
                        },
                    },
                },
            });
        });

        it('should reject deployment when service dependency graph crosses project boundaries', async () => {
            mockRepository.getServiceDependencies.mockResolvedValue([
                {
                    dependsOnServiceId: 'service-2',
                    isRequired: true,
                    dependsOnProjectId: 'proj-2',
                },
            ]);

            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'github',
                sourceConfig: { repositoryUrl: 'https://github.com/acme/repo', branch: 'main' },
            } as any;

            await expect(service.triggerDeployment(input, 'user-1')).rejects.toThrow(BadRequestException);
            expect(mockRepository.create).not.toHaveBeenCalled();
        });

        it('should propagate required dependency ids into deployment queue context', async () => {
            mockRepository.getServiceDependencies.mockResolvedValue([
                {
                    dependsOnServiceId: 'service-2',
                    isRequired: true,
                    dependsOnProjectId: 'proj-1',
                },
                {
                    dependsOnServiceId: 'service-3',
                    isRequired: false,
                    dependsOnProjectId: 'proj-1',
                },
            ]);
            mockRepository.create.mockResolvedValue(mockDeployment);
            mockGitService.validateRepository.mockResolvedValue(true);

            await service.triggerDeployment(
                {
                    serviceId: 'service-1',
                    environment: 'production',
                    sourceType: 'github',
                    sourceConfig: { repositoryUrl: 'https://github.com/acme/repo', branch: 'main' },
                } as any,
                'user-1',
            );

            const jobs: Array<{ payload?: { context?: { dependencyGraph?: unknown } } }> = Array.from(
                (service as any).queueJobs.values(),
            );

            expect(jobs).toHaveLength(1);
            expect(jobs[0]?.payload?.context?.dependencyGraph).toEqual({
                serviceId: 'service-1',
                dependencies: [
                    { dependsOnServiceId: 'service-2', isRequired: true },
                    { dependsOnServiceId: 'service-3', isRequired: false },
                ],
                requiredServiceIds: ['service-2'],
            });
        });

        it('should reject github trigger without repository url', async () => {
            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'github',
                sourceConfig: { branch: 'main' },
            } as any;

            await expect(service.triggerDeployment(input, 'user-1')).rejects.toThrow(BadRequestException);
            expect(mockRepository.create).not.toHaveBeenCalled();
        });

        it('should reject github trigger when repository is not accessible', async () => {
            mockGitService.validateRepository.mockResolvedValue(false);

            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'github',
                sourceConfig: { repositoryUrl: 'https://github.com/acme/private-repo', branch: 'main' },
            } as any;

            await expect(service.triggerDeployment(input, 'user-1')).rejects.toThrow(BadRequestException);
            expect(mockRepository.create).not.toHaveBeenCalled();
        });

        it('should reject deployment when runtime configuration blocks target environment', async () => {
            mockRepository.getRuntimeConfigurationSeed.mockResolvedValue({
                projectId: 'proj-1',
                projectSettings: {
                    requireApprovalForProduction: true,
                },
                service: {
                    providerId: 'github',
                    builderId: 'dockerfile',
                    customDomains: null,
                    environmentVariables: null,
                    resourceLimits: null,
                },
            });

            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'github',
                sourceConfig: { repositoryUrl: 'https://github.com/acme/private-repo', branch: 'main' },
            } as any;

            await expect(service.triggerDeployment(input, 'user-1')).rejects.toThrow(BadRequestException);
            expect(mockRepository.create).not.toHaveBeenCalled();
        });

        it('should throw ForbiddenException when caller is not owner or collaborator', async () => {
            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'github',
                sourceConfig: { repositoryUrl: 'https://github.com/acme/repo', branch: 'main' },
            } as any;

            await expect(service.triggerDeployment(input, 'other-user')).rejects.toThrow(ForbiddenException);
            expect(mockRepository.create).not.toHaveBeenCalled();
        });

        it('should allow platform operator to trigger deployment without project membership', async () => {
            mockRepository.create.mockResolvedValue(mockDeployment);
            mockGitService.validateRepository.mockResolvedValue(true);

            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'github',
                sourceConfig: { repositoryUrl: 'https://github.com/acme/repo', branch: 'main' },
            } as any;

            const result = await service.triggerDeployment(input, 'other-user', 'operator');

            expect(result).toEqual(mockDeployment);
            expect(mockRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({ serviceId: 'service-1', triggeredBy: 'other-user' }),
            );
        });

        it('should enqueue an upload deployment with upload source context', async () => {
            mockRepository.create.mockResolvedValue({
                ...mockDeployment,
                id: 'deploy-upload-1',
                sourceType: 'upload',
                sourceConfig: {
                    fileName: 'bundle.zip',
                    fileSize: 12345,
                    customData: {
                        uploadId: 'upload-123',
                        uploadPath: '/tmp/uploads/upload-123',
                    },
                },
            });

            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'upload',
                sourceConfig: {
                    fileName: 'bundle.zip',
                    fileSize: 12345,
                    customData: {
                        uploadId: 'upload-123',
                        uploadPath: '/tmp/uploads/upload-123',
                    },
                },
            } as any;

            const result = await service.triggerDeployment(input, 'user-1');

            expect(result.id).toBe('deploy-upload-1');
            const jobs: Array<{ payload?: { context?: { sourceCheckout?: unknown } } }> = Array.from(
                (service as any).queueJobs.values(),
            );
            expect(jobs).toHaveLength(1);
            expect(jobs[0]?.payload?.context?.sourceCheckout).toEqual({
                provider: 'upload',
                uploadId: 'upload-123',
                uploadPath: '/tmp/uploads/upload-123',
                fileName: 'bundle.zip',
                fileSize: 12345,
            });
            expect((jobs[0]?.payload as { context?: { storageBinding?: unknown } } | undefined)?.context?.storageBinding)
                .toMatchObject({
                    storageType: 'local',
                    autoRedeployOnUpdate: false,
                    updateStrategy: 'manual_update_button',
                });
            expect(mockGitService.validateRepository).not.toHaveBeenCalled();
        });

        it('should resolve upload source path from registry when trigger provides uploadId only', async () => {
            mockUploadBundleRegistryService.findByUploadId.mockReturnValue({
                uploadId: 'upload-registry-1',
                uploadPath: '/tmp/uploads/upload-registry-1-bundle.zip',
                fileName: 'bundle.zip',
                fileSize: 45678,
                mimeType: 'application/zip',
                uploadedAt: now,
            });

            mockRepository.create.mockResolvedValue({
                ...mockDeployment,
                id: 'deploy-upload-registry-1',
                sourceType: 'upload',
                sourceConfig: {
                    fileName: 'bundle.zip',
                    fileSize: 45678,
                    customData: {
                        uploadId: 'upload-registry-1',
                    },
                },
            });

            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'upload',
                sourceConfig: {
                    customData: {
                        uploadId: 'upload-registry-1',
                    },
                },
            } as any;

            const result = await service.triggerDeployment(input, 'user-1');

            expect(result.id).toBe('deploy-upload-registry-1');
            expect(mockUploadBundleRegistryService.findByUploadId).toHaveBeenCalledWith('upload-registry-1');

            const jobs: Array<{ payload?: { context?: { sourceCheckout?: unknown } } }> = Array.from(
                (service as any).queueJobs.values(),
            );
            expect(jobs).toHaveLength(1);
            expect(jobs[0]?.payload?.context?.sourceCheckout).toEqual({
                provider: 'upload',
                uploadId: 'upload-registry-1',
                uploadPath: '/tmp/uploads/upload-registry-1-bundle.zip',
                fileName: 'bundle.zip',
                fileSize: 45678,
            });
        });

        it('should reject upload trigger when uploadId cannot be resolved and uploadPath is absent', async () => {
            mockUploadBundleRegistryService.findByUploadId.mockReturnValue(null);

            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'upload',
                sourceConfig: {
                    customData: {
                        uploadId: 'upload-missing-1',
                    },
                },
            } as any;

            await expect(service.triggerDeployment(input, 'user-1')).rejects.toThrow(BadRequestException);
            expect(mockUploadBundleRegistryService.findByUploadId).toHaveBeenCalledWith('upload-missing-1');
            expect(mockRepository.create).not.toHaveBeenCalled();
        });

        it('should derive storage redeploy policy from service metadata when trigger has no storage config', async () => {
            mockRepository.getRuntimeConfigurationSeed.mockResolvedValue({
                projectId: 'proj-1',
                projectSettings: null,
                service: {
                    providerId: 'github',
                    builderId: 'dockerfile',
                    customDomains: null,
                    environmentVariables: null,
                    resourceLimits: null,
                    metadata: {
                        customData: {
                            storage: {
                                type: 'local',
                                autoRedeployOnUpdate: true,
                                mountPath: '/workspace/persisted',
                                local: {
                                    rootPath: '/srv/storage/services/service-1',
                                },
                            },
                        },
                    },
                },
            });
            mockRepository.create.mockResolvedValue(mockDeployment);
            mockGitService.validateRepository.mockResolvedValue(true);

            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'github',
                sourceConfig: { repositoryUrl: 'https://github.com/acme/repo', branch: 'main' },
            } as any;

            await service.triggerDeployment(input, 'user-1');

            const jobs: Array<{ payload?: { context?: { storageBinding?: unknown } } }> = Array.from(
                (service as any).queueJobs.values(),
            );
            expect(jobs).toHaveLength(1);
            expect((jobs[0]?.payload as { context?: { storageBinding?: unknown } } | undefined)?.context?.storageBinding)
                .toMatchObject({
                    storageType: 'local',
                    autoRedeployOnUpdate: true,
                    updateStrategy: 'auto_redeploy',
                    mountPath: '/workspace/persisted',
                });
        });

        it('should reject upload trigger without sourceConfig.customData.uploadId', async () => {
            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'upload',
                sourceConfig: {
                    fileName: 'bundle.zip',
                    fileSize: 12345,
                    customData: {},
                },
            } as any;

            await expect(service.triggerDeployment(input, 'user-1')).rejects.toThrow(BadRequestException);
            expect(mockRepository.create).not.toHaveBeenCalled();
        });

        it("should reject upload trigger targeting dockerfile runtime without containerImage", async () => {
            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'upload',
                sourceConfig: {
                    fileName: 'bundle.zip',
                    fileSize: 12345,
                    customData: {
                        uploadId: 'upload-123',
                        runtimeRunner: 'dockerfile',
                    },
                },
            } as any;

            await expect(service.triggerDeployment(input, 'user-1')).rejects.toThrow(BadRequestException);
            expect(mockRepository.create).not.toHaveBeenCalled();
        });

        it("should allow dockerfile runtime without containerImage when execution.builder is provided", async () => {
            mockRepository.create.mockResolvedValue({
                ...mockDeployment,
                id: 'deploy-upload-builder-1',
                sourceType: 'upload',
                sourceConfig: {
                    fileName: 'bundle.zip',
                    fileSize: 12345,
                    customData: {
                        uploadId: 'upload-123',
                        uploadPath: '/tmp/uploads/upload-123',
                        runtimeRunner: 'dockerfile',
                    },
                },
            });

            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'upload',
                sourceConfig: {
                    fileName: 'bundle.zip',
                    fileSize: 12345,
                    customData: {
                        uploadId: 'upload-123',
                        uploadPath: '/tmp/uploads/upload-123',
                        runtimeRunner: 'dockerfile',
                    },
                },
                execution: {
                    builder: 'nixpacks',
                    runner: 'dockerfile',
                    healthChecks: {
                        runtime: {
                            maxRetries: 7,
                            retryIntervalMs: 600,
                        },
                    },
                },
            } as any;

            const result = await service.triggerDeployment(input, 'user-1');

            expect(result.id).toBe('deploy-upload-builder-1');
            const jobs: Array<{ payload?: { context?: { executionPlan?: unknown } } }> = Array.from(
                (service as any).queueJobs.values(),
            );
            expect(jobs).toHaveLength(1);
            expect(jobs[0]?.payload?.context?.executionPlan).toEqual(
                expect.objectContaining({
                    builder: 'nixpacks',
                    runner: 'dockerfile',
                    healthChecks: {
                        runtime: {
                            maxRetries: 7,
                            retryIntervalMs: 600,
                        },
                    },
                }),
            );
        });

        it('should enqueue custom source dockerfile deployment when containerImage is provided', async () => {
            mockRepository.create.mockResolvedValue({
                ...mockDeployment,
                id: 'deploy-custom-1',
                sourceType: 'custom',
                sourceConfig: {
                    customData: {
                        containerImage: 'registry.local/custom:latest',
                        runtimeRunner: 'dockerfile',
                    },
                },
            });

            const input = {
                serviceId: 'service-1',
                environment: 'preview',
                sourceType: 'custom',
                sourceConfig: {
                    customData: {
                        containerImage: 'registry.local/custom:latest',
                        containerName: 'svc-custom-1',
                        runtimeRunner: 'dockerfile',
                    },
                },
            } as any;

            const result = await service.triggerDeployment(input, 'user-1');

            expect(result.id).toBe('deploy-custom-1');

            const jobs: Array<{ payload?: { context?: { sourceCheckout?: unknown } } }> = Array.from(
                (service as any).queueJobs.values(),
            );

            expect(jobs).toHaveLength(1);
            expect(jobs[0]?.payload?.context?.sourceCheckout).toEqual(
                expect.objectContaining({
                    provider: 'custom',
                    containerImage: 'registry.local/custom:latest',
                    runtimeRunner: 'dockerfile',
                }),
            );
            expect((jobs[0]?.payload as { context?: { executionPlan?: { builder?: string | null } } } | undefined)?.context?.executionPlan?.builder)
                .toBe('external');
        });

        it('should reject non-external builder for docker registry/custom provider', async () => {
            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'custom',
                sourceConfig: {
                    customData: {
                        containerImage: 'registry.local/custom:latest',
                        runtimeRunner: 'dockerfile',
                    },
                },
                execution: {
                    builder: 'nixpacks',
                    runner: 'dockerfile',
                },
            } as any;

            await expect(service.triggerDeployment(input, 'user-1')).rejects.toThrow(BadRequestException);
            expect(mockRepository.create).not.toHaveBeenCalled();
        });

        it('should reject custom commands for docker registry/custom provider', async () => {
            const input = {
                serviceId: 'service-1',
                environment: 'production',
                sourceType: 'custom',
                sourceConfig: {
                    customData: {
                        containerImage: 'registry.local/custom:latest',
                        runtimeRunner: 'dockerfile',
                    },
                },
                execution: {
                    customCommands: {
                        cli: { node: true },
                        runCommand: 'node server.js',
                    },
                },
            } as any;

            await expect(service.triggerDeployment(input, 'user-1')).rejects.toThrow(BadRequestException);
            expect(mockRepository.create).not.toHaveBeenCalled();
        });

        it('should reject preview deployment when state-machine policy disables preview creation', async () => {
            mockRepository.getRuntimeConfigurationSeed.mockResolvedValue({
                projectId: 'proj-1',
                projectSettings: {
                    deploymentStateMachine: {
                        preview: {
                            createEnabled: false,
                        },
                    },
                },
                service: {
                    providerId: 'github',
                    builderId: 'dockerfile',
                    customDomains: null,
                    environmentVariables: null,
                    resourceLimits: null,
                },
            });

            const input = {
                serviceId: 'service-1',
                environment: 'preview',
                sourceType: 'github',
                sourceConfig: { repositoryUrl: 'https://github.com/acme/repo', branch: 'main' },
            } as any;

            await expect(service.triggerDeployment(input, 'user-1')).rejects.toThrow(BadRequestException);
            expect(mockRepository.create).not.toHaveBeenCalled();
        });
    });

    describe('queue build execution persistence', () => {
        it('should complete MVP smoke flow (trigger -> reachable URL metadata -> health green)', async () => {
            const queuedDeployment = {
                ...mockDeployment,
                id: 'deploy-smoke-1',
                healthCheckUrl: 'http://service-1.internal/healthz',
            };

            mockRepository.create.mockResolvedValue(queuedDeployment);
            mockRepository.findById.mockResolvedValue(queuedDeployment);
            mockGitService.validateRepository.mockResolvedValue(true);
            mockDockerService.waitForContainerHealth.mockResolvedValue(true);
            mockTraefikService.getHealthStatus.mockResolvedValue({ healthy: true, route: 'https://app.example.com' });

            const triggered = await service.triggerDeployment(
                {
                    serviceId: 'service-1',
                    environment: 'production',
                    sourceType: 'github',
                    sourceConfig: {
                        repositoryUrl: 'https://github.com/acme/repo',
                        branch: 'main',
                    },
                } as any,
                'user-1',
            );

            expect(triggered.id).toBe('deploy-smoke-1');

            const claim = await service.claimQueueJobs({
                workerId: 'worker-smoke-1',
                limit: 1,
                leaseDurationSec: 120,
                types: ['deploy'],
            } as any);

            const claimedJob = claim.claimed[0];
            expect(claimedJob).toBeDefined();
            expect(claimedJob?.lockToken).toBeTruthy();

            const lockToken = claimedJob?.lockToken;
            if (!lockToken) {
                throw new Error('Expected smoke flow lock token');
            }

            const completion = await service.completeQueueJob(claimedJob.id, {
                workerId: 'worker-smoke-1',
                lockToken,
                result: {
                    containerImage: 'registry.local/my-app:smoke',
                    containerName: 'svc-my-app-smoke',
                    healthCheckMaxRetries: 4,
                    healthCheckRetryIntervalMs: 250,
                },
            });

            expect(completion.updated).toBe(true);
            expect(completion.job.status).toBe('succeeded');
            expect(mockDockerService.waitForContainerHealth).toHaveBeenCalledWith(
                'container-1',
                4,
                250,
                'http://service-1.internal/healthz',
            );

            expect(mockRepository.persistBuildArtifacts).toHaveBeenCalledWith(
                'deploy-smoke-1',
                expect.objectContaining({
                    status: 'success',
                    phase: 'active',
                    phaseProgress: 100,
                    metadata: expect.objectContaining({
                        routeVerification: expect.objectContaining({
                            applied: true,
                            healthSummary: expect.objectContaining({ healthy: true }),
                        }),
                        healthGate: expect.objectContaining({
                            passed: true,
                            healthCheckUrl: 'http://service-1.internal/healthz',
                        }),
                    }),
                }),
            );
            expect(mockTraefikService.syncServiceConfiguration).toHaveBeenCalledWith('service-1');
            expect(mockTraefikService.getHealthStatus).toHaveBeenCalled();
        });

        it('should mark deployment as building when deploy job is claimed', async () => {
            const enqueued = service.enqueueQueueJob({
                type: 'deploy',
                idempotencyKey: 'deploy:test:claim',
                payload: {
                    deploymentId: 'deploy-1',
                    serviceId: 'service-1',
                    environment: 'production',
                    context: {},
                },
                maxAttempts: 3,
            } as any);

            mockRepository.findById.mockResolvedValue(mockDeployment);

            const claimed = await service.claimQueueJobs({
                workerId: 'worker-1',
                limit: 1,
                leaseDurationSec: 120,
            } as any);

            expect(claimed.claimed).toHaveLength(1);
            expect(claimed.claimed[0]?.id).toBe(enqueued.job.id);
            expect(mockRepository.persistBuildArtifacts).toHaveBeenCalledWith(
                'deploy-1',
                expect.objectContaining({
                    status: 'building',
                    phase: 'building',
                    phaseProgress: 25,
                }),
            );
        });

        it('should claim only the targeted queued job by idempotency key', async () => {
            const first = service.enqueueQueueJob({
                type: 'deploy',
                idempotencyKey: 'deploy:test:target:first',
                payload: {
                    deploymentId: 'deploy-first',
                    serviceId: 'service-1',
                    environment: 'production',
                    context: {},
                },
                maxAttempts: 3,
            } as any);

            const second = service.enqueueQueueJob({
                type: 'deploy',
                idempotencyKey: 'deploy:test:target:second',
                payload: {
                    deploymentId: 'deploy-second',
                    serviceId: 'service-1',
                    environment: 'production',
                    context: {},
                },
                maxAttempts: 3,
            } as any);

            mockRepository.findById.mockImplementation((id: string) => {
                if (id === 'deploy-first') return Promise.resolve({ ...mockDeployment, id: 'deploy-first' });
                if (id === 'deploy-second') return Promise.resolve({ ...mockDeployment, id: 'deploy-second' });
                return Promise.resolve(mockDeployment);
            });

            const claimed = await service.claimQueueJobByIdempotencyKey('deploy:test:target:second', {
                workerId: 'worker-targeted-1',
                limit: 1,
                leaseDurationSec: 120,
                types: ['deploy'],
            } as any);

            expect(claimed?.id).toBe(second.job.id);
            expect(service.findQueueJobById(first.job.id)?.status).toBe('queued');
            expect(service.findQueueJobById(second.job.id)?.status).toBe('claimed');
            expect(mockRepository.persistBuildArtifacts).toHaveBeenCalledWith(
                'deploy-second',
                expect.objectContaining({
                    status: 'building',
                    phase: 'building',
                    phaseProgress: 25,
                }),
            );
        });

        it('should return null when targeted idempotency key cannot be claimed', async () => {
            const claimed = await service.claimQueueJobByIdempotencyKey('deploy:test:missing', {
                workerId: 'worker-targeted-2',
                limit: 1,
                leaseDurationSec: 120,
                types: ['deploy'],
            } as any);

            expect(claimed).toBeNull();
            expect(mockRepository.persistBuildArtifacts).not.toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ status: 'building' }),
            );
        });

        it('should persist artifact metadata when deploy job is completed', async () => {
            const enqueued = service.enqueueQueueJob({
                type: 'deploy',
                idempotencyKey: 'deploy:test:complete',
                payload: {
                    deploymentId: 'deploy-1',
                    serviceId: 'service-1',
                    environment: 'production',
                    context: {},
                },
                maxAttempts: 3,
            } as any);

            mockRepository.findById.mockResolvedValue(mockDeployment);

            const claimed = await service.claimQueueJobs({
                workerId: 'worker-2',
                limit: 1,
                leaseDurationSec: 120,
            } as any);

            const claimedJob = claimed.claimed[0];
            expect(claimedJob).toBeDefined();
            expect(claimedJob?.lockToken).toBeTruthy();

            const lockToken = claimedJob?.lockToken;
            if (!lockToken) {
                throw new Error('Expected claimed queue job lock token');
            }

            const result = await service.completeQueueJob(enqueued.job.id, {
                workerId: 'worker-2',
                lockToken,
                result: {
                    containerImage: 'registry.local/my-app:sha-123',
                    containerName: 'svc-my-app-123',
                    artifactDigest: 'sha256:abc123',
                    artifactSizeBytes: 2048,
                    buildLogsUrl: 'https://logs.example.com/build/123',
                },
            });

            expect(result.updated).toBe(true);
            expect(result.job.status).toBe('succeeded');
            expect(mockRepository.persistBuildArtifacts).toHaveBeenCalledWith(
                'deploy-1',
                expect.objectContaining({
                    containerImage: 'registry.local/my-app:sha-123',
                    containerName: 'svc-my-app-123',
                    status: 'success',
                    phase: 'active',
                    phaseProgress: 100,
                }),
            );
            expect(mockDockerService.stopContainersByDeployment).toHaveBeenCalledWith('deploy-1');
            expect(mockDockerService.createContainer).toHaveBeenCalledWith(
                expect.objectContaining({
                    Image: 'registry.local/my-app:sha-123',
                    name: 'svc-my-app-123',
                }),
            );
            expect(mockDockerService.startContainer).toHaveBeenCalledWith('container-1');
            expect(mockTraefikService.syncServiceConfiguration).toHaveBeenCalledWith('service-1');
            expect(mockTraefikService.getHealthStatus).toHaveBeenCalled();
            expect(mockDockerService.waitForContainerHealth).toHaveBeenCalledWith(
                'container-1',
                10,
                2000,
                undefined,
            );
        });

        it('should fail fast when readiness health gate does not pass', async () => {
            const healthCheckedDeployment = {
                ...mockDeployment,
                healthCheckUrl: 'http://service-1.internal/healthz',
            };

            const enqueued = service.enqueueQueueJob({
                type: 'deploy',
                idempotencyKey: 'deploy:test:health-gate-fail',
                payload: {
                    deploymentId: 'deploy-1',
                    serviceId: 'service-1',
                    environment: 'production',
                    context: {},
                },
                maxAttempts: 3,
            } as any);

            mockRepository.findById.mockResolvedValue(healthCheckedDeployment);
            mockDockerService.waitForContainerHealth.mockResolvedValue(false);

            const claimed = await service.claimQueueJobs({
                workerId: 'worker-3',
                limit: 1,
                leaseDurationSec: 120,
            } as any);

            const claimedJob = claimed.claimed[0];
            expect(claimedJob).toBeDefined();
            expect(claimedJob?.lockToken).toBeTruthy();

            const lockToken = claimedJob?.lockToken;
            if (!lockToken) {
                throw new Error('Expected claimed queue job lock token');
            }

            await expect(
                service.completeQueueJob(enqueued.job.id, {
                    workerId: 'worker-3',
                    lockToken,
                    result: {
                        containerImage: 'registry.local/my-app:sha-health-fail',
                        containerName: 'svc-my-app-health-fail',
                        healthCheckMaxRetries: 3,
                        healthCheckRetryIntervalMs: 500,
                    },
                }),
            ).rejects.toThrow(BadRequestException);

            expect(mockDockerService.waitForContainerHealth).toHaveBeenCalledWith(
                'container-1',
                3,
                500,
                'http://service-1.internal/healthz',
            );
            expect(mockDockerService.removeContainer).toHaveBeenCalledWith('container-1');
            expect(mockRepository.updateStatus).toHaveBeenCalledWith(
                'deploy-1',
                'failed',
                expect.objectContaining({
                    containerLifecycle: expect.objectContaining({
                        status: 'failed',
                    }),
                }),
            );
        });

        it('should execute manual upload lifecycle with local storage bind and traefik sync', async () => {
            const manualDeployment = {
                ...mockDeployment,
                id: 'deploy-manual-1',
                sourceType: 'upload' as const,
                sourceConfig: {
                    fileName: 'manual.zip',
                    fileSize: 256,
                    customData: {
                        uploadId: 'upload-manual-1',
                        uploadPath: '/tmp/uploads/upload-manual-1',
                    },
                },
            };

            const enqueued = service.enqueueQueueJob({
                type: 'deploy',
                idempotencyKey: 'deploy:test:manual-upload-local-storage',
                payload: {
                    deploymentId: 'deploy-manual-1',
                    serviceId: 'service-1',
                    environment: 'production',
                    context: {
                        sourceCheckout: {
                            provider: 'upload',
                            uploadId: 'upload-manual-1',
                            uploadPath: '/tmp/uploads/upload-manual-1',
                            fileName: 'manual.zip',
                            fileSize: 256,
                        },
                    },
                },
                maxAttempts: 3,
            } as any);

            mockRepository.findById.mockResolvedValue(manualDeployment);

            const claimed = await service.claimQueueJobs({
                workerId: 'worker-manual-1',
                limit: 1,
                leaseDurationSec: 120,
            } as any);

            const lockToken = claimed.claimed[0]?.lockToken;
            if (!lockToken) {
                throw new Error('Expected claimed queue job lock token');
            }

            await service.completeQueueJob(enqueued.job.id, {
                workerId: 'worker-manual-1',
                lockToken,
                result: {
                    containerImage: 'registry.local/manual:latest',
                    containerName: 'svc-manual-upload-1',
                    storageBinding: {
                        storageType: 'local',
                        autoRedeployOnUpdate: false,
                        updateStrategy: 'manual_update_button',
                        mountPath: '/workspace/storage',
                        metadata: {
                            rootPath: './storage/manual-upload',
                            watchPath: './storage/manual-upload',
                        },
                    },
                },
            });

            expect(mockDockerService.createContainer).toHaveBeenCalledWith(
                expect.objectContaining({
                    Image: 'registry.local/manual:latest',
                    name: 'svc-manual-upload-1',
                    HostConfig: expect.objectContaining({
                        Binds: [expect.stringMatching(/:\/workspace\/storage$/)],
                    }),
                    Labels: expect.objectContaining({
                        'deployer.storage.type': 'local',
                        'deployer.storage.update_strategy': 'manual_update_button',
                    }),
                }),
            );
            expect(mockTraefikService.syncServiceConfiguration).toHaveBeenCalledWith('service-1');
            expect(mockTraefikService.getHealthStatus).toHaveBeenCalled();
        });
    });

    // ========================================
    // cancelDeployment
    // ========================================

    describe('cancelDeployment', () => {
        it('should cancel a queued deployment', async () => {
            mockRepository.findById.mockResolvedValue(mockDeployment);
            mockRepository.updateStatus.mockResolvedValue({ ...mockDeployment, status: 'cancelled' });

            const result = await service.cancelDeployment('deploy-1', 'user-1', 'user_requested');

            expect(result.deploymentId).toBe('deploy-1');
            expect(result.cancelledAt).toBeDefined();
            expect(mockRepository.updateStatus).toHaveBeenCalledWith(
                'deploy-1',
                'cancelled',
                expect.objectContaining({ cancelReason: 'user_requested' }),
            );
        });

        it('should throw NotFoundException when deployment not found', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.cancelDeployment('missing', 'user-1')).rejects.toThrow(NotFoundException);
        });

        it('should throw BadRequestException for already-completed deployment', async () => {
            mockRepository.findById.mockResolvedValue(mockSuccessDeployment);

            await expect(service.cancelDeployment('deploy-2', 'user-1')).rejects.toThrow(BadRequestException);
        });

        it('should throw BadRequestException for cancelled deployment', async () => {
            const cancelledDeploy = { ...mockDeployment, status: 'cancelled' as const };
            mockRepository.findById.mockResolvedValue(cancelledDeploy);

            await expect(service.cancelDeployment('deploy-1', 'user-1')).rejects.toThrow(BadRequestException);
        });

        it('should throw ForbiddenException when caller is not owner or collaborator', async () => {
            mockRepository.findById.mockResolvedValue(mockDeployment);

            await expect(service.cancelDeployment('deploy-1', 'other-user')).rejects.toThrow(ForbiddenException);
        });

        it('should allow platform admin to cancel deployment without project membership', async () => {
            mockRepository.findById.mockResolvedValue(mockDeployment);
            mockRepository.updateStatus.mockResolvedValue({ ...mockDeployment, status: 'cancelled' });

            await expect(
                service.cancelDeployment('deploy-1', 'other-user', 'operator_cancel', 'admin'),
            ).resolves.toEqual(
                expect.objectContaining({ deploymentId: 'deploy-1' }),
            );
            expect(mockRepository.updateStatus).toHaveBeenCalledWith(
                'deploy-1',
                'cancelled',
                expect.objectContaining({ cancelReason: 'operator_cancel' }),
            );
        });
    });

    // ========================================
    // rollbackDeployment
    // ========================================

    describe('rollbackDeployment', () => {
        it('should create a rollback deployment', async () => {
            const rollbackResult = { ...mockDeployment, id: 'deploy-3', metadata: { rollbackFrom: 'deploy-1', targetDeploymentId: 'deploy-2' } };
            mockRepository.findById.mockImplementation((id: string) => {
                if (id === 'deploy-1') return Promise.resolve(mockDeployment);
                if (id === 'deploy-2') return Promise.resolve(mockSuccessDeployment);
                return Promise.resolve(null);
            });
            mockRepository.create.mockResolvedValue(rollbackResult);

            const result = await service.rollbackDeployment('deploy-1', 'deploy-2', 'user-1');

            expect(result.id).toBe('deploy-3');
            expect(mockRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    metadata: expect.objectContaining({ rollbackFrom: 'deploy-1', targetDeploymentId: 'deploy-2' }),
                }),
            );
            expect(mockRepository.createRollback).toHaveBeenCalledWith(
                expect.objectContaining({
                    fromDeploymentId: 'deploy-1',
                    toDeploymentId: 'deploy-3',
                }),
            );

            type QueueJobLike = {
                type: string;
                payload: {
                    deploymentId?: string;
                    projectId?: string;
                };
            };

            const jobs = Array.from(
                (service as unknown as { queueJobs: Map<string, QueueJobLike> }).queueJobs.values(),
            );
            expect(jobs.some((job) => job.type === 'rollback' && job.payload.deploymentId === 'deploy-3')).toBe(
                true,
            );
            const rollbackJob = jobs.find((job) => job.type === 'rollback');
            expect(rollbackJob?.payload?.projectId).toBe('proj-1');
        });

        it('should throw NotFoundException when from-deployment not found', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.rollbackDeployment('missing', 'deploy-2', 'user-1')).rejects.toThrow(NotFoundException);
        });

        it('should throw BadRequestException when services differ', async () => {
            const differentService = { ...mockSuccessDeployment, serviceId: 'service-99' };
            mockRepository.findById.mockImplementation((id: string) => {
                if (id === 'deploy-1') return Promise.resolve(mockDeployment);
                if (id === 'deploy-2') return Promise.resolve(differentService);
                return Promise.resolve(null);
            });

            await expect(service.rollbackDeployment('deploy-1', 'deploy-2', 'user-1')).rejects.toThrow(BadRequestException);
        });

        it('should throw BadRequestException when target deployment is not successful', async () => {
            const failedTarget = { ...mockDeployment, id: 'deploy-2', status: 'failed' as const };
            mockRepository.findById.mockImplementation((id: string) => {
                if (id === 'deploy-1') return Promise.resolve(mockDeployment);
                if (id === 'deploy-2') return Promise.resolve(failedTarget);
                return Promise.resolve(null);
            });

            await expect(service.rollbackDeployment('deploy-1', 'deploy-2', 'user-1')).rejects.toThrow(BadRequestException);
        });

        it('should throw ForbiddenException when caller is not owner or collaborator', async () => {
            mockRepository.findById.mockImplementation((id: string) => {
                if (id === 'deploy-1') return Promise.resolve(mockDeployment);
                if (id === 'deploy-2') return Promise.resolve(mockSuccessDeployment);
                return Promise.resolve(null);
            });

            await expect(service.rollbackDeployment('deploy-1', 'deploy-2', 'other-user')).rejects.toThrow(ForbiddenException);
        });

        it('should reject rollback when state-machine policy disables rollback', async () => {
            mockRepository.getRuntimeConfigurationSeed.mockResolvedValue({
                projectId: 'proj-1',
                projectSettings: {
                    deploymentStateMachine: {
                        rollback: {
                            enabled: false,
                        },
                    },
                },
                service: {
                    providerId: 'github',
                    builderId: 'dockerfile',
                    customDomains: null,
                    environmentVariables: null,
                    resourceLimits: null,
                },
            });

            mockRepository.findById.mockImplementation((id: string) => {
                if (id === 'deploy-1') return Promise.resolve(mockDeployment);
                if (id === 'deploy-2') return Promise.resolve(mockSuccessDeployment);
                return Promise.resolve(null);
            });

            await expect(service.rollbackDeployment('deploy-1', 'deploy-2', 'user-1')).rejects.toThrow(BadRequestException);
            expect(mockRepository.create).not.toHaveBeenCalled();
        });
    });

    describe('rollback queue execution', () => {
        it('should mark rollback in progress when rollback job is claimed', async () => {
            const rollbackDeployment = {
                ...mockDeployment,
                id: 'deploy-rollback',
                metadata: {
                    rollbackFrom: 'deploy-1',
                    targetDeploymentId: 'deploy-2',
                },
            };

            service.enqueueQueueJob({
                type: 'rollback',
                idempotencyKey: 'rollback:test:claim',
                payload: {
                    deploymentId: 'deploy-rollback',
                    serviceId: 'service-1',
                    environment: 'production',
                    context: {
                        rollbackId: 'rb-claim-1',
                        fromDeploymentId: 'deploy-1',
                    },
                },
                maxAttempts: 3,
            } as any);

            mockRepository.findById.mockResolvedValue(rollbackDeployment);

            const claimed = await service.claimQueueJobs({
                workerId: 'worker-rb-1',
                limit: 1,
                leaseDurationSec: 120,
            } as any);

            expect(claimed.claimed).toHaveLength(1);
            expect(mockRepository.updateRollbackStatus).toHaveBeenCalledWith(
                'rb-claim-1',
                'in_progress',
                expect.objectContaining({ startedAt: expect.any(Date) }),
            );
        });

        it('should mark rollback completed when rollback job is completed', async () => {
            const rollbackDeployment = {
                ...mockDeployment,
                id: 'deploy-rollback-complete',
                metadata: {
                    rollbackFrom: 'deploy-1',
                    targetDeploymentId: 'deploy-2',
                },
            };

            const enqueued = service.enqueueQueueJob({
                type: 'rollback',
                idempotencyKey: 'rollback:test:complete',
                payload: {
                    deploymentId: 'deploy-rollback-complete',
                    serviceId: 'service-1',
                    environment: 'production',
                    context: {
                        rollbackId: 'rb-complete-1',
                        fromDeploymentId: 'deploy-1',
                    },
                },
                maxAttempts: 3,
            } as any);

            mockRepository.findById.mockResolvedValue(rollbackDeployment);

            const claimed = await service.claimQueueJobs({
                workerId: 'worker-rb-2',
                limit: 1,
                leaseDurationSec: 120,
            } as any);

            const lockToken = claimed.claimed[0]?.lockToken;
            if (!lockToken) {
                throw new Error('Expected rollback claimed queue job lock token');
            }

            await service.completeQueueJob(enqueued.job.id, {
                workerId: 'worker-rb-2',
                lockToken,
                result: {
                    rollbackCompletedAt: now,
                },
            });

            expect(mockRepository.updateRollbackStatus).toHaveBeenCalledWith(
                'rb-complete-1',
                'completed',
                expect.objectContaining({ completedAt: expect.any(Date) }),
            );
            expect(mockDeploymentEventService.emit).toHaveBeenCalledWith(
                'rollbackCompleted',
                { serviceId: 'service-1' },
                expect.objectContaining({
                    fromDeploymentId: 'deploy-1',
                    toDeploymentId: 'deploy-rollback-complete',
                    success: true,
                }),
            );
        });
    });

    // ========================================
    // getDeploymentLogs
    // ========================================

    describe('getDeploymentLogs', () => {
        it('should return logs with pagination metadata', async () => {
            mockRepository.findById.mockResolvedValue(mockDeployment);
            mockRepository.findLogs.mockResolvedValue([mockLog]);
            mockRepository.countLogs.mockResolvedValue(1);

            const result = await service.getDeploymentLogs('deploy-1', 100, 0);

            expect(result.logs).toEqual([mockLog]);
            expect(result.total).toBe(1);
            expect(result.hasMore).toBe(false);
            expect(mockRepository.findLogs).toHaveBeenCalledWith('deploy-1', 100, 0, undefined);
            expect(mockRepository.countLogs).toHaveBeenCalledWith('deploy-1', undefined);
            expect(result).not.toHaveProperty('retrySummary');
        });

        it('should apply log filters when provided', async () => {
            mockRepository.findById.mockResolvedValue(mockDeployment);
            mockRepository.findLogs.mockResolvedValue([mockLog]);
            mockRepository.countLogs.mockResolvedValue(1);

            const result = await service.getDeploymentLogs('deploy-1', 50, 0, {
                level: 'info',
                phase: 'deploying',
                step: 'convergence_policy',
            });

            expect(result.logs).toEqual([mockLog]);
            expect(mockRepository.findLogs).toHaveBeenCalledWith('deploy-1', 50, 0, {
                level: 'info',
                phase: 'deploying',
                step: 'convergence_policy',
            });
            expect(mockRepository.countLogs).toHaveBeenCalledWith('deploy-1', {
                level: 'info',
                phase: 'deploying',
                step: 'convergence_policy',
            });
        });

        it('should include retry summary when requested', async () => {
            mockRepository.findById.mockResolvedValue(mockDeployment);
            mockRepository.findLogs.mockResolvedValue([mockLog]);
            mockRepository.countLogs
                .mockResolvedValueOnce(12)
                .mockResolvedValueOnce(2)
                .mockResolvedValueOnce(3);

            const result = await service.getDeploymentLogs(
                'deploy-1',
                100,
                0,
                undefined,
                { includeRetrySummary: true },
            );

            expect(result.retrySummary).toEqual({
                scope: 'deployment',
                build: {
                    retryEvents: 2,
                },
                deploy: {
                    retryEvents: 3,
                },
                totalRetryEvents: 5,
            });
            expect(mockRepository.countLogs).toHaveBeenNthCalledWith(1, 'deploy-1', undefined);
            expect(mockRepository.countLogs).toHaveBeenNthCalledWith(2, 'deploy-1', {
                step: 'build_retry',
            });
            expect(mockRepository.countLogs).toHaveBeenNthCalledWith(3, 'deploy-1', {
                step: 'deploy_retry',
            });
        });

        it('should throw NotFoundException when deployment not found', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.getDeploymentLogs('missing', 100, 0)).rejects.toThrow(NotFoundException);
        });

        it('should indicate hasMore when more logs available', async () => {
            mockRepository.findById.mockResolvedValue(mockDeployment);
            mockRepository.findLogs.mockResolvedValue([mockLog]);
            mockRepository.countLogs.mockResolvedValue(200);

            const result = await service.getDeploymentLogs('deploy-1', 100, 0);

            expect(result.hasMore).toBe(true);
        });
    });

    // ========================================
    // deleteDeployment
    // ========================================

    describe('deleteDeployment', () => {
        it('should delete the deployment', async () => {
            mockRepository.findById.mockResolvedValue(mockDeployment);
            mockRepository.delete.mockResolvedValue(undefined);

            await expect(service.deleteDeployment('deploy-1', 'user-1')).resolves.toBeUndefined();
            expect(mockRepository.delete).toHaveBeenCalledWith('deploy-1');
        });

        it('should throw NotFoundException when not found', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.deleteDeployment('missing', 'user-1')).rejects.toThrow(NotFoundException);
        });

        it('should throw ForbiddenException when requester is not owner or collaborator', async () => {
            mockRepository.findById.mockResolvedValue(mockDeployment);

            await expect(service.deleteDeployment('deploy-1', 'other-user')).rejects.toThrow(ForbiddenException);
        });
    });

    // ========================================
    // retryDeployment
    // ========================================

    describe('retryDeployment', () => {
        it('should create a retry deployment for failed deployment', async () => {
            const retryDeployment = { ...mockDeployment, id: 'deploy-retry' };
            mockRepository.findById.mockResolvedValue(mockFailedDeployment);
            mockRepository.create.mockResolvedValue(retryDeployment);

            const result = await service.retryDeployment('deploy-failed', 'user-1');

            expect(result.id).toBe('deploy-retry');
            expect(mockRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    serviceId: mockFailedDeployment.serviceId,
                    triggeredBy: 'user-1',
                }),
            );
        });

        it('should throw BadRequestException for non-retryable status', async () => {
            mockRepository.findById.mockResolvedValue(mockDeployment);

            await expect(service.retryDeployment('deploy-1', 'user-1')).rejects.toThrow(BadRequestException);
        });

        it('should throw ForbiddenException when caller is not owner or collaborator', async () => {
            mockRepository.findById.mockResolvedValue(mockFailedDeployment);

            await expect(service.retryDeployment('deploy-failed', 'other-user')).rejects.toThrow(ForbiddenException);
        });
    });

    // ========================================
    // getRollbackHistory
    // ========================================

    describe('getRollbackHistory', () => {
        it('should return rollback history when deployment exists', async () => {
            mockRepository.findById.mockResolvedValue(mockDeployment);
            mockRepository.findRollbacks.mockResolvedValue([mockRollback]);

            const result = await service.getRollbackHistory('deploy-1');

            expect(result).toEqual({ rollbacks: [mockRollback] });
            expect(mockRepository.findRollbacks).toHaveBeenCalledWith('deploy-1');
        });

        it('should throw NotFoundException when deployment does not exist', async () => {
            mockRepository.findById.mockResolvedValue(null);

            await expect(service.getRollbackHistory('missing')).rejects.toThrow(NotFoundException);
        });
    });

    // ========================================
    // getDeploymentReplayEvents
    // ========================================

    describe('getDeploymentReplayEvents', () => {
        it('should return status/phase/log replay events', async () => {
            const deploymentWithPhase = {
                ...mockDeployment,
                phase: 'deploying' as const,
                phaseProgress: 42,
            };
            mockRepository.findById.mockResolvedValue(deploymentWithPhase);
            mockRepository.findLogs.mockResolvedValue([mockLog]);

            const events = await service.getDeploymentReplayEvents('deploy-1', 20);

            expect(events[0]).toMatchObject({ type: 'statusChanged', status: 'queued' });
            expect(events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ type: 'phaseUpdated', phase: 'deploying', phaseProgress: 42 }),
                    expect.objectContaining({ type: 'logAppended', log: mockLog }),
                ]),
            );
            expect(mockRepository.findLogs).toHaveBeenCalledWith('deploy-1', 20, 0);
        });
    });

    // ========================================
    // getServiceReplayEvents
    // ========================================

    describe('getServiceReplayEvents', () => {
        it('should map deployment history to service events', async () => {
            mockRepository.findRecentDeployments.mockResolvedValue([
                { deployment: { ...mockDeployment, status: 'success' }, projectId: null },
                {
                    deployment: {
                        ...mockDeployment,
                        id: 'deploy-3',
                        status: 'failed',
                        errorMessage: 'boom',
                    },
                    projectId: null,
                },
                {
                    deployment: {
                        ...mockDeployment,
                        id: 'deploy-4',
                        status: 'cancelled',
                        metadata: { cancelReason: 'manual' },
                    },
                    projectId: null,
                },
            ]);

            const events = await service.getServiceReplayEvents('service-1', 10);

            expect(events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ type: 'deploymentTriggered' }),
                    expect.objectContaining({ type: 'deploymentCompleted', deploymentId: 'deploy-1' }),
                    expect.objectContaining({ type: 'deploymentFailed', deploymentId: 'deploy-3' }),
                    expect.objectContaining({ type: 'deploymentCancelled', deploymentId: 'deploy-4' }),
                ]),
            );
            expect(mockRepository.findRecentDeployments).toHaveBeenCalledWith({ serviceId: 'service-1' }, 10);
        });
    });

    // ========================================
    // getFilteredReplayEvents / getProjectServiceIds
    // ========================================

    describe('getFilteredReplayEvents', () => {
        it('should combine deployment and log replay events with filters', async () => {
            mockRepository.findRecentDeployments.mockResolvedValue([
                {
                    deployment: {
                        ...mockDeployment,
                        phase: 'build' as const,
                        phaseProgress: 12,
                        metadata: { rollbackFrom: 'deploy-origin' },
                    },
                    projectId: 'project-1',
                },
            ]);
            mockRepository.findRecentLogs.mockResolvedValue([
                {
                    log: mockLog,
                    deploymentId: 'deploy-1',
                    serviceId: 'service-1',
                    projectId: 'project-1',
                },
            ]);

            const events = await service.getFilteredReplayEvents({ projectId: 'project-1' }, 30);

            expect(events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ type: 'deploymentTriggered' }),
                    expect.objectContaining({ type: 'statusChanged', projectId: 'project-1' }),
                    expect.objectContaining({ type: 'phaseUpdated', phase: 'build' }),
                    expect.objectContaining({ type: 'rollbackStarted', fromDeploymentId: 'deploy-origin' }),
                    expect.objectContaining({ type: 'logAppended', log: mockLog }),
                ]),
            );
            expect(mockRepository.findRecentDeployments).toHaveBeenCalledWith({ projectId: 'project-1' }, 30);
            expect(mockRepository.findRecentLogs).toHaveBeenCalledWith({ projectId: 'project-1' }, 30);
        });

        it('should apply aggregateId/eventType/since filters to replay payloads', async () => {
            mockRepository.findRecentDeployments.mockResolvedValue([
                {
                    deployment: {
                        ...mockDeployment,
                        id: 'deploy-old',
                        createdAt: '2026-03-19T10:00:00.000Z',
                        updatedAt: '2026-03-19T10:05:00.000Z',
                    },
                    projectId: 'project-1',
                },
                {
                    deployment: {
                        ...mockDeployment,
                        id: 'deploy-new',
                        createdAt: '2026-03-21T10:00:00.000Z',
                        updatedAt: '2026-03-21T10:05:00.000Z',
                    },
                    projectId: 'project-1',
                },
            ]);
            mockRepository.findRecentLogs.mockResolvedValue([]);

            const events = await service.getFilteredReplayEvents(
                {
                    projectId: 'project-1',
                    aggregateId: 'deploy-new',
                    eventType: 'statusChanged',
                    since: '2026-03-20T00:00:00.000Z',
                },
                30,
            );

            expect(events).toEqual([
                expect.objectContaining({
                    type: 'statusChanged',
                    deploymentId: 'deploy-new',
                }),
            ]);
        });
    });

    describe('getProjectServiceIds', () => {
        it('should return project service ids from repository', async () => {
            mockRepository.findServiceIdsByProject.mockResolvedValue(['service-1', 'service-2']);

            const result = await service.getProjectServiceIds('project-1');

            expect(result).toEqual(['service-1', 'service-2']);
            expect(mockRepository.findServiceIdsByProject).toHaveBeenCalledWith('project-1');
        });
    });

    describe('streamQueryEvents', () => {
        it('should emit sequenced replay events before live events', async () => {
            vi.spyOn(service, 'getFilteredReplayEvents').mockResolvedValue([
                {
                    type: 'statusChanged',
                    deploymentId: 'deploy-1',
                    status: 'queued',
                } as any,
            ]);

            mockDeploymentEventService.subscribe.mockImplementation((name: string) => {
                if (name === 'statusChanged') {
                    return fromArray([
                        {
                            deploymentId: 'deploy-1',
                            status: 'deploying',
                        },
                    ]);
                }
                return fromArray([]);
            });

            const iterable = service.streamQueryEvents({
                deploymentId: 'deploy-1',
                replay: true,
                replayLimit: 10,
            });

            const [first, second] = await firstValueFrom(iterable.pipe(take(2), toArray()));

            expect(first).toMatchObject({
                type: 'statusChanged',
                sequence: 1,
                replayed: true,
            });

            expect(second).toMatchObject({
                type: 'statusChanged',
                sequence: 2,
                replayed: false,
            });
        });

        it('should resume sequence from cursor and filter live events by type/aggregate', async () => {
            vi.spyOn(service, 'getFilteredReplayEvents').mockResolvedValue([]);

            mockDeploymentEventService.subscribe.mockImplementation((name: string) => {
                if (name === 'statusChanged') {
                    return fromArray([
                        { deploymentId: 'deploy-allowed', status: 'deploying' },
                        { deploymentId: 'deploy-blocked', status: 'failed' },
                    ]);
                }
                return fromArray([]);
            });

            const iterable = service.streamQueryEvents({
                deploymentId: 'deploy-allowed',
                aggregateId: 'deploy-allowed',
                eventType: 'statusChanged',
                replay: false,
                replayLimit: 10,
                cursor: 9,
            });

            const first = await firstValueFrom(iterable);

            expect(first).toMatchObject({
                type: 'statusChanged',
                deploymentId: 'deploy-allowed',
                sequence: 10,
                cursor: '10',
                replayed: false,
            });
        });
    });
});
