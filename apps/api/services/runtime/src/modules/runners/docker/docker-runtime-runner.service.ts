import { Context, Effect } from 'effect'

import { DockerEngine } from '@deployer/docker'
import { ConfigNotFoundError } from '@deployer/shared/core/modules/traefik/errors/index'
import {
    TraefikService,
    type TraefikServiceShape,
} from '@deployer/shared/core/modules/traefik/services/traefik.service'

import type { RequirementsOf } from '@deployer/effect-core'

import { RuntimeInvalid } from '../../../core/runtime.errors'
import { resolveContainerImage } from '../base/container-image.guard'

import {
    buildFallbackSubdomain,
    materializeStorageBinding,
    resolveRuntimeConvergenceConfig,
    sanitizeEnvironmentVariables,
    sanitizeExecutorLabels,
    sanitizeStartupCommand,
} from './docker-runner.helpers'

import type {
    DeploymentRuntimeRunner,
    RuntimeExecutionInput,
} from '../runtime-runner.interface'

const RUNNER_TYPE = 'docker' as const

/**
 * What this runner reads from the Effect context while a run is in flight: the engine it talks to,
 * the Traefik surface it converges the route through, and — because those Traefik methods reach
 * further — the repository behind them. Written as the tag plus its own open requirements, so it
 * cannot drift from the methods it calls.
 */
export type DockerRuntimeRunnerRequirements =
    | DockerEngine
    | TraefikService
    | RequirementsOf<TraefikServiceShape>

/**
 * Runs a deployment as a plain container: replaces the deployment's previous containers, starts
 * the new one, applies and verifies its Traefik route, then holds it to the readiness gate. A
 * container created by a run that then fails is removed, including when the run is interrupted.
 *
 * The other image-based runners (dockerfile, compose, nixpacks, buildpack, railpack) are this
 * runner behind their own input preparation.
 *
 * Every step below IS the logic: a collaborator is yielded where it is used, and the pieces shared by
 * more than one step are `private` methods that name the tags they yield. There is no `ports` record
 * and no `buildDockerRuntimeRunner(ports)` factory (`docs/architecture/service-implementation-rule.md`).
 */
export class DockerRuntimeRunner extends Context.Service<
    DockerRuntimeRunner,
    DeploymentRuntimeRunner<DockerRuntimeRunnerRequirements>
