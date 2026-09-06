import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { DeploymentObservabilityContext } from "@repo/contracts-entities";
import { DeploymentRepository } from "../repositories/deployment.repository";
import { RuntimeRunnerRegistryService } from "@/modules/runners/runtime-runner-registry.service";
import { DomainRoutingService, type RouteSyncResult } from "@/core/modules/domain/services/domain-routing.service";
import type {
    BuildArtifactResult,
    HealthGateConfig,
    RuntimeConvergenceConfig,
    RuntimeRunnerExecutionOptions,
} from "@/modules/runners/runtime-runner.interface";
import { DeploymentEventService } from "../events/deployment-event.service";
import {
    deploymentStorageBindingSchema,
    type DeploymentStorageBinding,
} from "../storage/base/storage-provider.interface";
import { runtimeRunnerOptionsSchema } from "@/modules/providers/base/runtime-runner-options.schema";
import { isRecord, isObjectLike } from "@repo/type-guards"



type RuntimeConvergenceSource = "runtimeRunnerOptions" | "default";

interface RuntimeConvergenceConfigResolution {
    config: RuntimeConvergenceConfig;
    source: {
        traefikSyncMaxAttempts: RuntimeConvergenceSource;
        retryBaseDelayMs: RuntimeConvergenceSource;
    };
}

interface DeployPhaseRetryPolicy {
    maxRetries: number;
    retryIntervalMs: number;
}

@Injectable()
export class DeploymentExecutionWorkflowService {
    constructor(
        private readonly deploymentRepository: DeploymentRepository,
        private readonly runtimeRunnerRegistryService: RuntimeRunnerRegistryService,
        private readonly deploymentEventService: DeploymentEventService,
        private readonly domainRoutingService: DomainRoutingService,
    ) {}

    async markBuildExecutionStarted(
        deploymentId: string,
        startedAt: Date,
        observability?: DeploymentObservabilityContext | null,
    ) {
        const deployment = await this.getDeploymentById(deploymentId);
        const metadata = this.mergeMetadata(deployment.metadata, {
            buildExecution: {
                status: "started",
                startedAt: startedAt.toISOString(),
            },
            stage: "building",
        });

        await this.deploymentRepository.persistBuildArtifacts(deploymentId, {
            buildStartedAt: startedAt,
            status: "building",
            phase: "building",
            phaseProgress: 25,
            metadata,
        });

        await this.deploymentRepository.insertLog(deploymentId, {
            level: "info",
            message: "Build execution started",
            phase: "building",
            step: "build_started",
            stage: "build",
            correlationId: observability?.correlationId ?? deploymentId,
            traceId: observability?.traceId,
            spanId: observability?.spanId,
            metadata: {
                startedAt: startedAt.toISOString(),
                structured: true,
            },
        });
    }

    async persistBuildExecutionResult(
        deploymentId: string,
        result: Record<string, unknown> | undefined,
        observability?: DeploymentObservabilityContext | null,
    ) {
        const completedAt = this.getResultDate(result, "buildCompletedAt") ?? new Date();
        const startedAt = this.getResultDate(result, "buildStartedAt");
        const artifact = this.extractArtifactResult(result);
        const deployment = await this.getDeploymentById(deploymentId);
        const buildDuration =
            startedAt !== undefined
                ? Math.max(0, completedAt.getTime() - startedAt.getTime())
                : undefined;

        const metadata = this.mergeMetadata(deployment.metadata, {
            artifact: {
                containerImage: artifact.containerImage,
                containerName: artifact.containerName,
                digest: artifact.artifactDigest,
                sizeBytes: artifact.artifactSizeBytes,
                buildLogsUrl: artifact.buildLogsUrl,
                persistedAt: completedAt.toISOString(),
            },
            buildExecution: {
                status: "completed",
                startedAt: startedAt?.toISOString() ?? deployment.buildStartedAt ?? null,
                completedAt: completedAt.toISOString(),
                durationMs: buildDuration,
            },
            ...(buildDuration !== undefined ? { buildDuration } : {}),
            stage: "deploying",
        });

        await this.deploymentRepository.persistBuildArtifacts(deploymentId, {
            buildCompletedAt: completedAt,
            ...(startedAt ? { buildStartedAt: startedAt } : {}),
            containerImage: artifact.containerImage,
            containerName: artifact.containerName,
            status: "deploying",
            phase: "copying_files",
            phaseProgress: 50,
            metadata,
        });

        await this.deploymentRepository.insertLog(deploymentId, {
            level: "info",
            message: "Build execution completed and artifact metadata persisted",
            phase: "building",
            step: "build_completed",
            stage: "build",
            correlationId: observability?.correlationId ?? deploymentId,
            traceId: observability?.traceId,
            spanId: observability?.spanId,
            metadata: {
                containerImage: artifact.containerImage,
                containerName: artifact.containerName,
                digest: artifact.artifactDigest,
                sizeBytes: artifact.artifactSizeBytes,
                buildLogsUrl: artifact.buildLogsUrl,
                durationMs: buildDuration,
                structured: true,
            },
        });

        await this.applyContainerLifecycle(deploymentId, artifact, result, observability);
    }

