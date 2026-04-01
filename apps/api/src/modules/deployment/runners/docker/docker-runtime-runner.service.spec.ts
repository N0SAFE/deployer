import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ConfigNotFoundError } from "@/core/modules/traefik/errors";
import { DockerRuntimeRunnerService } from "./docker-runtime-runner.service";

describe("DockerRuntimeRunnerService", () => {
    let dockerService: {
        stopContainersByDeployment: ReturnType<typeof vi.fn>;
        listContainersByDeployment: ReturnType<typeof vi.fn>;
        removeContainer: ReturnType<typeof vi.fn>;
        createContainer: ReturnType<typeof vi.fn>;
        startContainer: ReturnType<typeof vi.fn>;
        waitForContainerHealth: ReturnType<typeof vi.fn>;
    };
    let traefikService: {
        syncServiceConfiguration: ReturnType<typeof vi.fn>;
        getHealthStatus: ReturnType<typeof vi.fn>;
        createServiceConfiguration: ReturnType<typeof vi.fn>;
    };
    let loadBalancerSyncAdapter: {
        syncDeploymentOwnership: ReturnType<typeof vi.fn>;
    };
    let service: DockerRuntimeRunnerService;

    beforeEach(() => {
        dockerService = {
            stopContainersByDeployment: vi.fn().mockResolvedValue(undefined),
            listContainersByDeployment: vi.fn().mockResolvedValue([]),
            removeContainer: vi.fn().mockResolvedValue(undefined),
            createContainer: vi.fn().mockResolvedValue({ id: "container-123" }),
            startContainer: vi.fn().mockResolvedValue(undefined),
            waitForContainerHealth: vi.fn().mockResolvedValue(true),
        };

        traefikService = {
            syncServiceConfiguration: vi.fn().mockResolvedValue({
                success: true,
                configId: "cfg-1",
                configName: "service-route",
                action: "updated",
                message: "ok",
                syncedAt: new Date().toISOString(),
            }),
            getHealthStatus: vi.fn().mockResolvedValue({ healthy: true }),
            createServiceConfiguration: vi.fn().mockResolvedValue({ id: "cfg-generated" }),
        };

        loadBalancerSyncAdapter = {
            syncDeploymentOwnership: vi.fn().mockResolvedValue({
                applied: false,
                endpoint: null,
                status: "skipped",
                reportedAt: null,
            }),
        };

        service = new DockerRuntimeRunnerService(
            dockerService as never,
            traefikService as never,
            loadBalancerSyncAdapter as never,
        );
    });

    it("materializes volume storage binding into HostConfig.Binds and labels", async () => {
        await service.executeRuntime({
            deployment: {
                deploymentId: "deployment-1",
                serviceId: "service-1",
                deploymentContainerName: null,
                deploymentContainerImage: null,
                healthCheckUrl: null,
            },
            artifact: {
                containerImage: "nginx:alpine",
                containerName: "runtime-container",
                artifactDigest: null,
                artifactSizeBytes: null,
                buildLogsUrl: null,
            },
            healthGateConfig: {
                maxRetries: 3,
                retryIntervalMs: 200,
            },
            storageBinding: {
                storageType: "volume",
                autoRedeployOnUpdate: false,
                updateStrategy: "manual_update_button",
                mountPath: "/workspace/storage",
                metadata: {
                    volumeName: "deployer-storage-volume",
                    driver: "local",
                },
            },
        });

        expect(dockerService.createContainer).toHaveBeenCalledWith(
            expect.objectContaining({
                HostConfig: expect.objectContaining({
                    Binds: ["deployer-storage-volume:/workspace/storage"],
                }),
                Labels: expect.objectContaining({
                    "deployer.storage.type": "volume",
                    "deployer.storage.update_strategy": "manual_update_button",
                    "deployer.storage.auto_redeploy_on_update": "false",
                }),
            }),
        );
    });

    it("materializes NFS storage binding into HostConfig.Mounts", async () => {
        await service.executeRuntime({
            deployment: {
                deploymentId: "deployment-2",
                serviceId: "service-2",
                deploymentContainerName: null,
                deploymentContainerImage: null,
                healthCheckUrl: null,
            },
            artifact: {
                containerImage: "nginx:alpine",
                containerName: "runtime-container-2",
                artifactDigest: null,
                artifactSizeBytes: null,
                buildLogsUrl: null,
            },
            healthGateConfig: {
                maxRetries: 3,
                retryIntervalMs: 200,
            },
            storageBinding: {
                storageType: "nfs",
                autoRedeployOnUpdate: true,
                updateStrategy: "auto_redeploy",
                mountPath: "/workspace/storage",
                metadata: {
                    server: "10.10.0.5",
                    exportPath: "/exports/apps",
                    readOnly: true,
                },
            },
        });

        expect(dockerService.createContainer).toHaveBeenCalledWith(
            expect.objectContaining({
                HostConfig: expect.objectContaining({
                    Mounts: [
                        expect.objectContaining({
                            Type: "volume",
                            Target: "/workspace/storage",
                            ReadOnly: true,
                        }),
                    ],
                }),
                Labels: expect.objectContaining({
                    "deployer.storage.type": "nfs",
                    "deployer.storage.update_strategy": "auto_redeploy",
                }),
            }),
        );
    });

    it("normalizes local storage rootPath to absolute host bind and ensures directory exists", async () => {
        const relativeRootPath = `./storage/local-manual-${Date.now()}`;

        await service.executeRuntime({
            deployment: {
                deploymentId: "deployment-3",
                serviceId: "service-3",
                deploymentContainerName: null,
                deploymentContainerImage: null,
                healthCheckUrl: null,
            },
            artifact: {
                containerImage: "nginx:alpine",
                containerName: "runtime-container-3",
                artifactDigest: null,
                artifactSizeBytes: null,
                buildLogsUrl: null,
            },
            healthGateConfig: {
                maxRetries: 3,
                retryIntervalMs: 200,
            },
            storageBinding: {
                storageType: "local",
                autoRedeployOnUpdate: false,
                updateStrategy: "manual_update_button",
                mountPath: "/workspace/storage",
                metadata: {
                    rootPath: relativeRootPath,
                    watchPath: relativeRootPath,
                },
            },
        });

        const expectedRootPath = path.resolve(process.cwd(), relativeRootPath);
        expect(fs.existsSync(expectedRootPath)).toBe(true);
        expect(dockerService.createContainer).toHaveBeenCalledWith(
            expect.objectContaining({
                HostConfig: expect.objectContaining({
                    Binds: [`${expectedRootPath}:/workspace/storage`],
                }),
            }),
        );
        fs.rmSync(expectedRootPath, { recursive: true, force: true });
    });

    it("syncs load balancer ownership after route and health verification", async () => {
        await service.executeRuntime({
            deployment: {
                deploymentId: "deployment-lb-1",
                serviceId: "service-lb-1",
                organizationId: "org-1",
                deploymentContainerName: null,
                deploymentContainerImage: null,
                healthCheckUrl: null,
            },
            artifact: {
                containerImage: "nginx:alpine",
                containerName: "runtime-container-lb",
                artifactDigest: null,
                artifactSizeBytes: null,
                buildLogsUrl: null,
            },
            healthGateConfig: {
                maxRetries: 3,
                retryIntervalMs: 200,
            },
            storageBinding: null,
        });

        expect(loadBalancerSyncAdapter.syncDeploymentOwnership).toHaveBeenCalledWith({
            deploymentId: "deployment-lb-1",
            serviceId: "service-lb-1",
            organizationId: "org-1",
        });
    });

    it("applies executor options labels and startup command to container create", async () => {
        await service.executeRuntime({
            deployment: {
                deploymentId: "deployment-exec-1",
                serviceId: "service-exec-1",
                deploymentContainerName: null,
                deploymentContainerImage: null,
                healthCheckUrl: null,
            },
            artifact: {
                containerImage: "nginx:alpine",
                containerName: "runtime-container-exec",
                artifactDigest: null,
                artifactSizeBytes: null,
                buildLogsUrl: null,
            },
            healthGateConfig: {
                maxRetries: 3,
                retryIntervalMs: 200,
            },
            executorOptions: {
                labels: {
                    "deployer.runner.compose_profiles": "prod,canary",
                },
                startupCommand: "node server.js",
                environmentVariables: {
                    NODE_ENV: "production",
                    API_URL: "https://api.example.test",
                },
            },
            storageBinding: null,
        });

        expect(dockerService.createContainer).toHaveBeenCalledWith(
            expect.objectContaining({
                Labels: expect.objectContaining({
                    "deployer.runner.compose_profiles": "prod,canary",
                }),
                Cmd: ["sh", "-lc", "node server.js"],
                Env: expect.arrayContaining([
                    "NODE_ENV=production",
                    "API_URL=https://api.example.test",
                ]),
            }),
        );
    });

    it("drops invalid executor labels and trims startup command", async () => {
        await service.executeRuntime({
            deployment: {
                deploymentId: "deployment-exec-2",
                serviceId: "service-exec-2",
                deploymentContainerName: null,
                deploymentContainerImage: null,
                healthCheckUrl: null,
            },
            artifact: {
                containerImage: "nginx:alpine",
                containerName: "runtime-container-exec-2",
                artifactDigest: null,
                artifactSizeBytes: null,
                buildLogsUrl: null,
            },
            healthGateConfig: {
                maxRetries: 3,
                retryIntervalMs: 200,
            },
            executorOptions: {
                labels: {
                    "deployer.runner.valid": "value",
                    "bad key": "value",
                    "deployer.runner.too_long": "x".repeat(513),
                },
                startupCommand: "   node server.js --port 3000   ",
                environmentVariables: {
                    NODE_ENV: "production",
                    "BAD KEY": "ignored",
                },
            },
            storageBinding: null,
        });

        expect(dockerService.createContainer).toHaveBeenCalledWith(
            expect.objectContaining({
                Labels: expect.objectContaining({
                    "deployer.runner.valid": "value",
                }),
                Cmd: ["sh", "-lc", "node server.js --port 3000"],
                Env: ["NODE_ENV=production"],
            }),
        );

        expect(dockerService.createContainer).not.toHaveBeenCalledWith(
            expect.objectContaining({
                Labels: expect.objectContaining({
                    "bad key": "value",
                }),
            }),
        );
    });

    it("does not fail deployment when load balancer sync throws", async () => {
        loadBalancerSyncAdapter.syncDeploymentOwnership.mockRejectedValueOnce(new Error("lb unavailable"));

        const result = await service.executeRuntime({
            deployment: {
                deploymentId: "deployment-lb-2",
                serviceId: "service-lb-2",
                organizationId: "org-2",
                deploymentContainerName: null,
                deploymentContainerImage: null,
                healthCheckUrl: null,
            },
            artifact: {
                containerImage: "nginx:alpine",
                containerName: "runtime-container-lb-2",
                artifactDigest: null,
                artifactSizeBytes: null,
                buildLogsUrl: null,
            },
            healthGateConfig: {
                maxRetries: 3,
                retryIntervalMs: 200,
            },
            storageBinding: null,
        });

        expect(result.loadBalancerSync).toMatchObject({
            applied: false,
            status: "skipped",
            attempts: 2,
        });
        expect(loadBalancerSyncAdapter.syncDeploymentOwnership).toHaveBeenCalledTimes(2);
        expect(dockerService.startContainer).toHaveBeenCalledWith("container-123");
    });

    it("retries Traefik sync on transient failure and succeeds", async () => {
        traefikService.syncServiceConfiguration
            .mockResolvedValueOnce({
                success: false,
                configId: "cfg-failed",
                configName: "service-route",
                action: "updated",
                message: "temporary traefik issue",
                syncedAt: new Date().toISOString(),
            })
            .mockResolvedValueOnce({
                success: true,
                configId: "cfg-2",
                configName: "service-route",
                action: "updated",
                message: "ok",
                syncedAt: new Date().toISOString(),
            });

        const result = await service.executeRuntime({
            deployment: {
                deploymentId: "deployment-route-retry-1",
                serviceId: "service-route-retry-1",
                deploymentContainerName: null,
                deploymentContainerImage: null,
                healthCheckUrl: null,
            },
            artifact: {
                containerImage: "nginx:alpine",
                containerName: "runtime-container-route-retry-1",
                artifactDigest: null,
                artifactSizeBytes: null,
                buildLogsUrl: null,
            },
            healthGateConfig: {
                maxRetries: 3,
                retryIntervalMs: 200,
            },
            storageBinding: null,
        });

        expect(traefikService.syncServiceConfiguration).toHaveBeenCalledTimes(2);
        expect(result.routeVerification).toMatchObject({
            applied: true,
            attempts: 2,
        });
    });

    it("auto-creates Traefik service configuration when missing then retries sync", async () => {
        traefikService.syncServiceConfiguration
            .mockRejectedValueOnce(new ConfigNotFoundError("service-bootstrap-1", "service"))
            .mockResolvedValueOnce({
                success: true,
                configId: "cfg-bootstrap-1",
                configName: "service-bootstrap-1",
                action: "created",
                message: "auto-bootstrap",
                syncedAt: new Date().toISOString(),
            });

        const result = await service.executeRuntime({
            deployment: {
                deploymentId: "deployment-bootstrap-1",
                serviceId: "service-bootstrap-1",
                deploymentContainerName: null,
                deploymentContainerImage: null,
                healthCheckUrl: null,
            },
            artifact: {
                containerImage: "nginx:alpine",
                containerName: "runtime-container-bootstrap-1",
                artifactDigest: null,
                artifactSizeBytes: null,
                buildLogsUrl: null,
            },
            healthGateConfig: {
                maxRetries: 3,
                retryIntervalMs: 200,
            },
            convergenceConfig: {
                traefikSyncMaxAttempts: 2,
                loadBalancerSyncMaxAttempts: 1,
                retryBaseDelayMs: 1,
            },
            storageBinding: null,
        });

        expect(traefikService.createServiceConfiguration).toHaveBeenCalledWith(
            "service-bootstrap-1",
            expect.objectContaining({
                domain: "localhost",
                port: 80,
                pathPrefix: "/",
            }),
        );
        expect(traefikService.syncServiceConfiguration).toHaveBeenCalledTimes(2);
        expect(result.routeVerification).toMatchObject({
            applied: true,
            attempts: 2,
        });
    });

    it("retries load balancer sync on transient failure and succeeds", async () => {
        loadBalancerSyncAdapter.syncDeploymentOwnership
            .mockRejectedValueOnce(new Error("transient lb timeout"))
            .mockResolvedValueOnce({
                applied: true,
                endpoint: "http://lb.internal/internal/mesh/load-report",
                status: "synced",
                reportedAt: new Date().toISOString(),
            });

        const result = await service.executeRuntime({
            deployment: {
                deploymentId: "deployment-lb-retry-1",
                serviceId: "service-lb-retry-1",
                organizationId: "org-lb-retry",
                deploymentContainerName: null,
                deploymentContainerImage: null,
                healthCheckUrl: null,
            },
            artifact: {
                containerImage: "nginx:alpine",
                containerName: "runtime-container-lb-retry-1",
                artifactDigest: null,
                artifactSizeBytes: null,
                buildLogsUrl: null,
            },
            healthGateConfig: {
                maxRetries: 3,
                retryIntervalMs: 200,
            },
            convergenceConfig: {
                traefikSyncMaxAttempts: 3,
                loadBalancerSyncMaxAttempts: 3,
                retryBaseDelayMs: 1,
            },
            storageBinding: null,
        });

        expect(loadBalancerSyncAdapter.syncDeploymentOwnership).toHaveBeenCalledTimes(2);
        expect(result.loadBalancerSync).toMatchObject({
            applied: true,
            status: "synced",
            attempts: 2,
        });
    });

    it("respects typed convergence max attempts for Traefik sync failure", async () => {
        traefikService.syncServiceConfiguration.mockResolvedValue({
            success: false,
            configId: "cfg-failed",
            configName: "service-route",
            action: "updated",
            message: "still unavailable",
            syncedAt: new Date().toISOString(),
        });

        await expect(
            service.executeRuntime({
                deployment: {
                    deploymentId: "deployment-route-retry-fail-1",
                    serviceId: "service-route-retry-fail-1",
                    deploymentContainerName: null,
                    deploymentContainerImage: null,
                    healthCheckUrl: null,
                },
                artifact: {
                    containerImage: "nginx:alpine",
                    containerName: "runtime-container-route-retry-fail-1",
                    artifactDigest: null,
                    artifactSizeBytes: null,
                    buildLogsUrl: null,
                },
                healthGateConfig: {
                    maxRetries: 3,
                    retryIntervalMs: 200,
                },
                convergenceConfig: {
                    traefikSyncMaxAttempts: 2,
                    loadBalancerSyncMaxAttempts: 3,
                    retryBaseDelayMs: 1,
                },
                storageBinding: null,
            }),
        ).rejects.toThrow("Traefik route apply/verification failed after 2 attempts");

        expect(traefikService.syncServiceConfiguration).toHaveBeenCalledTimes(2);
    });
});