>()('runtime/DockerRuntimeRunner') {
    static readonly live = class DockerRuntimeRunnerImpl
        implements DeploymentRuntimeRunner<DockerRuntimeRunnerRequirements>
    {
        readonly runnerType = RUNNER_TYPE

        /** Traefik's config for this service, created on first use so a retry has something to sync. */
        private bootstrapDefaultTraefikConfiguration(
            serviceId: string
        ): Effect.Effect<void, RuntimeInvalid, DockerRuntimeRunnerRequirements> {
            return Effect.gen(function* () {
                const traefik = yield* TraefikService
                yield* traefik
                    .createServiceConfiguration(serviceId, {
                        domain: 'localhost',
                        subdomain: buildFallbackSubdomain(serviceId),
                        port: 80,
                        sslEnabled: false,
                        pathPrefix: '/',
                        isActive: true,
                    })
                    .pipe(
                        Effect.mapError(
                            (error) =>
                                new RuntimeInvalid({ reason: error.message })
                        )
                    )
            })
        }

        /**
         * One sync attempt plus the health snapshot the verification reports. The return type is left
         * to inference: `SyncResult` is a discriminated union of a success and an error form, and both
         * carry different fields the caller narrows through `success`.
         */
        private syncRoute(serviceId: string) {
            return Effect.gen(function* () {
                const traefik = yield* TraefikService
                const syncResult =
                    yield* traefik.syncServiceConfiguration(serviceId)
                if (!syncResult.success) {
                    return yield* Effect.fail(
                        new RuntimeInvalid({ reason: syncResult.message })
                    )
                }
                const healthSummary = yield* traefik.getHealthStatus()
                return { syncResult, healthSummary }
            })
        }

        /**
         * Applies and verifies the route, retrying with a growing delay. A missing configuration is
         * bootstrapped once and the attempt repeated; anything else consumes the attempt budget.
         */
        private applyRouteAndVerify(
            serviceId: string,
            maxAttempts: number,
            retryBaseDelayMs: number
        ): Effect.Effect<
            {
                applied: true
                syncResult: {
                    configId: string
                    configName: string
                    action: string
                    message: string
                    syncedAt: string | null
                }
                healthSummary: unknown
                attempts: number
                verifiedAt: string
            },
            RuntimeInvalid,
            DockerRuntimeRunnerRequirements
        > {
            return Effect.gen({ self: this }, function* () {
                let lastErrorMessage: string | null = null
                let attemptedAutoBootstrap = false

                for (
                    let attemptNumber = 1;
                    attemptNumber <= maxAttempts;
                    attemptNumber += 1
                ) {
                    if (attemptNumber > 1) {
                        yield* Effect.sleep(
                            retryBaseDelayMs * (attemptNumber - 1)
                        )
                    }

                    const outcome = yield* this.syncRoute(serviceId).pipe(
                        Effect.map((value) => ({ ok: true as const, value })),
                        Effect.catch((error) =>
                            Effect.succeed({ ok: false as const, error })
                        )
                    )
                    if (outcome.ok) {
                        const { syncResult, healthSummary } = outcome.value
                        const verifiedAt = new Date().toISOString()
                        return {
                            applied: true as const,
                            syncResult: {
                                configId: syncResult.configId,
                                configName: syncResult.configName,
                                action: syncResult.action,
                                message: syncResult.message,
                                // `SyncResult` carries no timestamp of its own; the file was written in
                                // this attempt, so the attempt's clock is the sync time.
                                syncedAt: verifiedAt,
                            },
                            healthSummary,
                            attempts: attemptNumber,
                            verifiedAt,
                        }
                    }

                    if (
                        !attemptedAutoBootstrap &&
                        outcome.error instanceof ConfigNotFoundError
                    ) {
                        yield* this.bootstrapDefaultTraefikConfiguration(
                            serviceId
                        )
                        attemptedAutoBootstrap = true
                        continue
                    }
                    lastErrorMessage =
                        outcome.error instanceof Error
                            ? outcome.error.message
                            : String(outcome.error)
                }

                return yield* Effect.fail(
                    new RuntimeInvalid({
                        reason: `Traefik route apply/verification failed after ${String(maxAttempts)} attempts: ${lastErrorMessage ?? 'unknown error'}`,
                    })
                )
            })
        }

        /** Holds the container to its readiness probe; a container that never answers fails the run. */
        private enforceReadinessHealthGate(
            containerId: string,
            healthCheckUrl: string | null,
            config: { maxRetries: number; retryIntervalMs: number }
        ): Effect.Effect<
            {
                passed: true
                containerId: string
                healthCheckUrl: string | null
                maxRetries: number
                retryIntervalMs: number
                verifiedAt: string
            },
            RuntimeInvalid,
            DockerRuntimeRunnerRequirements
        > {
            return Effect.gen(function* () {
                const docker = yield* DockerEngine
                const isHealthy = yield* docker.containers.waitForHealth(
                    containerId,
                    {
                        maxRetries: config.maxRetries,
                        retryIntervalMs: config.retryIntervalMs,
                        ...(healthCheckUrl === null ? {} : { healthCheckUrl }),
                    }
                )
                if (!isHealthy) {
                    return yield* Effect.fail(
                        new RuntimeInvalid({
                            reason: `Readiness health gate failed for container '${containerId}' after ${String(config.maxRetries)} retries`,
                        })
                    )
                }
                return {
                    passed: true as const,
                    containerId,
                    healthCheckUrl,
                    maxRetries: config.maxRetries,
                    retryIntervalMs: config.retryIntervalMs,
                    verifiedAt: new Date().toISOString(),
                }
            })
        }

        executeRuntime(
            input: RuntimeExecutionInput
        ): ReturnType<
            DeploymentRuntimeRunner<DockerRuntimeRunnerRequirements>['executeRuntime']
        > {
            return Effect.gen({ self: this }, function* () {
                const docker = yield* DockerEngine
                const {
                    deployment,
                    artifact,
                    healthGateConfig,
                    storageBinding,
                    executorOptions,
                    convergenceConfig,
                } = input
                const sanitizedExecutorLabels = yield* Effect.try({
                    try: () => sanitizeExecutorLabels(executorOptions?.labels),
                    catch: (cause) => cause,
                })
                const sanitizedStartupCommand = yield* Effect.try({
                    try: () =>
                        sanitizeStartupCommand(
                            executorOptions?.startupCommand
                        ),
                    catch: (cause) => cause,
                })
                const sanitizedEnvironmentVariables =
                    sanitizeEnvironmentVariables(
                        executorOptions?.environmentVariables
                    )
                const resolvedConvergenceConfig =
                    resolveRuntimeConvergenceConfig(convergenceConfig)
                const fallbackName = `deployer-${deployment.serviceId.slice(0, 12)}-${deployment.deploymentId.slice(0, 8)}`
                const containerName =
                    artifact.containerName ??
                    deployment.deploymentContainerName ??
                    fallbackName
                const containerImage = yield* Effect.try({
                    try: () =>
                        resolveContainerImage(
                            artifact,
                            deployment,
                            RUNNER_TYPE
                        ),
                    catch: (cause) => cause,
                })
                const managedLabels = {
                    'deployer.managed': 'true',
                    'deployer.managed_by': 'deployment_service',
                    'deployer.managed_reason': 'deployment_execution',
                    'deployer.deployment_id': deployment.deploymentId,
                    'deployer.service_id': deployment.serviceId,
                    ...(deployment.projectId
                        ? { 'deployer.project_id': deployment.projectId }
                        : {}),
                    ...(deployment.networkMode
                        ? { 'deployer.network_mode': deployment.networkMode }
                        : {}),
                    'deployer.runtime_runner': RUNNER_TYPE,
                    'deployer.image_ref': containerImage,
                }
                const storageMaterialization = yield* Effect.try({
                    try: () => materializeStorageBinding(storageBinding),
                    catch: (cause) => cause,
                })
                const hostConfig = {
                    ...(deployment.networkMode
                        ? { NetworkMode: deployment.networkMode }
                        : {}),
                    ...(typeof deployment.cpuShares === 'number' &&
                    deployment.cpuShares > 0
                        ? {
                              NanoCpus: Math.trunc(
                                  deployment.cpuShares * 1_000_000_000
                              ),
                          }
                        : {}),
                    ...(typeof deployment.memoryLimitBytes === 'number' &&
                    deployment.memoryLimitBytes > 0
                        ? { Memory: Math.trunc(deployment.memoryLimitBytes) }
                        : {}),
                    ...(storageMaterialization.binds.length > 0
                        ? { Binds: storageMaterialization.binds }
                        : {}),
                    ...(storageMaterialization.mounts.length > 0
                        ? { Mounts: storageMaterialization.mounts }
                        : {}),
                }

                let createdContainerId: string | null = null
                const removeCreatedContainer = Effect.suspend(() => {
                    const containerId = createdContainerId
                    return containerId === null
                        ? Effect.void
                        : docker.containers.remove(containerId)
                })

                return yield* Effect.gen({ self: this }, function* () {
                    yield* docker.containers.stopByDeployment(
                        deployment.deploymentId
                    )
                    const staleContainers =
                        yield* docker.containers.listByDeployment(
                            deployment.deploymentId
                        )
                    for (const stale of staleContainers) {
                        yield* docker.containers.remove(stale.id)
                    }

                    const created = yield* docker.containers.create({
                        Image: containerImage,
                        name: containerName,
                        Labels: {
                            ...storageMaterialization.labels,
                            ...sanitizedExecutorLabels,
                            ...managedLabels,
                        },
                        ...(sanitizedStartupCommand
                            ? { Cmd: ['sh', '-lc', sanitizedStartupCommand] }
                            : {}),
                        ...(sanitizedEnvironmentVariables.length > 0
                            ? { Env: sanitizedEnvironmentVariables }
                            : {}),
                        ...(Object.keys(hostConfig).length > 0
                            ? { HostConfig: hostConfig }
                            : {}),
                    })
                    createdContainerId = created.id
                    yield* docker.containers.start(created.id)

                    const routeVerification = yield* this.applyRouteAndVerify(
                        deployment.serviceId,
                        resolvedConvergenceConfig.traefikSyncMaxAttempts,
                        resolvedConvergenceConfig.retryBaseDelayMs
                    )
                    const healthGate = yield* this.enforceReadinessHealthGate(
                        created.id,
                        deployment.healthCheckUrl,
                        healthGateConfig
                    )
                    return {
                        containerId: created.id,
                        containerName,
                        containerImage,
                        routeVerification,
                        healthGate,
                        managedRuntime: {
                            managedBy: 'deployment_service' as const,
                            managedReason: 'deployment_execution',
                            deploymentId: deployment.deploymentId,
                            serviceId: deployment.serviceId,
                            projectId: deployment.projectId ?? null,
                            imageRef: containerImage,
                            networkMode: deployment.networkMode ?? null,
                            labels: managedLabels,
                        },
                    }
                }).pipe(
                    Effect.onError(() =>
                        removeCreatedContainer.pipe(Effect.ignore)
                    )
                )
            })
        }
    }
}