    async markRollbackExecutionStarted(
        rollbackDeploymentId: string,
        rollbackId: string | null,
        fromDeploymentId: string | null,
        observability?: DeploymentObservabilityContext | null,
    ) {
        const startedAt = new Date();
        const rollbackDeployment = await this.getDeploymentById(rollbackDeploymentId);
        const metadata = this.mergeMetadata(rollbackDeployment.metadata, {
            rollbackExecution: {
                status: "in_progress",
                rollbackId,
                startedAt: startedAt.toISOString(),
            },
            stage: "rollback",
        });

        await this.deploymentRepository.persistBuildArtifacts(rollbackDeploymentId, {
            status: "deploying",
            phase: "copying_files",
            phaseProgress: 65,
            metadata,
        });

        if (rollbackId) {
            await this.deploymentRepository.updateRollbackStatus(rollbackId, "in_progress", {
                startedAt,
            });
        }

        await this.deploymentRepository.insertLog(rollbackDeploymentId, {
            level: "info",
            message: "Rollback execution started",
            phase: "deploying",
            stage: "rollback",
            step: "rollback_start",
            correlationId: observability?.correlationId ?? rollbackDeploymentId,
            traceId: observability?.traceId,
            spanId: observability?.spanId,
            metadata: {
                rollbackId,
                fromDeploymentId,
                startedAt: startedAt.toISOString(),
                structured: true,
            },
        });
    }

    async persistRollbackExecutionResult(
        rollbackDeploymentId: string,
        rollbackId: string | null,
        fromDeploymentId: string | null,
        observability?: DeploymentObservabilityContext | null,
        result?: Record<string, unknown>,
    ) {
        const completedAt = this.getResultDate(result, "rollbackCompletedAt") ?? new Date();
        const rollbackDeployment = await this.getDeploymentById(rollbackDeploymentId);
        const metadata = this.mergeMetadata(rollbackDeployment.metadata, {
            rollbackExecution: {
                status: "completed",
                rollbackId,
                completedAt: completedAt.toISOString(),
            },
            stage: "active",
        });

        await this.deploymentRepository.persistBuildArtifacts(rollbackDeploymentId, {
            deployCompletedAt: completedAt,
            status: "success",
            phase: "active",
            phaseProgress: 100,
            metadata,
        });

        if (rollbackId) {
            await this.deploymentRepository.updateRollbackStatus(rollbackId, "completed", {
                completedAt,
                metadata: {
                    ...(rollbackDeployment.metadata ?? {}),
                    completedByQueue: true,
                },
            });
        }

        await this.deploymentRepository.insertLog(rollbackDeploymentId, {
            level: "info",
            message: "Rollback execution completed",
            phase: "active",
            stage: "rollback",
            step: "rollback_complete",
            correlationId: observability?.correlationId ?? rollbackDeploymentId,
            traceId: observability?.traceId,
            spanId: observability?.spanId,
            metadata: {
                rollbackId,
                fromDeploymentId,
                completedAt: completedAt.toISOString(),
                structured: true,
            },
        });

        if (fromDeploymentId) {
            this.deploymentEventService.emit(
                "rollbackCompleted",
                { serviceId: rollbackDeployment.serviceId },
                {
                    serviceId: rollbackDeployment.serviceId,
                    fromDeploymentId,
                    toDeploymentId: rollbackDeploymentId,
                    success: true,
                    timestamp: completedAt.toISOString(),
                },
            );
        }
    }

