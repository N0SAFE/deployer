import { Context, Effect } from 'effect'

import { DockerEngine, type DockerEngineShape } from '@deployer/docker'
import { ConfigNotFoundError } from '@deployer/shared/core/modules/traefik/errors/index'
import { TraefikService } from '@deployer/shared/core/modules/traefik/services/traefik.service'

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
 * Runs a deployment as a plain container: replaces the deployment's previous containers, starts
 * the new one, applies and verifies its Traefik route, then holds it to the readiness gate. A
 * container created by a run that then fails is removed, including when the run is interrupted.
 *
 * The other image-based runners (dockerfile, compose, nixpacks, buildpack, railpack) are this
 * runner behind their own input preparation.
 */
export class DockerRuntimeRunner extends Context.Service<
    DockerRuntimeRunner,
    DeploymentRuntimeRunner<DockerEngine | TraefikService>
>()('runtime/DockerRuntimeRunner') {
    /** The engine and traefik are yielded when a run starts, so this is a constant a module provides with `useValue`. */
    static readonly live = class DockerRuntimeRunnerImpl {
        runnerType = RUNNER_TYPE
        executeRuntime = (input) =>
            Effect.gen(function* () {
                const docker = yield* DockerEngine
                const traefik = yield* TraefikService
                return yield* buildDockerRuntimeRunner({
                    docker,
                    traefik,
                }).executeRuntime(input)
            })
    }
}

function buildDockerRuntimeRunner(ports: {
    readonly docker: DockerEngineShape
    readonly traefik: Context.Service.Shape<typeof TraefikService>
}): DeploymentRuntimeRunner {
    const { docker, traefik } = ports

    const bootstrapDefaultTraefikConfiguration = (serviceId: string) =>
        traefik
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
                    (error) => new RuntimeInvalid({ reason: error.message })
                )
            )

    const syncRoute = (serviceId: string) =>
        Effect.gen(function* () {
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

    const applyRouteAndVerify = Effect.fn(
        'DockerRuntimeRunner.applyRouteAndVerify'
    )(function* (
        serviceId: string,
        maxAttempts: number,
        retryBaseDelayMs: number
    ) {
        let lastErrorMessage: string | null = null
        let attemptedAutoBootstrap = false

        for (
            let attemptNumber = 1;
            attemptNumber <= maxAttempts;
            attemptNumber += 1
        ) {
            if (attemptNumber > 1) {
                yield* Effect.sleep(retryBaseDelayMs * (attemptNumber - 1))
            }

            const outcome = yield* syncRoute(serviceId).pipe(
                Effect.map((value) => ({ ok: true as const, value })),
                Effect.catch((error) =>
                    Effect.succeed({ ok: false as const, error })
                )
            )
            if (outcome.ok) {
                const { syncResult, healthSummary } = outcome.value
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
                    attempts: attemptNumber,
                    verifiedAt: new Date().toISOString(),
                }
            }

            if (
                !attemptedAutoBootstrap &&
                outcome.error instanceof ConfigNotFoundError
            ) {
                yield* bootstrapDefaultTraefikConfiguration(serviceId)
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

    const enforceReadinessHealthGate = Effect.fn(
        'DockerRuntimeRunner.enforceReadinessHealthGate'
    )(function* (
        containerId: string,
        healthCheckUrl: string | null,
        config: { maxRetries: number; retryIntervalMs: number }
    ) {
        const isHealthy = yield* docker.containers.waitForHealth(containerId, {
            maxRetries: config.maxRetries,
            retryIntervalMs: config.retryIntervalMs,
            ...(healthCheckUrl === null ? {} : { healthCheckUrl }),
        })
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

    const executeRuntime = Effect.fn('DockerRuntimeRunner.executeRuntime')(
        function* (input: RuntimeExecutionInput) {
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
                    sanitizeStartupCommand(executorOptions?.startupCommand),
                catch: (cause) => cause,
            })
            const sanitizedEnvironmentVariables = sanitizeEnvironmentVariables(
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
                    resolveContainerImage(artifact, deployment, RUNNER_TYPE),
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

            return yield* Effect.gen(function* () {
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

                const routeVerification = yield* applyRouteAndVerify(
                    deployment.serviceId,
                    resolvedConvergenceConfig.traefikSyncMaxAttempts,
                    resolvedConvergenceConfig.retryBaseDelayMs
                )
                const healthGate = yield* enforceReadinessHealthGate(
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
                Effect.onError(() => removeCreatedContainer.pipe(Effect.ignore))
            )
        }
    )

    return { runnerType: RUNNER_TYPE, executeRuntime }
}
