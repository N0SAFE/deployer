import { Injectable } from "@nestjs/common";
import type Docker from "dockerode";
import * as fs from "node:fs";
import * as path from "node:path";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import { ConfigNotFoundError } from "@/core/modules/traefik/errors";
import { TraefikService } from "@/core/modules/traefik/services/traefik.service";
import { DeploymentLoadBalancerSyncAdapter } from "../../adapters/deployment-load-balancer-sync.adapter";
import type {
    DeploymentRuntimeRunner,
    DeploymentRuntimeRunnerType,
    RuntimeExecutionInput,
    RuntimeExecutionResult,
} from "../runtime-runner.interface";
import type { DeploymentStorageBinding } from "../../storage/base/storage-provider.interface";

@Injectable()
export class DockerRuntimeRunnerService implements DeploymentRuntimeRunner {
    readonly runnerType: DeploymentRuntimeRunnerType = "docker";
    private static readonly DEFAULT_TRAEFIK_SYNC_MAX_ATTEMPTS = 3;
    private static readonly DEFAULT_LOAD_BALANCER_SYNC_MAX_ATTEMPTS = 3;
    private static readonly DEFAULT_RETRY_BASE_DELAY_MS = 250;

    constructor(
        private readonly dockerService: DockerService,
        private readonly traefikService: TraefikService,
        private readonly deploymentLoadBalancerSyncAdapter: DeploymentLoadBalancerSyncAdapter,
    ) {}

    async executeRuntime(input: RuntimeExecutionInput): Promise<RuntimeExecutionResult> {
        const { deployment, artifact, healthGateConfig, storageBinding, executorOptions, convergenceConfig } = input;
        const sanitizedExecutorLabels = this.sanitizeExecutorLabels(executorOptions?.labels);
        const sanitizedStartupCommand = this.sanitizeStartupCommand(executorOptions?.startupCommand);
        const sanitizedEnvironmentVariables = this.sanitizeEnvironmentVariables(
            executorOptions?.environmentVariables,
        );
        const resolvedConvergenceConfig = this.resolveRuntimeConvergenceConfig(convergenceConfig);
        const fallbackName = `deployer-${deployment.serviceId.slice(0, 12)}-${deployment.deploymentId.slice(0, 8)}`;
        const containerName = artifact.containerName ?? deployment.deploymentContainerName ?? fallbackName;
        const containerImage = artifact.containerImage ?? deployment.deploymentContainerImage ?? "nginx:alpine";
        const managedLabels = {
            "deployer.managed": "true",
            "deployer.managed_by": "deployment_service",
            "deployer.managed_reason": "deployment_execution",
            "deployer.deployment_id": deployment.deploymentId,
            "deployer.service_id": deployment.serviceId,
            ...(deployment.projectId
                ? {
                      "deployer.project_id": deployment.projectId,
                  }
                : {}),
            ...(deployment.organizationId
                ? {
                      "deployer.organization_id": deployment.organizationId,
                  }
                : {}),
            ...(deployment.networkMode
                ? {
                      "deployer.network_mode": deployment.networkMode,
                  }
                : {}),
            "deployer.runtime_runner": this.runnerType,
            "deployer.image_ref": containerImage,
        };
        const storageMaterialization = this.materializeStorageBinding(storageBinding);
        const hostConfig = {
            ...(deployment.networkMode ? { NetworkMode: deployment.networkMode } : {}),
            ...(typeof deployment.cpuShares === "number" && deployment.cpuShares > 0
                ? { NanoCpus: Math.trunc(deployment.cpuShares * 1_000_000_000) }
                : {}),
            ...(typeof deployment.memoryLimitBytes === "number" && deployment.memoryLimitBytes > 0
                ? { Memory: Math.trunc(deployment.memoryLimitBytes) }
                : {}),
            ...(storageMaterialization.binds.length > 0 ? { Binds: storageMaterialization.binds } : {}),
            ...(storageMaterialization.mounts.length > 0 ? { Mounts: storageMaterialization.mounts } : {}),
        };

        let createdContainerId: string | null = null;
        try {
            await this.dockerService.stopContainersByDeployment(deployment.deploymentId);
            const staleContainers = await this.dockerService.listContainersByDeployment(deployment.deploymentId);
            for (const stale of staleContainers) {
                await this.dockerService.removeContainer(stale.id);
            }

            const created = await this.dockerService.createContainer({
                Image: containerImage,
                name: containerName,
                Labels: {
                    ...storageMaterialization.labels,
                    ...sanitizedExecutorLabels,
                    ...managedLabels,
                },
                ...(sanitizedStartupCommand
                    ? { Cmd: ["sh", "-lc", sanitizedStartupCommand] }
                    : {}),
                ...(sanitizedEnvironmentVariables.length > 0
                    ? { Env: sanitizedEnvironmentVariables }
                    : {}),
                ...(Object.keys(hostConfig).length > 0 ? { HostConfig: hostConfig } : {}),
            });
            createdContainerId = created.id;
            await this.dockerService.startContainer(created.id);

            const routeVerification = await this.applyRouteAndVerify(
                deployment.serviceId,
                resolvedConvergenceConfig.traefikSyncMaxAttempts,
                resolvedConvergenceConfig.retryBaseDelayMs,
            );
            const healthGate = await this.enforceReadinessHealthGate(
                created.id,
                deployment.healthCheckUrl,
                healthGateConfig,
            );
            const loadBalancerSync = await this.safeSyncLoadBalancerOwnership({
                deploymentId: deployment.deploymentId,
                serviceId: deployment.serviceId,
                organizationId: deployment.organizationId ?? null,
            }, resolvedConvergenceConfig.loadBalancerSyncMaxAttempts, resolvedConvergenceConfig.retryBaseDelayMs);

            return {
                containerId: created.id,
                containerName,
                containerImage,
                routeVerification,
                healthGate,
                loadBalancerSync,
                managedRuntime: {
                    managedBy: "deployment_service",
                    managedReason: "deployment_execution",
                    deploymentId: deployment.deploymentId,
                    serviceId: deployment.serviceId,
                    projectId: deployment.projectId ?? null,
                    organizationId: deployment.organizationId ?? null,
                    imageRef: containerImage,
                    networkMode: deployment.networkMode ?? null,
                    labels: managedLabels,
                },
            };
        } catch (error) {
            if (createdContainerId) {
                await this.dockerService.removeContainer(createdContainerId);
            }
            throw error;
        }
    }