    async persistRollbackExecutionFailure(
        rollbackDeploymentId: string,
        rollbackId: string | null,
        fromDeploymentId: string | null,
        errorMessage: string,
    ) {
        const failedAt = new Date();
        const rollbackDeployment = await this.getDeploymentById(rollbackDeploymentId);
        const metadata = this.mergeMetadata(rollbackDeployment.metadata, {
            rollbackExecution: {
                status: "failed",
                rollbackId,
                failedAt: failedAt.toISOString(),
                error: errorMessage,
            },
            stage: "failed",
        });

        await this.deploymentRepository.updateStatus(rollbackDeploymentId, "failed", metadata);
        await this.deploymentRepository.updatePhase(rollbackDeploymentId, "failed", 100);

        if (rollbackId) {
            await this.deploymentRepository.updateRollbackStatus(rollbackId, "failed", {
                failedAt,
                errorMessage,
            });
        }

        await this.deploymentRepository.insertLog(rollbackDeploymentId, {
            level: "error",
            message: "Rollback execution failed",
            phase: "failed",
            stage: "rollback",
            step: "rollback_fail",
            metadata: {
                rollbackId,
                fromDeploymentId,
                errorMessage,
                failedAt: failedAt.toISOString(),
                structured: true,
            },
        });

        if (fromDeploymentId) {
            this.deploymentEventService.emit(
                "rollbackCompleted",
                { serviceId: rollbackDeployment.serviceId },
                {
                    serviceId: rollbackDeployment.serviceId,
                    fromDeploymentId,
                    toDeploymentId: rollbackDeploymentId,
                    success: false,
                    timestamp: failedAt.toISOString(),
                },
            );
        }
    }

    /**
     * W-Queue (Q4): persist a DEPLOY/RETRY queue-job failure onto the
     * deployment row. Previously only ROLLBACK failures were persisted
     * (`persistRollbackExecutionFailure`), leaving deploys stuck at
     * `status = "building"` after exhaust/dead-letter. Mirrors the rollback
     * path: status → failed, phase → failed (progress 100), error log, and
     * execution metadata stamped.
     */
    async persistDeploymentExecutionFailure(deploymentId: string, errorMessage: string) {
        const failedAt = new Date();
        const deployment = await this.getDeploymentById(deploymentId);
        const metadata = this.mergeMetadata(deployment.metadata, {
            buildExecution: {
                status: "failed",
                failedAt: failedAt.toISOString(),
                error: errorMessage,
            },
            stage: "failed",
        });

        await this.deploymentRepository.updateStatus(deploymentId, "failed", metadata);
        await this.deploymentRepository.updatePhase(deploymentId, "failed", 100);

        await this.deploymentRepository.insertLog(deploymentId, {
            level: "error",
            message: "Deployment execution failed (queue exhausted)",
            phase: "failed",
            stage: "build",
            step: "execution_fail",
            metadata: {
                errorMessage,
                failedAt: failedAt.toISOString(),
                structured: true,
            },
        });
    }

