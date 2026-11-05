import { TraefikService } from "@deployer/shared/core/modules/traefik/services/traefik.service";
import * as fs from "node:fs";
import * as path from "node:path";

import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DockerEngine } from "@deployer/docker";
import { ConfigNotFoundError } from "@deployer/shared/core/modules/traefik/errors/index";

import { provideTo, run } from "../testing";

import { DockerRuntimeRunner } from "./docker-runtime-runner.service";

import type { DeploymentRuntimeRunner } from "../runtime-runner.interface";


describe("DockerRuntimeRunner", () => {
    let containers: {
        stopByDeployment: ReturnType<typeof vi.fn>;
        listByDeployment: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
        start: ReturnType<typeof vi.fn>;
        waitForHealth: ReturnType<typeof vi.fn>;
    };
    let traefikService: {
        syncServiceConfiguration: ReturnType<typeof vi.fn>;
        getHealthStatus: ReturnType<typeof vi.fn>;
        createServiceConfiguration: ReturnType<typeof vi.fn>;
    };
    let service: ReturnType<typeof provideTo<InstanceType<typeof DockerRuntimeRunner.live>>>;

    beforeEach(() => {
        containers = {
            stopByDeployment: vi.fn(() => Effect.void),
            listByDeployment: vi.fn(() => Effect.succeed([])),
            remove: vi.fn(() => Effect.void),
            create: vi.fn(() => Effect.succeed({ id: "container-123" })),
            start: vi.fn(() => Effect.void),
            waitForHealth: vi.fn(() => Effect.succeed(true)),
        };

        traefikService = {
            syncServiceConfiguration: vi.fn(() => Effect.succeed({
                success: true,
                configId: "cfg-1",
                configName: "service-route",
                action: "updated",
                message: "ok",
                syncedAt: new Date().toISOString(),
            })),
            getHealthStatus: vi.fn(() => Effect.succeed({ healthy: true })),
            createServiceConfiguration: vi.fn(() => Effect.succeed({ id: "cfg-generated" })),
        };

        service = provideTo(new DockerRuntimeRunner.live(), (effect) =>
            effect.pipe(
                Effect.provideService(DockerEngine, { containers } as never),
                Effect.provideService(TraefikService, traefikService as never),
            ),
        );
    });

    it("materializes volume storage binding into HostConfig.Binds and labels", async () => {
        await run(service.executeRuntime({
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
        }));

        expect(containers.create).toHaveBeenCalledWith(
            expect.objectContaining({
                HostConfig: expect.objectContaining({
                    Binds: ["deployer-storage-volume:/workspace/storage"],
                }),
                Labels: expect.objectContaining({
                    "deployer.managed": "true",
                    "deployer.managed_by": "deployment_service",
                    "deployer.deployment_id": "deployment-1",
                    "deployer.service_id": "service-1",
                    "deployer.storage.type": "volume",
                    "deployer.storage.update_strategy": "manual_update_button",
                    "deployer.storage.auto_redeploy_on_update": "false",
                }),
            }),
        );
    });

    it("materializes NFS storage binding into HostConfig.Mounts", async () => {
        await run(service.executeRuntime({
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
        }));

        expect(containers.create).toHaveBeenCalledWith(
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

        await run(service.executeRuntime({
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
        }));

        const expectedRootPath = path.resolve(process.cwd(), relativeRootPath);
        expect(fs.existsSync(expectedRootPath)).toBe(true);
        expect(containers.create).toHaveBeenCalledWith(
            expect.objectContaining({
                HostConfig: expect.objectContaining({
                    Binds: [`${expectedRootPath}:/workspace/storage`],
                }),
            }),
        );
        fs.rmSync(expectedRootPath, { recursive: true, force: true });
    });

    it("returns managed runtime ownership metadata for DB persistence", async () => {
        const result = await run(service.executeRuntime({
            deployment: {
                deploymentId: "deployment-managed-1",
                serviceId: "service-managed-1",
                projectId: "project-managed-1",
                deploymentContainerName: null,
                deploymentContainerImage: null,
                healthCheckUrl: null,
                networkMode: "bridge",
            },
            artifact: {
                containerImage: "nginx:alpine",
                containerName: "runtime-container-managed-1",
                artifactDigest: null,
                artifactSizeBytes: null,
                buildLogsUrl: null,
            },
            healthGateConfig: {
                maxRetries: 3,
                retryIntervalMs: 200,
            },
            storageBinding: null,
        }));

        expect(result.managedRuntime).toMatchObject({
            managedBy: "deployment_service",
            deploymentId: "deployment-managed-1",
            serviceId: "service-managed-1",
            projectId: "project-managed-1",
            imageRef: "nginx:alpine",
            networkMode: "bridge",
        });
        expect(result.managedRuntime?.labels).toMatchObject({
            "deployer.managed": "true",
            "deployer.managed_by": "deployment_service",
            "deployer.managed_reason": "deployment_execution",
            "deployer.deployment_id": "deployment-managed-1",
            "deployer.service_id": "service-managed-1",
            "deployer.project_id": "project-managed-1",
            "deployer.network_mode": "bridge",
            "deployer.runtime_runner": "docker",
            "deployer.image_ref": "nginx:alpine",
        });
    });

    it("applies executor options labels and startup command to container create", async () => {
        await run(service.executeRuntime({
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
                    "example.runner.compose_profiles": "prod,canary",
                },
                startupCommand: "node server.js",
                environmentVariables: {
                    NODE_ENV: "production",
                    API_URL: "https://api.example.test",
                },
            },
            storageBinding: null,
        }));

        expect(containers.create).toHaveBeenCalledWith(
            expect.objectContaining({
                Labels: expect.objectContaining({
                    "example.runner.compose_profiles": "prod,canary",
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
        await run(service.executeRuntime({
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
                    "example.runner.valid": "value",
                    "bad key": "value",
                    "example.runner.too_long": "x".repeat(513),
                },
                startupCommand: "   node server.js --port 3000   ",
                environmentVariables: {
                    NODE_ENV: "production",
                    "BAD KEY": "ignored",
                },
            },
            storageBinding: null,
        }));

        expect(containers.create).toHaveBeenCalledWith(
            expect.objectContaining({
                Labels: expect.objectContaining({
                    "example.runner.valid": "value",
                }),
                Cmd: ["sh", "-lc", "node server.js --port 3000"],
                Env: ["NODE_ENV=production"],
            }),
        );

        expect(containers.create).not.toHaveBeenCalledWith(
            expect.objectContaining({
                Labels: expect.objectContaining({
                    "bad key": "value",
                }),
            }),
        );
    });

    it("refuses executor labels in a platform-reserved namespace", async () => {
        await expect(run(service.executeRuntime({
            deployment: {
                deploymentId: "deployment-exec-3",
                serviceId: "service-exec-3",
                deploymentContainerName: null,
                deploymentContainerImage: null,
                healthCheckUrl: null,
            },
            artifact: {
                containerImage: "nginx:alpine",
                containerName: null,
                artifactDigest: null,
                artifactSizeBytes: null,
                buildLogsUrl: null,
            },
            healthGateConfig: { maxRetries: 3, retryIntervalMs: 200 },
            executorOptions: {
                labels: {
                    "deployer.service_id": "spoofed-service",
                    "traefik.enable": "true",
                },
            },
            storageBinding: null,
        }))).rejects.toMatchObject({ _tag: "RuntimeInvalid" });

        expect(containers.create).not.toHaveBeenCalled();
    });

    it("retries Traefik sync on transient failure and succeeds", async () => {
        traefikService.syncServiceConfiguration
            .mockReturnValueOnce(Effect.succeed({
                success: false,
                configId: "cfg-failed",
                configName: "service-route",
                action: "updated",
                message: "temporary traefik issue",
                syncedAt: new Date().toISOString(),
            }))
            .mockReturnValueOnce(Effect.succeed({
                success: true,
                configId: "cfg-2",
                configName: "service-route",
                action: "updated",
                message: "ok",
                syncedAt: new Date().toISOString(),
            }));

        const result = await run(service.executeRuntime({
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
        }));

        expect(traefikService.syncServiceConfiguration).toHaveBeenCalledTimes(2);
        expect(result.routeVerification).toMatchObject({
            applied: true,
            attempts: 2,
        });
    });

    it("auto-creates Traefik service configuration when missing then retries sync", async () => {
        traefikService.syncServiceConfiguration
            .mockReturnValueOnce(Effect.fail(new ConfigNotFoundError({ configId: "service-bootstrap-1", configType: "service" })))
            .mockReturnValueOnce(Effect.succeed({
                success: true,
                configId: "cfg-bootstrap-1",
                configName: "service-bootstrap-1",
                action: "created",
                message: "auto-bootstrap",
                syncedAt: new Date().toISOString(),
            }));

        const result = await run(service.executeRuntime({
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
                retryBaseDelayMs: 1,
            },
            storageBinding: null,
        }));

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

    it("respects typed convergence max attempts for Traefik sync failure", async () => {
        traefikService.syncServiceConfiguration.mockReturnValue(Effect.succeed({
            success: false,
            configId: "cfg-failed",
            configName: "service-route",
            action: "updated",
            message: "still unavailable",
            syncedAt: new Date().toISOString(),
        }));

        await expect(
            run(service.executeRuntime({
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
                    retryBaseDelayMs: 1,
                },
                storageBinding: null,
            })),
        ).rejects.toThrow("Traefik route apply/verification failed after 2 attempts");

        expect(traefikService.syncServiceConfiguration).toHaveBeenCalledTimes(2);
    });

    it("fails loudly instead of running nginx when the build produced no image", async () => {
        // Regression (DEPLOY-001): `?? "nginx:alpine"` made a builder-less deploy
        // start a stock nginx and report success.
        await expect(
            run(service.executeRuntime({
                deployment: {
                    deploymentId: "deployment-no-image",
                    serviceId: "service-no-image",
                    deploymentContainerName: null,
                    deploymentContainerImage: null,
                    healthCheckUrl: null,
                },
                artifact: {
                    containerImage: null,
                    containerName: null,
                    artifactDigest: null,
                    artifactSizeBytes: null,
                    buildLogsUrl: null,
                },
                healthGateConfig: { maxRetries: 1, retryIntervalMs: 1 },
                storageBinding: null,
            })),
        ).rejects.toThrow(/No container image was produced/);

        expect(containers.create).not.toHaveBeenCalled();
        expect(traefikService.syncServiceConfiguration).not.toHaveBeenCalled();
    });
});