    private async safeSyncLoadBalancerOwnership(input: {
        deploymentId: string;
        serviceId: string;
        organizationId: string | null;
    }, maxAttempts: number, retryBaseDelayMs: number): Promise<RuntimeExecutionResult["loadBalancerSync"]> {
        let lastErrorMessage: string | null = null;

        for (
            let attempt = 1;
            attempt <= maxAttempts;
            attempt += 1
        ) {
            if (attempt > 1) {
                await this.sleep(retryBaseDelayMs * (attempt - 1));
            }

            try {
                const syncResult = await this.deploymentLoadBalancerSyncAdapter.syncDeploymentOwnership(input);
                return {
                    ...syncResult,
                    attempts: attempt,
                };
            } catch (error) {
                lastErrorMessage = error instanceof Error ? error.message : String(error);
            }
        }

        return {
            applied: false,
            endpoint: null,
            status: "skipped",
            reportedAt: null,
            attempts: maxAttempts,
            ...(lastErrorMessage
                ? {
                      errorMessage: `LB sync skipped after ${String(maxAttempts)} attempts: ${lastErrorMessage}`,
                  }
                : {}),
        };
    }

    private sanitizeExecutorLabels(labels: Record<string, string> | undefined): Record<string, string> {
        if (!labels) {
            return {};
        }

        const sanitized: Record<string, string> = {};
        for (const [rawKey, rawValue] of Object.entries(labels)) {
            const key = rawKey.trim();
            const value = rawValue.trim();

            if (!key || key.length > 128) {
                continue;
            }
            if (!/^[a-zA-Z0-9._/-]+$/.test(key)) {
                continue;
            }
            if (!value || value.length > 512) {
                continue;
            }
            if (/[\u0000-\u001F\u007F]/.test(value)) {
                continue;
            }

            sanitized[key] = value;
        }

        return sanitized;
    }