    private async applyContainerLifecycle(
        deploymentId: string,
        artifact: BuildArtifactResult,
        result: Record<string, unknown> | undefined,
        observability?: DeploymentObservabilityContext | null,
    ) {
        const deployment = await this.getDeploymentById(deploymentId);
        const deployStartedAt = deployment.deployStartedAt ? new Date(deployment.deployStartedAt) : new Date();

        try {
            await this.deploymentRepository.insertLog(deploymentId, {
                level: "info",
                message: "Container lifecycle cleanup started",
                phase: "deploying",
                step: "cleanup",
                stage: "container_lifecycle",
                correlationId: observability?.correlationId ?? deploymentId,
                traceId: observability?.traceId,
                spanId: observability?.spanId,
                metadata: {
                    runner: this.resolveRuntimeRunnerKind(result),
                },
            });

            const storageBinding = this.resolveStorageBinding(result);
            const runtimeRunnerOptions = this.resolveRuntimeRunnerOptions(result);
            const customRunCommand = this.getResultString(result, "customRunCommand");
            const runtimeEnvironmentVariables = this.resolveRuntimeEnvironmentVariables(result);
            const convergenceResolution = this.resolveRuntimeConvergenceConfig(runtimeRunnerOptions);
            const deployRetryPolicy = this.resolveDeployPhaseRetryPolicy(result);
            const projectId = await this.deploymentRepository.getServiceProjectId(deployment.serviceId);

            await this.deploymentRepository.insertLog(deploymentId, {
                level: "info",
                message: "Runtime convergence policy resolved",
                phase: "deploying",
                step: "convergence_policy",
                stage: "routing",
                correlationId: observability?.correlationId ?? deploymentId,
                traceId: observability?.traceId,
                spanId: observability?.spanId,
                metadata: {
                    ...convergenceResolution.config,
                    source: convergenceResolution.source,
                    structured: true,
                },
            });

            if (storageBinding) {
                await this.deploymentRepository.insertLog(deploymentId, {
                    level: "info",
                    message: "Storage binding materialized for runtime execution",
                    phase: "deploying",
                    step: "storage_materialization",
                    stage: "container_lifecycle",
                    correlationId: observability?.correlationId ?? deploymentId,
                    traceId: observability?.traceId,
                    spanId: observability?.spanId,
                    metadata: {
                        storageType: storageBinding.storageType,
                        mountPath: storageBinding.mountPath,
                        autoRedeployOnUpdate: storageBinding.autoRedeployOnUpdate,
                        updateStrategy: storageBinding.updateStrategy,
                        structured: true,
                    },
                });
            }

            const runtimeRunnerKind = this.resolveRuntimeRunnerKind(result);
            await this.deploymentRepository.insertLog(deploymentId, {
                level: "info",
                message: "Runtime runner execution started",
                phase: "deploying",
                step: "runtime_execute",
                stage: "runner",
                correlationId: observability?.correlationId ?? deploymentId,
                traceId: observability?.traceId,
                spanId: observability?.spanId,
                metadata: {
                    runner: runtimeRunnerKind,
                    structured: true,
                },
            });

            const runtimeExecutionInput = {
                deployment: {
                    deploymentId,
                    serviceId: deployment.serviceId,
                    projectId,
                    deploymentContainerName:
                        runtimeRunnerOptions?.containerName ??
                        deployment.containerName,
                    deploymentContainerImage: deployment.containerImage,
                    healthCheckUrl:
                        runtimeRunnerOptions?.healthCheckUrl ??
                        deployment.healthCheckUrl,
                    networkMode:
                        runtimeRunnerOptions?.networkMode ??
                        this.getResultString(result, "networkMode") ??
                        undefined,
                    cpuShares:
                        runtimeRunnerOptions?.cpuShares ??
                        this.getResultNumber(result, "cpuShares") ??
                        undefined,
                    memoryLimitBytes:
                        runtimeRunnerOptions?.memoryLimitBytes ??
                        this.getResultNumber(result, "memoryLimitBytes") ??
                        undefined,
                },
                artifact,
                healthGateConfig: this.resolveHealthGateConfig(result, runtimeRunnerOptions),
                convergenceConfig: convergenceResolution.config,
                runtimeRunnerOptions: runtimeRunnerOptions ?? undefined,
                executorOptions: this.resolveExecutorOptions(
                    runtimeRunnerOptions,
                    customRunCommand,
                    runtimeEnvironmentVariables,
                ),
                storageBinding,
                observability,
            };

            // A1: derive the service's reachable URLs from its domain mappings
            // and upsert the Traefik routes BEFORE runtime execution, so the
            // runner finds a real config instead of bootstrapping `localhost`.
            // Pure data-driven (domain mappings) — never env vars.
            let routeSync: RouteSyncResult | null = null;
            try {
                routeSync = await this.domainRoutingService.syncServiceRoutes(deployment.serviceId, {
                    healthCheckPath: "/health",
                });
            } catch (error) {
                // Non-fatal: deployment continues; the runner will fall back to
                // its default (localhost) routing when no mappings resolve.
                await this.deploymentRepository.insertLog(deploymentId, {
                    level: "warn",
                    message: `Domain route sync skipped for service ${deployment.serviceId}: ${error instanceof Error ? error.message : String(error)}`,
                    phase: "deploying",
                    step: "domain_route_sync",
                    stage: "routing",
                    correlationId: observability?.correlationId ?? deploymentId,
                    traceId: observability?.traceId,
                    spanId: observability?.spanId,
                    metadata: { structured: true },
                });
            }

            // A5: provision TLS certificate for the primary mapped domain
            // (idempotent, data-driven from the mapping's ssl fields).
            let tlsProvision: Awaited<ReturnType<typeof this.domainRoutingService.provisionTlsCertificate>>;
            try {
                tlsProvision = await this.domainRoutingService.provisionTlsCertificate(deployment.serviceId);
                if (tlsProvision.provisioned && tlsProvision.reason !== "already_provisioned") {
                    await this.deploymentRepository.insertLog(deploymentId, {
                        level: "info",
                        message: "TLS certificate provisioned for primary domain",
                        phase: "deploying",
                        step: "tls_provision",
                        stage: "routing",
                        correlationId: observability?.correlationId ?? deploymentId,
                        traceId: observability?.traceId,
                        spanId: observability?.spanId,
                        metadata: { host: tlsProvision.host, structured: true },
                    });
                }
            } catch (error) {
                await this.deploymentRepository.insertLog(deploymentId, {
                    level: "warn",
                    message: `TLS provisioning skipped for service ${deployment.serviceId}: ${error instanceof Error ? error.message : String(error)}`,
                    phase: "deploying",
                    step: "tls_provision",
                    stage: "routing",
                    correlationId: observability?.correlationId ?? deploymentId,
                    traceId: observability?.traceId,
                    spanId: observability?.spanId,
                    metadata: { structured: true },
                });
            }

            const runtimeResult = await this.executeRuntimeWithDeployRetryPolicy(
                deploymentId,
                runtimeRunnerKind,
                runtimeExecutionInput,
                deployRetryPolicy,
                observability,
            );

            const deployCompletedAt = new Date();
            const deployDuration = Math.max(0, deployCompletedAt.getTime() - deployStartedAt.getTime());
            // A2: primary URL comes from the domain mappings (the single source
            // of truth for how this service is reachable).
            const domainUrl = routeSync?.success ? (routeSync.primaryUrl ?? null) : null;

            // A3: snapshot ALL reachable URLs for this deployment (previous
            // deployments keep their own snapshot — "current vs previous" URLs).
            const reachableUrls = routeSync?.success ? routeSync.urls.map((u) => u.fullUrl) : (domainUrl ? [domainUrl] : []);

            const metadata = this.mergeMetadata(deployment.metadata, {
                reachableUrls,
                ...(domainUrl ? { deployedDomainUrl: domainUrl } : {}),
                containerLifecycle: {
                    status: "started",
                    containerId: runtimeResult.containerId,
                    containerName: runtimeResult.containerName,
                    containerImage: runtimeResult.containerImage,
                    startedAt: new Date().toISOString(),
                },
                // SW-024: swarm service identity as the inventory root — maps
                // deploymentId ↔ serviceId ↔ serviceName ↔ tasks so the
                // reconciliation and ops surfaces resolve `docker service ps`
                // rows back to the deployment without a separate table.
                ...(runtimeResult.serviceId || (runtimeResult.taskIds?.length ?? 0) > 0
                    ? {
                          swarmIdentity: {
                              serviceId: runtimeResult.serviceId ?? null,
                              serviceName: runtimeResult.serviceName ?? runtimeResult.containerName,
                              taskIds: runtimeResult.taskIds ?? [],
                              inventorySource: "deployment_execution",
                          },
                      }
                    : {}),
                ...(runtimeResult.managedRuntime?.managedBy === "deployment_service"
                    ? {
                          managedRuntimeResources: {
                              ownership: {
                                  managedBy: runtimeResult.managedRuntime.managedBy,
                                  managedReason: runtimeResult.managedRuntime.managedReason,
                                  deploymentId: runtimeResult.managedRuntime.deploymentId,
                                  serviceId: runtimeResult.managedRuntime.serviceId,
                                  projectId: runtimeResult.managedRuntime.projectId,
                              },
                              container: {
                                  id: runtimeResult.containerId,
                                  name: runtimeResult.containerName,
                                  labels: runtimeResult.managedRuntime.labels,
                              },
                              image: {
                                  reference: runtimeResult.managedRuntime.imageRef,
                              },
                              network: {
                                  mode: runtimeResult.managedRuntime.networkMode,
                              },
                              persistedAt: new Date().toISOString(),
                          },
                      }
                    : {}),
                routeVerification: runtimeResult.routeVerification,
                healthGate: runtimeResult.healthGate,
                convergencePolicy: {
                    ...convergenceResolution.config,
                    source: convergenceResolution.source,
                },
                deployDuration,
                ...(storageBinding
                    ? {
                          storageBinding: {
                              storageType: storageBinding.storageType,
                              mountPath: storageBinding.mountPath,
                              updateStrategy: storageBinding.updateStrategy,
                              autoRedeployOnUpdate: storageBinding.autoRedeployOnUpdate,
                          },
                      }
                    : {}),
                stage: "active",
            });

            await this.deploymentRepository.persistBuildArtifacts(deploymentId, {
                deployStartedAt,
                deployCompletedAt,
                containerName: runtimeResult.containerName,
                containerImage: runtimeResult.containerImage,
                domainUrl,
                healthCheckUrl: runtimeResult.healthGate.healthCheckUrl,
                status: "success",
                phase: "active",
                phaseProgress: 100,
                metadata,
            });

            await this.deploymentRepository.insertLog(deploymentId, {
                level: "info",
                message: "Container lifecycle create/start completed",
                phase: "deploying",
                step: "start",
                stage: "container_lifecycle",
                correlationId: observability?.correlationId ?? deploymentId,
                traceId: observability?.traceId,
                spanId: observability?.spanId,
                metadata: {
                    containerId: runtimeResult.containerId,
                    containerName: runtimeResult.containerName,
                    containerImage: runtimeResult.containerImage,
                    deployStartedAt: deployStartedAt.toISOString(),
                    deployCompletedAt: deployCompletedAt.toISOString(),
                    durationMs: deployDuration,
                    convergencePolicy: {
                        ...convergenceResolution.config,
                        source: convergenceResolution.source,
                    },
                    structured: true,
                },
            });

            await this.deploymentRepository.insertLog(deploymentId, {
                level: "info",
                message: "Runtime runner execution completed",
                phase: "deploying",
                step: "runtime_completed",
                stage: "runner",
                correlationId: observability?.correlationId ?? deploymentId,
                traceId: observability?.traceId,
                spanId: observability?.spanId,
                metadata: {
                    runner: runtimeRunnerKind,
                    containerId: runtimeResult.containerId,
                    structured: true,
                },
            });

            await this.deploymentRepository.insertLog(deploymentId, {
                level: "info",
                message: "Traefik route apply and verification completed",
                phase: "deploying",
                step: "route_verification",
                stage: "routing",
                correlationId: observability?.correlationId ?? deploymentId,
                traceId: observability?.traceId,
                spanId: observability?.spanId,
                metadata: runtimeResult.routeVerification,
            });
            await this.deploymentRepository.insertLog(deploymentId, {
                level: "info",
                message: "Readiness health gate passed",
                phase: "health_check",
                step: "readiness_gate",
                stage: "health",
                correlationId: observability?.correlationId ?? deploymentId,
                traceId: observability?.traceId,
                spanId: observability?.spanId,
                metadata: runtimeResult.healthGate,
            });
            // A4: non-blocking external probe of the deployed domain(s) — the
            // internal health gate proves the container is up; this proves the
            // public URL is actually reachable from the internet. Best-effort.
            if (domainUrl) {
                void this.probeDeployedDomain(deploymentId, domainUrl, observability?.correlationId ?? deploymentId);
            }
            await this.deploymentRepository.insertLog(deploymentId, {
                level: "info",
                message: "Deployment timeline persisted",
                phase: "active",
                step: "timeline",
                stage: "timeline",
                correlationId: observability?.correlationId ?? deploymentId,
                traceId: observability?.traceId,
                spanId: observability?.spanId,
                metadata: {
                    deployStartedAt: deployStartedAt.toISOString(),
                    deployCompletedAt: deployCompletedAt.toISOString(),
                    deployDuration,
                    convergencePolicy: {
                        ...convergenceResolution.config,
                        source: convergenceResolution.source,
                    },
                    structured: true,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const metadata = this.mergeMetadata(deployment.metadata, {
                containerLifecycle: {
                    status: "failed",
                    error: message,
                    failedAt: new Date().toISOString(),
                },
            });

            await this.deploymentRepository.updateStatus(deploymentId, "failed", metadata);
            await this.deploymentRepository.insertLog(deploymentId, {
                level: "error",
                message: "Container lifecycle failed",
                phase: "failed",
                step: "container_lifecycle",
                stage: "container_lifecycle",
                metadata: {
                    error: message,
                },
            });

            throw new BadRequestException(`Container lifecycle failed: ${message}`);
        }
    }

    private async executeRuntimeWithDeployRetryPolicy(
        deploymentId: string,
        runtimeRunnerKind: string,
        runtimeExecutionInput: Parameters<RuntimeRunnerRegistryService["execute"]>[1],
        policy: DeployPhaseRetryPolicy,
        observability?: DeploymentObservabilityContext | null,
    ) {
        let lastError: unknown;

        for (let attempt = 1; attempt <= policy.maxRetries; attempt += 1) {
            try {
                return await this.runtimeRunnerRegistryService.execute(
                    runtimeRunnerKind,
                    runtimeExecutionInput,
                );
            } catch (error) {
                lastError = error;

                if (attempt >= policy.maxRetries) {
                    break;
                }

                const errorMessage = error instanceof Error ? error.message : String(error);
                await this.deploymentRepository.insertLog(deploymentId, {
                    level: "warn",
                    message: "Deploy phase runtime execution attempt failed; retry scheduled",
                    phase: "deploying",
                    step: "deploy_retry",
                    stage: "container_lifecycle",
                    correlationId: observability?.correlationId ?? deploymentId,
                    traceId: observability?.traceId,
                    spanId: observability?.spanId,
                    metadata: {
                        attempt,
                        maxRetries: policy.maxRetries,
                        retryIntervalMs: policy.retryIntervalMs,
                        error: errorMessage,
                        structured: true,
                    },
                });

                await this.sleep(policy.retryIntervalMs);
            }
        }

        throw lastError instanceof Error
            ? lastError
            : new Error("Deploy phase failed after retry policy exhausted");
    }

    private resolveHealthGateConfig(
        result: Record<string, unknown> | undefined,
        runtimeRunnerOptions?: RuntimeRunnerExecutionOptions | null,
    ): HealthGateConfig {
        const maxRetries =
            runtimeRunnerOptions?.healthCheckMaxRetries ??
            this.getResultNumber(result, "healthCheckMaxRetries");
        const retryIntervalMs =
            runtimeRunnerOptions?.healthCheckRetryIntervalMs ??
            this.getResultNumber(result, "healthCheckRetryIntervalMs");

        return {
            maxRetries:
                typeof maxRetries === "number" && Number.isInteger(maxRetries) && maxRetries > 0
                    ? maxRetries
                    : 10,
            retryIntervalMs:
                typeof retryIntervalMs === "number" && Number.isInteger(retryIntervalMs) && retryIntervalMs > 0
                    ? retryIntervalMs
                    : 2_000,
        };
    }

    private resolveDeployPhaseRetryPolicy(
        result: Record<string, unknown> | undefined,
    ): DeployPhaseRetryPolicy {
        const maxRetries = this.getResultNumber(result, "deployHealthCheckMaxRetries");
        const retryIntervalMs = this.getResultNumber(result, "deployHealthCheckRetryIntervalMs");

        return {
            maxRetries:
                typeof maxRetries === "number" && Number.isInteger(maxRetries) && maxRetries > 0
                    ? maxRetries
                    : 1,
            retryIntervalMs:
                typeof retryIntervalMs === "number" && Number.isInteger(retryIntervalMs) && retryIntervalMs > 0
                    ? retryIntervalMs
                    : 250,
        };
    }

    private resolveRuntimeRunnerKind(result: Record<string, unknown> | undefined): string {
        const runtimeRunner = this.getResultString(result, "runtimeRunner");
        const buildRunner = this.getResultString(result, "buildRunner");
        return runtimeRunner ?? buildRunner ?? "docker";
    }

    private resolveStorageBinding(
        result: Record<string, unknown> | undefined,
    ): DeploymentStorageBinding | null {
        const parsedStorageBinding = deploymentStorageBindingSchema.safeParse(
            result?.storageBinding,
        );
        return parsedStorageBinding.success ? parsedStorageBinding.data : null;
    }

    private resolveRuntimeRunnerOptions(
        result: Record<string, unknown> | undefined,
    ): RuntimeRunnerExecutionOptions | null {
        const parsedRuntimeRunnerOptions = runtimeRunnerOptionsSchema.safeParse(
            result?.runtimeRunnerOptions,
        );
        return parsedRuntimeRunnerOptions.success ? parsedRuntimeRunnerOptions.data : null;
    }

    private resolveRuntimeConvergenceConfig(
        runtimeRunnerOptions?: RuntimeRunnerExecutionOptions | null,
    ): RuntimeConvergenceConfigResolution {
        const optionTraefik = runtimeRunnerOptions?.traefikSyncMaxAttempts;
        const optionDelay = runtimeRunnerOptions?.convergenceRetryBaseDelayMs;

        const traefikSyncMaxAttempts = this.normalizePositiveInteger(optionTraefik)
            ?? 3;
        const retryBaseDelayMs = this.normalizePositiveInteger(optionDelay)
            ?? 250;

        return {
            config: {
                traefikSyncMaxAttempts,
                retryBaseDelayMs,
            },
            source: {
                traefikSyncMaxAttempts: this.resolveConvergenceSource(optionTraefik),
                retryBaseDelayMs: this.resolveConvergenceSource(optionDelay),
            },
        };
    }

    private resolveExecutorOptions(
        runtimeRunnerOptions: RuntimeRunnerExecutionOptions | null,
        customRunCommand: string | null,
        runtimeEnvironmentVariables: Record<string, string> | null,
    ) {
        const startupCommand = customRunCommand ?? runtimeRunnerOptions?.startupCommand;
        const hasEnvironmentVariables =
            runtimeEnvironmentVariables !== null && Object.keys(runtimeEnvironmentVariables).length > 0;

        if (!startupCommand && !hasEnvironmentVariables) {
            return undefined;
        }

        return {
            ...(startupCommand ? { startupCommand } : {}),
            ...(hasEnvironmentVariables
                ? {
                      environmentVariables: runtimeEnvironmentVariables,
                  }
                : {}),
        };
    }

    private resolveRuntimeEnvironmentVariables(
        result: Record<string, unknown> | undefined,
    ): Record<string, string> | null {
        const raw = result?.runtimeEnvironmentVariables;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return null;
        }

        const sanitized = Object.entries(isRecord(raw) ? raw : {}).reduce<Record<string, string>>(
            (accumulator, [key, value]) => {
                const normalizedKey = key.trim();
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalizedKey)) {
                    return accumulator;
                }

                if (typeof value !== "string" || value.includes('\0')) {
                    return accumulator;
                }

                accumulator[normalizedKey] = value;
                return accumulator;
            },
            {},
        );

        return Object.keys(sanitized).length > 0 ? sanitized : null;
    }

