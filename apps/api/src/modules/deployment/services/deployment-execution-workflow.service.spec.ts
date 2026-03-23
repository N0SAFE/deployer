import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeploymentExecutionWorkflowService } from "./deployment-execution-workflow.service";

describe("DeploymentExecutionWorkflowService", () => {
    let deploymentRepository: {
        findById: ReturnType<typeof vi.fn>;
        persistBuildArtifacts: ReturnType<typeof vi.fn>;
        insertLog: ReturnType<typeof vi.fn>;
        updateStatus: ReturnType<typeof vi.fn>;
        updatePhase: ReturnType<typeof vi.fn>;
        updateRollbackStatus: ReturnType<typeof vi.fn>;
    };
    let runtimeRunnerRegistryService: {
        execute: ReturnType<typeof vi.fn>;
    };
    let deploymentEventService: {
        emit: ReturnType<typeof vi.fn>;
    };

    let service: DeploymentExecutionWorkflowService;

    beforeEach(() => {
        deploymentRepository = {
            findById: vi.fn().mockResolvedValue({
                id: "deployment-1",
                serviceId: "service-1",
                metadata: {},
                buildStartedAt: null,
                deployStartedAt: null,
                containerName: null,
                containerImage: null,
                healthCheckUrl: null,
            }),
            persistBuildArtifacts: vi.fn().mockResolvedValue(undefined),
            insertLog: vi.fn().mockResolvedValue(undefined),
            updateStatus: vi.fn().mockResolvedValue(undefined),
            updatePhase: vi.fn().mockResolvedValue(undefined),
            updateRollbackStatus: vi.fn().mockResolvedValue(undefined),
        };

        runtimeRunnerRegistryService = {
            execute: vi.fn().mockResolvedValue({
                containerId: "container-1",
                containerName: "runtime-container",
                containerImage: "nginx:alpine",
                routeVerification: {
                    applied: true,
                    syncResult: {
                        configId: "cfg-1",
                        configName: "svc-route",
                        action: "updated",
                        message: "ok",
                        syncedAt: new Date().toISOString(),
                    },
                    healthSummary: {},
                    attempts: 1,
                    verifiedAt: new Date().toISOString(),
                },
                healthGate: {
                    passed: true,
                    containerId: "container-1",
                    healthCheckUrl: null,
                    maxRetries: 10,
                    retryIntervalMs: 2000,
                    verifiedAt: new Date().toISOString(),
                },
            }),
        };

        deploymentEventService = {
            emit: vi.fn(),
        };

        service = new DeploymentExecutionWorkflowService(
            deploymentRepository as never,
            runtimeRunnerRegistryService as never,
            deploymentEventService as never,
        );
    });

    it("passes validated storageBinding from queue result to runtime runner", async () => {
        await service.persistBuildExecutionResult("deployment-1", {
            runtimeRunner: "docker",
            containerImage: "nginx:alpine",
            containerName: "runtime-container",
            storageBinding: {
                storageType: "volume",
                autoRedeployOnUpdate: false,
                updateStrategy: "manual_update_button",
                mountPath: "/workspace/storage",
                metadata: {
                    volumeName: "deployer-vol",
                    driver: "local",
                },
            },
        });

        expect(runtimeRunnerRegistryService.execute).toHaveBeenCalledWith(
            "docker",
            expect.objectContaining({
                storageBinding: expect.objectContaining({
                    storageType: "volume",
                    mountPath: "/workspace/storage",
                    updateStrategy: "manual_update_button",
                }),
            }),
        );

        expect(deploymentRepository.insertLog).toHaveBeenCalledWith(
            "deployment-1",
            expect.objectContaining({
                step: "storage_materialization",
                metadata: expect.objectContaining({
                    storageType: "volume",
                    updateStrategy: "manual_update_button",
                }),
            }),
        );

        expect(deploymentRepository.insertLog).toHaveBeenCalledWith(
            "deployment-1",
            expect.objectContaining({
                stage: "build",
                step: "build_completed",
            }),
        );

        expect(deploymentRepository.insertLog).toHaveBeenCalledWith(
            "deployment-1",
            expect.objectContaining({
                stage: "runner",
                step: "runtime_execute",
            }),
        );

        expect(deploymentRepository.insertLog).toHaveBeenCalledWith(
            "deployment-1",
            expect.objectContaining({
                stage: "runner",
                step: "runtime_completed",
            }),
        );
    });

    it("prioritizes runtimeRunnerOptions when building runtime execution input", async () => {
        await service.persistBuildExecutionResult("deployment-1", {
            runtimeRunner: "docker_compose",
            containerImage: "ghcr.io/acme/web:latest",
            runtimeRunnerOptions: {
                containerName: "svc-web-runtime",
                networkMode: "host",
                cpuShares: 3,
                memoryLimitBytes: 768 * 1024 * 1024,
                healthCheckUrl: "http://svc-web/internal-health",
                healthCheckMaxRetries: 7,
                healthCheckRetryIntervalMs: 450,
                traefikSyncMaxAttempts: 4,
                loadBalancerSyncMaxAttempts: 5,
                convergenceRetryBaseDelayMs: 125,
                dockerCompose: {
                    networkMode: "host",
                    profiles: ["prod", "canary"],
                },
            },
            // Should be ignored in favor of runtimeRunnerOptions values
            networkMode: "bridge",
            cpuShares: 1,
            memoryLimitBytes: 256 * 1024 * 1024,
            healthCheckMaxRetries: 2,
            healthCheckRetryIntervalMs: 100,
            traefikSyncMaxAttempts: 1,
            loadBalancerSyncMaxAttempts: 1,
            convergenceRetryBaseDelayMs: 1,
        });

        expect(runtimeRunnerRegistryService.execute).toHaveBeenCalledWith(
            "docker_compose",
            expect.objectContaining({
                deployment: expect.objectContaining({
                    deploymentContainerName: "svc-web-runtime",
                    networkMode: "host",
                    cpuShares: 3,
                    memoryLimitBytes: 768 * 1024 * 1024,
                    healthCheckUrl: "http://svc-web/internal-health",
                }),
                healthGateConfig: {
                    maxRetries: 7,
                    retryIntervalMs: 450,
                },
                convergenceConfig: {
                    traefikSyncMaxAttempts: 4,
                    loadBalancerSyncMaxAttempts: 5,
                    retryBaseDelayMs: 125,
                },
                runtimeRunnerOptions: expect.objectContaining({
                    containerName: "svc-web-runtime",
                    healthCheckMaxRetries: 7,
                    traefikSyncMaxAttempts: 4,
                    dockerCompose: {
                        networkMode: "host",
                        profiles: ["prod", "canary"],
                    },
                }),
            }),
        );

        expect(deploymentRepository.persistBuildArtifacts).toHaveBeenCalledWith(
            "deployment-1",
            expect.objectContaining({
                metadata: expect.objectContaining({
                    convergencePolicy: {
                        traefikSyncMaxAttempts: 4,
                        loadBalancerSyncMaxAttempts: 5,
                        retryBaseDelayMs: 125,
                        source: {
                            traefikSyncMaxAttempts: "runtimeRunnerOptions",
                            loadBalancerSyncMaxAttempts: "runtimeRunnerOptions",
                            retryBaseDelayMs: "runtimeRunnerOptions",
                        },
                    },
                }),
            }),
        );

        expect(deploymentRepository.insertLog).toHaveBeenCalledWith(
            "deployment-1",
            expect.objectContaining({
                step: "convergence_policy",
                metadata: expect.objectContaining({
                    traefikSyncMaxAttempts: 4,
                    loadBalancerSyncMaxAttempts: 5,
                    retryBaseDelayMs: 125,
                    source: {
                        traefikSyncMaxAttempts: "runtimeRunnerOptions",
                        loadBalancerSyncMaxAttempts: "runtimeRunnerOptions",
                        retryBaseDelayMs: "runtimeRunnerOptions",
                    },
                }),
            }),
        );
    });

    it("tracks legacy fallback and default convergence sources", async () => {
        await service.persistBuildExecutionResult("deployment-1", {
            runtimeRunner: "docker",
            containerImage: "nginx:alpine",
            runtimeRunnerOptions: {
                traefikSyncMaxAttempts: 6,
            },
            loadBalancerSyncMaxAttempts: 8,
        });

        expect(runtimeRunnerRegistryService.execute).toHaveBeenCalledWith(
            "docker",
            expect.objectContaining({
                convergenceConfig: {
                    traefikSyncMaxAttempts: 6,
                    loadBalancerSyncMaxAttempts: 8,
                    retryBaseDelayMs: 250,
                },
            }),
        );

        expect(deploymentRepository.persistBuildArtifacts).toHaveBeenCalledWith(
            "deployment-1",
            expect.objectContaining({
                metadata: expect.objectContaining({
                    convergencePolicy: {
                        traefikSyncMaxAttempts: 6,
                        loadBalancerSyncMaxAttempts: 8,
                        retryBaseDelayMs: 250,
                        source: {
                            traefikSyncMaxAttempts: "runtimeRunnerOptions",
                            loadBalancerSyncMaxAttempts: "legacyResult",
                            retryBaseDelayMs: "default",
                        },
                    },
                }),
            }),
        );

        expect(deploymentRepository.insertLog).toHaveBeenCalledWith(
            "deployment-1",
            expect.objectContaining({
                step: "convergence_policy",
                metadata: expect.objectContaining({
                    traefikSyncMaxAttempts: 6,
                    loadBalancerSyncMaxAttempts: 8,
                    retryBaseDelayMs: 250,
                    source: {
                        traefikSyncMaxAttempts: "runtimeRunnerOptions",
                        loadBalancerSyncMaxAttempts: "legacyResult",
                        retryBaseDelayMs: "default",
                    },
                }),
            }),
        );
    });

    it("retries deploy phase runtime execution based on deploy health policy", async () => {
        runtimeRunnerRegistryService.execute
            .mockRejectedValueOnce(new Error("deploy attempt 1 failed"))
            .mockRejectedValueOnce(new Error("deploy attempt 2 failed"))
            .mockResolvedValueOnce({
                containerId: "container-retried",
                containerName: "runtime-container",
                containerImage: "nginx:alpine",
                routeVerification: {
                    applied: true,
                    syncResult: {
                        configId: "cfg-1",
                        configName: "svc-route",
                        action: "updated",
                        message: "ok",
                        syncedAt: new Date().toISOString(),
                    },
                    healthSummary: {},
                    attempts: 1,
                    verifiedAt: new Date().toISOString(),
                },
                healthGate: {
                    passed: true,
                    containerId: "container-retried",
                    healthCheckUrl: null,
                    maxRetries: 10,
                    retryIntervalMs: 2000,
                    verifiedAt: new Date().toISOString(),
                },
            });

        const execution = service.persistBuildExecutionResult("deployment-1", {
            runtimeRunner: "docker",
            containerImage: "nginx:alpine",
            deployHealthCheckMaxRetries: 3,
            deployHealthCheckRetryIntervalMs: 1,
        });

        await execution;

        expect(runtimeRunnerRegistryService.execute).toHaveBeenCalledTimes(3);
        expect(deploymentRepository.insertLog).toHaveBeenCalledWith(
            "deployment-1",
            expect.objectContaining({
                step: "deploy_retry",
                metadata: expect.objectContaining({
                    attempt: 1,
                    maxRetries: 3,
                    retryIntervalMs: 1,
                }),
            }),
        );
        expect(deploymentRepository.insertLog).toHaveBeenCalledWith(
            "deployment-1",
            expect.objectContaining({
                step: "deploy_retry",
                metadata: expect.objectContaining({
                    attempt: 2,
                    maxRetries: 3,
                    retryIntervalMs: 1,
                }),
            }),
        );
    });
});