    private sanitizeStartupCommand(startupCommand: string | undefined): string | null {
        if (!startupCommand) {
            return null;
        }

        const normalized = startupCommand.trim();
        if (!normalized) {
            return null;
        }

        if (normalized.length > 1024) {
            throw new Error("Executor startup command exceeds 1024 characters");
        }

        if (/[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
            throw new Error("Executor startup command contains unsupported control characters");
        }

        return normalized;
    }

    private sanitizeEnvironmentVariables(
        environmentVariables: Record<string, string> | undefined,
    ): string[] {
        if (!environmentVariables) {
            return [];
        }

        const sanitized: string[] = [];
        for (const [rawKey, rawValue] of Object.entries(environmentVariables)) {
            const key = rawKey.trim();
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.length > 128) {
                continue;
            }

            if (typeof rawValue !== "string" || /[\u0000]/.test(rawValue)) {
                continue;
            }

            sanitized.push(`${key}=${rawValue}`);
        }

        return sanitized;
    }

    private materializeStorageBinding(storageBinding: DeploymentStorageBinding | null | undefined): {
        binds: string[];
        mounts: Docker.MountSettings[];
        labels: Record<string, string>;
    } {
        if (!storageBinding) {
            return {
                binds: [],
                mounts: [],
                labels: {},
            };
        }

        const labels: Record<string, string> = {
            "deployer.storage.type": storageBinding.storageType,
            "deployer.storage.mount_path": storageBinding.mountPath,
            "deployer.storage.update_strategy": storageBinding.updateStrategy,
            "deployer.storage.auto_redeploy_on_update": String(
                storageBinding.autoRedeployOnUpdate,
            ),
        };

        const binds: string[] = [];
        const mounts: Docker.MountSettings[] = [];

        if (storageBinding.storageType === "local") {
            const rootPath = this.readMetadataString(storageBinding.metadata, "rootPath");
            if (rootPath) {
                const normalizedRootPath = this.normalizeLocalStorageRootPath(rootPath);
                binds.push(`${normalizedRootPath}:${storageBinding.mountPath}`);
            }
        }

        if (storageBinding.storageType === "volume") {
            const volumeName = this.readMetadataString(storageBinding.metadata, "volumeName");
            if (volumeName) {
                binds.push(`${volumeName}:${storageBinding.mountPath}`);
            }
        }

        if (storageBinding.storageType === "nfs") {
            const server = this.readMetadataString(storageBinding.metadata, "server");
            const exportPath = this.readMetadataString(storageBinding.metadata, "exportPath");
            const readOnly = this.readMetadataBoolean(storageBinding.metadata, "readOnly");

            if (server && exportPath) {
                mounts.push({
                    Type: "volume",
                    Source: this.buildNfsVolumeName(server, exportPath),
                    Target: storageBinding.mountPath,
                    ReadOnly: readOnly,
                    VolumeOptions: {
                        NoCopy: false,
                        Labels: {},
                        DriverConfig: {
                            Name: "local",
                            Options: {
                                type: "nfs",
                                o: `addr=${server},rw`,
                                device: `:${exportPath}`,
                            },
                        },
                    },
                });
            }
        }

        return {
            binds,
            mounts,
            labels,
        };
    }

    private readMetadataString(
        metadata: Record<string, unknown>,
        key: string,
    ): string | null {
        const value = metadata[key];
        return typeof value === "string" && value.trim().length > 0 ? value : null;
    }

    private readMetadataBoolean(
        metadata: Record<string, unknown>,
        key: string,
    ): boolean {
        return metadata[key] === true;
    }

    private buildNfsVolumeName(server: string, exportPath: string): string {
        const normalized = `${server}-${exportPath}`
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48);