    private resolveConvergenceSource(
        runtimeOption: number | undefined,
    ): RuntimeConvergenceSource {
        if (this.normalizePositiveInteger(runtimeOption) !== null) {
            return "runtimeRunnerOptions";
        }
        return "default";
    }

    private normalizePositiveInteger(value: number | null | undefined): number | null {
        if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
            return null;
        }
        return value;
    }

    private extractArtifactResult(result: Record<string, unknown> | undefined): BuildArtifactResult {
        const containerImage = this.getResultString(result, "containerImage");
        const containerName = this.getResultString(result, "containerName");
        const artifactDigest = this.getResultString(result, "artifactDigest");
        const buildLogsUrl = this.getResultString(result, "buildLogsUrl");
        const artifactSizeBytes = this.getResultNumber(result, "artifactSizeBytes");

        return {
            containerImage,
            containerName,
            artifactDigest,
            artifactSizeBytes,
            buildLogsUrl,
        };
    }

    private getResultString(result: Record<string, unknown> | undefined, key: string): string | null {
        const value = result?.[key];
        return typeof value === "string" && value.trim().length > 0 ? value : null;
    }

    private getResultNumber(result: Record<string, unknown> | undefined, key: string): number | null {
        const value = result?.[key];
        return typeof value === "number" && Number.isFinite(value) ? value : null;
    }

    private getResultDate(result: Record<string, unknown> | undefined, key: string): Date | undefined {
        const raw = this.getResultString(result, key);
        if (!raw) {
            return undefined;
        }

        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }

    private sleep(delayMs: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, delayMs);
        });
    }

    /**
     * A4: best-effort external probe of a deployed domain. Records the result
     * into the deployment metadata (`externalReachability`) and a log line.
     * Never blocks the deployment.
     */
    private async probeDeployedDomain(deploymentId: string, url: string, correlationId: string): Promise<void> {
        try {
            const probeUrl = `${url.replace(/\/$/, "")}/health`;
            const start = Date.now();
            const resp = await fetch(probeUrl, { signal: AbortSignal.timeout(10_000) });
            const latencyMs = Date.now() - start;
            const result = {
                url,
                statusCode: resp.status,
                reachable: resp.ok,
                latencyMs,
                probedAt: new Date().toISOString(),
            };

            // Merge (the repository overwrites metadata — preserve existing).
            const current = await this.getDeploymentById(deploymentId);
            await this.deploymentRepository.persistBuildArtifacts(deploymentId, {
                metadata: this.mergeMetadata(current.metadata, { externalReachability: result }),
            });
            await this.deploymentRepository.insertLog(deploymentId, {
                level: resp.ok ? "info" : "warn",
                message: resp.ok ? "Deployed domain is externally reachable" : `Deployed domain returned HTTP ${String(resp.status)}`,
                phase: "active",
                step: "external_probe",
                stage: "health",
                correlationId,
                metadata: { url, statusCode: resp.status, latencyMs, structured: true },
            });
        } catch (error) {
            await this.deploymentRepository.insertLog(deploymentId, {
                level: "warn",
                message: `External domain probe failed for ${url}: ${error instanceof Error ? error.message : String(error)}`,
                phase: "active",
                step: "external_probe",
                stage: "health",
                correlationId,
                metadata: { url, structured: true },
            });
        }
    }

    private mergeMetadata(
        current: Record<string, unknown> | null,
        patch: Record<string, unknown>,
    ): Record<string, unknown> {
        return {
            ...(current ?? {}),
            ...patch,
        };
    }

    private async getDeploymentById(deploymentId: string) {
        const deployment = await this.deploymentRepository.findById(deploymentId);
        if (!deployment) {
            throw new NotFoundException(`Deployment with id '${deploymentId}' not found`);
        }
        return deployment;
    }
}
