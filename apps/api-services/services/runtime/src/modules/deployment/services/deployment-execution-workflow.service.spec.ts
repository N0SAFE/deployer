import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeploymentExecutionWorkflowService } from "./deployment-execution-workflow.service";

describe("DeploymentExecutionWorkflowService", () => {
    let deploymentRepository: {
        findById: ReturnType<typeof vi.fn>;
        getServiceProjectId: ReturnType<typeof vi.fn>;
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
    let domainRoutingService: {
        resolveServiceUrls: ReturnType<typeof vi.fn>;
        resolvePrimaryUrl: ReturnType<typeof vi.fn>;
        syncServiceRoutes: ReturnType<typeof vi.fn>;
        buildVariableMap: ReturnType<typeof vi.fn>;
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
            getServiceProjectId: vi.fn().mockResolvedValue("project-1"),
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
                managedRuntime: {
                    managedBy: "deployment_service",
                    managedReason: "deployment_execution",
                    deploymentId: "deployment-1",
                    serviceId: "service-1",
                    projectId: "project-1",
                    imageRef: "nginx:alpine",
                    networkMode: "bridge",
                    labels: {
                        "deployer.managed": "true",
                        "deployer.deployment_id": "deployment-1",
                        "deployer.service_id": "service-1",
                        "deployer.project_id": "project-1",
                    },
                },
            }),
        };

        deploymentEventService = {
            emit: vi.fn(),
        };

        domainRoutingService = {
            resolveServiceUrls: vi.fn().mockResolvedValue([]),
            resolvePrimaryUrl: vi.fn().mockResolvedValue(null),
            syncServiceRoutes: vi.fn().mockResolvedValue({ success: false, reason: "no_domain_mappings", urls: [], primaryUrl: null }),
            buildVariableMap: vi.fn().mockReturnValue({}),
        };

        service = new DeploymentExecutionWorkflowService(
            deploymentRepository as never,
            runtimeRunnerRegistryService as never,
            deploymentEventService as never,
            domainRoutingService as never,
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
                deployment: expect.objectContaining({
                    projectId: "project-1",
                }),
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

        expect(deploymentRepository.persistBuildArtifacts).toHaveBeenCalledWith(
            "deployment-1",
            expect.objectContaining({
                metadata: expect.objectContaining({
                    managedRuntimeResources: expect.objectContaining({
                        ownership: expect.objectContaining({
                            managedBy: "deployment_service",
                            deploymentId: "deployment-1",
                            serviceId: "service-1",
                            projectId: "project-1",
                        }),
                        image: expect.objectContaining({
                            reference: "nginx:alpine",
                        }),
                        network: expect.objectContaining({
                            mode: "bridge",
                        }),
                    }),
                }),
            }),
        );
    });

    it("prioritizes runtimeRunnerOptions when building runtime execution input", async () => {
        await service.persistBuildExecutionResult("deployment-1", {
            runtimeRunner: "docker_compose",
            containerImage: "ghcr.io/acme/web:latest",
            runtimeRunnerOptions: {
                runner: "docker_compose",
                containerName: "svc-web-runtime",
                networkMode: "host",
                cpuShares: 3,
                memoryLimitBytes: 768 * 1024 * 1024,
                healthCheckUrl: "http://svc-web/internal-health",
                healthCheckMaxRetries: 7,
                healthCheckRetryIntervalMs: 450,
                traefikSyncMaxAttempts: 4,
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
                        retryBaseDelayMs: 125,
                        source: {
                            traefikSyncMaxAttempts: "runtimeRunnerOptions",
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
                    retryBaseDelayMs: 125,
                    source: {
                        traefikSyncMaxAttempts: "runtimeRunnerOptions",
                        retryBaseDelayMs: "runtimeRunnerOptions",
                    },
                }),
            }),
        );
    });

    it("tracks explicit and default convergence sources", async () => {
        await service.persistBuildExecutionResult("deployment-1", {
            runtimeRunner: "docker",
            containerImage: "nginx:alpine",
            runtimeRunnerOptions: {
                runner: "docker_compose",
                traefikSyncMaxAttempts: 6,
            },
        });

        expect(runtimeRunnerRegistryService.execute).toHaveBeenCalledWith(
            "docker",
            expect.objectContaining({
                convergenceConfig: {
                    traefikSyncMaxAttempts: 6,
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
                        retryBaseDelayMs: 250,
                        source: {
                            traefikSyncMaxAttempts: "runtimeRunnerOptions",
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
                    retryBaseDelayMs: 250,
                    source: {
                        traefikSyncMaxAttempts: "runtimeRunnerOptions",
                        retryBaseDelayMs: "default",
                    },
                }),
            }),
        );
    });

    it("forwards runtime environment variables into executor options", async () => {
        await service.persistBuildExecutionResult("deployment-1", {
            runtimeRunner: "docker",
            containerImage: "ghcr.io/acme/web:latest",
            runtimeEnvironmentVariables: {
                NODE_ENV: "production",
                API_URL: "https://api.example.test",
                "invalid key": "ignored",
            },
            customRunCommand: "node server.js",
        });

        expect(runtimeRunnerRegistryService.execute).toHaveBeenCalledWith(
            "docker",
            expect.objectContaining({
                executorOptions: {
                    startupCommand: "node server.js",
                    environmentVariables: {
                        NODE_ENV: "production",
                        API_URL: "https://api.example.test",
                    },
                },
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
                managedRuntime: {
                    managedBy: "deployment_service",
                    managedReason: "deployment_execution",
                    deploymentId: "deployment-1",
                    serviceId: "service-1",
                    projectId: "project-1",
                    imageRef: "nginx:alpine",
                    networkMode: "bridge",
                    labels: {
                        "deployer.managed": "true",
                        "deployer.deployment_id": "deployment-1",
                        "deployer.service_id": "service-1",
                        "deployer.project_id": "project-1",
                    },
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

    it("persists a deploy/retry execution failure on the deployment row (W-Queue Q4)", async () => {
        await service.persistDeploymentExecutionFailure("deployment-1", "build exhausted retries");

        expect(deploymentRepository.updateStatus).toHaveBeenCalledWith(
            "deployment-1",
            "failed",
            expect.objectContaining({
                buildExecution: expect.objectContaining({
                    status: "failed",
                    error: "build exhausted retries",
                }),
                stage: "failed",
            }),
        );
        expect(deploymentRepository.updatePhase).toHaveBeenCalledWith("deployment-1", "failed", 100);
        expect(deploymentRepository.insertLog).toHaveBeenCalledWith(
            "deployment-1",
            expect.objectContaining({
                level: "error",
                phase: "failed",
                step: "execution_fail",
                metadata: expect.objectContaining({ errorMessage: "build exhausted retries" }),
            }),
        );
    });
});