        return normalized.length > 0 ? `deployer-nfs-${normalized}` : "deployer-nfs-volume";
    }

    private normalizeLocalStorageRootPath(rootPath: string): string {
        const resolvedPath = path.isAbsolute(rootPath)
            ? rootPath
            : path.resolve(process.cwd(), rootPath);

        fs.mkdirSync(resolvedPath, { recursive: true });
        return resolvedPath;
    }

    private async applyRouteAndVerify(serviceId: string, maxAttempts: number, retryBaseDelayMs: number) {
        let lastErrorMessage: string | null = null;
        let attemptedAutoBootstrap = false;

        for (
            let attempt = 1;
            attempt <= maxAttempts;
            attempt += 1
        ) {
            if (attempt > 1) {
                await this.sleep(retryBaseDelayMs * (attempt - 1));
            }

            try {
                const syncResult = await this.traefikService.syncServiceConfiguration(serviceId);
                if (!syncResult.success) {
                    throw new Error(syncResult.message);
                }

                const healthSummary = await this.traefikService.getHealthStatus();

                return {
                    applied: true,
                    syncResult: {
                        configId: syncResult.configId,
                        configName: syncResult.configName,
                        action: syncResult.action,
                        message: syncResult.message,
                        syncedAt: syncResult.syncedAt
                            ? new Date(syncResult.syncedAt).toISOString()
                            : null,
                    },
                    healthSummary,
                    attempts: attempt,
                    verifiedAt: new Date().toISOString(),
                };
            } catch (error) {
                if (!attemptedAutoBootstrap && error instanceof ConfigNotFoundError) {
                    await this.bootstrapDefaultTraefikConfiguration(serviceId);
                    attemptedAutoBootstrap = true;
                    continue;
                }
                lastErrorMessage = error instanceof Error ? error.message : String(error);
            }
        }

        throw new Error(
            `Traefik route apply/verification failed after ${String(maxAttempts)} attempts: ${lastErrorMessage ?? "unknown error"}`,
        );
    }

    private async bootstrapDefaultTraefikConfiguration(serviceId: string): Promise<void> {
        const fallbackSubdomain = this.buildFallbackSubdomain(serviceId);

        await this.traefikService.createServiceConfiguration(serviceId, {
            domain: "localhost",
            subdomain: fallbackSubdomain,
            port: 80,
            sslEnabled: false,
            pathPrefix: "/",
            isActive: true,
        });
    }

    private buildFallbackSubdomain(serviceId: string): string {
        const normalized = serviceId
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 32);

        if (!normalized) {
            return "service";
        }

        return normalized;
    }

    private resolveRuntimeConvergenceConfig(input: RuntimeExecutionInput["convergenceConfig"]) {
        const traefikSyncMaxAttempts =
            typeof input?.traefikSyncMaxAttempts === "number" &&
            Number.isInteger(input.traefikSyncMaxAttempts) &&
            input.traefikSyncMaxAttempts > 0
                ? input.traefikSyncMaxAttempts
                : DockerRuntimeRunnerService.DEFAULT_TRAEFIK_SYNC_MAX_ATTEMPTS;
        const loadBalancerSyncMaxAttempts =
            typeof input?.loadBalancerSyncMaxAttempts === "number" &&
            Number.isInteger(input.loadBalancerSyncMaxAttempts) &&
            input.loadBalancerSyncMaxAttempts > 0
                ? input.loadBalancerSyncMaxAttempts
                : DockerRuntimeRunnerService.DEFAULT_LOAD_BALANCER_SYNC_MAX_ATTEMPTS;
        const retryBaseDelayMs =
            typeof input?.retryBaseDelayMs === "number" &&
            Number.isInteger(input.retryBaseDelayMs) &&
            input.retryBaseDelayMs > 0
                ? input.retryBaseDelayMs
                : DockerRuntimeRunnerService.DEFAULT_RETRY_BASE_DELAY_MS;

        return {
            traefikSyncMaxAttempts,
            loadBalancerSyncMaxAttempts,
            retryBaseDelayMs,
        };
    }

    private sleep(delayMs: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, delayMs);
        });
    }

    private async enforceReadinessHealthGate(
        containerId: string,
        healthCheckUrl: string | null,
        config: {
            maxRetries: number;
            retryIntervalMs: number;
        },
    ) {
        const isHealthy = await this.dockerService.waitForContainerHealth(
            containerId,
            config.maxRetries,
            config.retryIntervalMs,
            healthCheckUrl ?? undefined,
        );

        if (!isHealthy) {
            throw new Error(
                `Readiness health gate failed for container '${containerId}' after ${String(config.maxRetries)} retries`,
            );
        }

        return {
            passed: true as const,
            containerId,
            healthCheckUrl,
            maxRetries: config.maxRetries,
            retryIntervalMs: config.retryIntervalMs,
            verifiedAt: new Date().toISOString(),
        };
    }
}
