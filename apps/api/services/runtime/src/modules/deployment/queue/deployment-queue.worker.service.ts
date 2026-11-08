/**
 * DeploymentQueueWorker — the TYPED execution engine for the deployment queue (D-6).
 *
 * Replaces the Redis-backed Bull bridge. The queue is fully typed + in-process:
 *
 *   enqueueQueueJob() → DeploymentQueueLifecycle (Zod-typed store)
 *                     → jobQueued$ typed channel
 *                     → THIS worker (claims → executes → completes)
 *
 * The worker subscribes to the typed channel when it starts (`onStart`) and runs the full execution body:
 * claim by idempotency key, heartbeats, storage/execution-plan/runtime-runner hydration, container-image
 * build-with-retry-policy, then `completeQueueJob`/`failQueueJob` — all over the typed `DeploymentQueueJob`
 * Zod shape. No external queue IO.
 *
 * A job's failure is whatever its work refused with (the builder, the queue, a Promise collaborator), so
 * `processQueueJob` fails with `unknown`, as the original error.
 */

import { randomUUID } from 'crypto'

import { Cause, Context, Effect, Fiber, Semaphore } from 'effect'
import z from 'zod/v4'

import {
    runtimeRunnerOptionsSchema,
    type RuntimeRunnerOptions,
} from '@deployer/contracts-entities'
import { deploymentSourceCheckoutContextSchema } from '@deployer/contracts-entities'
import type { DeploymentQueueJob } from '@deployer/contracts-entities'
import type { AppError } from '@deployer/errors'
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
    ValidationError,
} from '@deployer/errors'
import type {
    EffectHostShape,
    ServiceLifecycleShape,
} from '@deployer/nest-effect'
import { beginHeavyWork } from '@deployer/shared/core/utils/heavy-work.registry'

import { RuntimeInvalid } from '../../../core/runtime.errors'
import { BuilderRegistry } from '../builders/builder-registry.service'
import {
    BuilderGitPort,
    BuilderStateMachinePort,
} from '../builders/builders.ports'
import {
    DeploymentArtifactBuilder,
    type DeploymentArtifactBuilderRequirements,
    type DeploymentArtifactBuilderShape,
} from '../builders/deployment-artifact-builder.service'
import {
    deploymentStorageBindingSchema,
    type DeploymentStorageBinding,
} from '../storage/base/storage-provider.interface'

import { makeJobRunner } from './worker/job-runner'

import type { QueueDeploymentsPort, QueueEnvPort } from '../deployment.ports'
import type { DeploymentQueueLifecycleShape } from './deployment-queue-lifecycle.service'
import type { Subscription } from 'rxjs'

type ClaimedJob = {
    readonly id: string
    readonly lockToken: string
    /** The delivered job this claim answers (ids can differ when the queue re-keys). */ readonly deliveredJobId: string
}

/** A claim lasts 60 s; a heartbeat every 15 s renews it, so a lost worker is reclaimed within a minute. */
const LEASE_SEC = 60
const HEARTBEAT_MS = 15_000

const executionPlanSchema = z.object({
    builder: z
        .enum([
            'dockerfile',
            'docker_compose',
            'nixpacks',
            'buildpack',
            'railpack',
            'external',
        ])
        .nullable()
        .optional(),
    runner: z
        .enum([
            'docker',
            'dockerfile',
            'docker_compose',
            'nixpacks',
            'buildpack',
            'railpack',
        ])
        .nullable()
        .optional(),
    runtimeRunnerOptions: runtimeRunnerOptionsSchema.nullable().optional(),
    customCommands: z
        .object({
            cli: z
                .object({
                    node: z.boolean().optional(),
                    bun: z.boolean().optional(),
                    npm: z.boolean().optional(),
                    pnpm: z.boolean().optional(),
                    yarn: z.boolean().optional(),
                })
                .optional(),
            buildCommand: z.string().min(1).optional(),
            runCommand: z.string().min(1).optional(),
        })
        .nullable()
        .optional(),
    healthChecks: z
        .object({
            build: z
                .object({
                    maxRetries: z.number().int().positive().optional(),
                    retryIntervalMs: z.number().int().positive().optional(),
                })
                .optional(),
            deploy: z
                .object({
                    maxRetries: z.number().int().positive().optional(),
                    retryIntervalMs: z.number().int().positive().optional(),
                })
                .optional(),
            runtime: z
                .object({
                    maxRetries: z.number().int().positive().optional(),
                    retryIntervalMs: z.number().int().positive().optional(),
                })
                .optional(),
        })
        .nullable()
        .optional(),
})

type DeploymentExecutionPlan = z.infer<typeof executionPlanSchema>

const runtimeConfigurationContextSchema = z.looseObject({
    environment: z.record(z.string(), z.string()).optional(),
    environmentDomains: z
        .object({
            network: z.record(z.string(), z.string()).optional(),
        })
        .optional(),
})

type PhaseRetryPolicy = {
    maxRetries: number
    retryIntervalMs: number
}

// Keep the queue result metadata honest: no Bull ids anymore — the worker
// tags its executions so the operator sees WHERE the job ran.
const QUEUE_SOURCE = 'typed-worker'

export type DeploymentQueueWorkerShape = ServiceLifecycleShape & {
    /**
     * Claim + execute ONE typed queue job. A deployment is the heaviest thing this service does (checkout, image
     * build, container rollout), so it is REPORTED while it runs: the image-scan concurrency planner collapses a
     * scan to serial when a deployment is in flight.
     */
    readonly processQueueJob: (
        job: DeploymentQueueJob
    ) => Effect.Effect<void, unknown, DeploymentArtifactBuilder>
    /** Cancels the job's fiber when this worker is executing it; false when it is not. */
    readonly cancelRunningJob: (jobId: string) => Effect.Effect<boolean>
}

export class DeploymentQueueWorker extends Context.Service<
    DeploymentQueueWorker,
    DeploymentQueueWorkerShape
>()('runtime/DeploymentQueueWorker') {}

export type DeploymentQueueWorkerPorts = {
    readonly deployments: Context.Service.Shape<typeof QueueDeploymentsPort>
    readonly lifecycle: Pick<
        DeploymentQueueLifecycleShape,
        'jobQueued$' | 'jobCancelled$'
    >
    /** The app-wide Effect context the jobs run in (it holds the artifact builder and what it reads). */
    readonly host: Pick<EffectHostShape, 'context'>
    readonly env?: Context.Service.Shape<typeof QueueEnvPort> | undefined
}

export function makeDeploymentQueueWorker(
    ports: DeploymentQueueWorkerPorts,
    options: { readonly heartbeatEveryMs?: number } = {}
): DeploymentQueueWorkerShape {
    const { deployments, lifecycle, host, env } = ports
    const workerId = `typed:${randomUUID()}`
    const failures = new Map<string, unknown>()
    /**
     * How many jobs execute at once. One by default (a deployment is the heaviest thing this service does);
     * raise it with `DEPLOYMENT_WORKER_CONCURRENCY` on a host that can take it.
     */
    const slots = Semaphore.makeUnsafe(
        env?.get('DEPLOYMENT_WORKER_CONCURRENCY') ?? 1
    )
    const running = new Set<Fiber.Fiber<unknown, unknown>>()
    let subscriptions: Subscription[] = []

    /** What this worker needs from the queue, as the Effect runner's ports. */
    const runner = makeJobRunner<
        DeploymentQueueJob,
        ClaimedJob,
        Record<string, unknown>,
        unknown
    >(
        {
            claim: (job) =>
                deployments
                    .claimQueueJobByIdempotencyKey(job.idempotencyKey, {
                        workerId,
                        limit: 1,
                        leaseDurationSec: LEASE_SEC,
                        types: [job.type],
                    })
                    .pipe(
                        Effect.flatMap((claimed) => {
                            if (!claimed) {
                                return Effect.as(
                                    Effect.logWarning(
                                        `No queued lifecycle job matched '${job.id}' (${job.idempotencyKey}); skipping duplicate or stale delivery.`
                                    ),
                                    null
                                )
                            }
                            if (!claimed.lockToken) {
                                return Effect.fail(
                                    new RuntimeInvalid({
                                        reason: `Claimed queue job '${claimed.id}' is missing a lock token`,
                                    })
                                )
                            }
                            return Effect.succeed({
                                id: claimed.id,
                                lockToken: claimed.lockToken,
                                deliveredJobId: job.id,
                            })
                        })
                    ),
            heartbeat: (claimed) =>
                deployments
                    .heartbeatQueueJob(claimed.id, {
                        workerId,
                        lockToken: claimed.lockToken,
                        extendLeaseSec: LEASE_SEC,
                    })
                    .pipe(
                        Effect.map((heartbeat) => heartbeat.acknowledged),
                        Effect.tap((acknowledged) =>
                            acknowledged
                                ? Effect.void
                                : Effect.logWarning(
                                      `Heartbeat was not acknowledged for lifecycle job '${claimed.id}'`
                                  )
                        )
                    ),
            complete: (claimed, result) =>
                deployments
                    .completeQueueJob(claimed.id, {
                        workerId,
                        lockToken: claimed.lockToken,
                        result,
                    })
                    .pipe(
                        Effect.as(true),
                        Effect.catch((error) =>
                            isLostLease(error)
                                ? Effect.succeed(false)
                                : Effect.fail(error)
                        )
                    ),
            fail: (claimed, error) =>
                Effect.suspend(() => {
                    // Kept so `processQueueJob` can fail with the original error, as callers expect.
                    failures.set(claimed.deliveredJobId, error)
                    return deployments.failQueueJob(claimed.id, {
                        workerId,
                        lockToken: claimed.lockToken,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        retryable: isTransientQueueFailure(error),
                    })
                }).pipe(
                    Effect.as(true),
                    Effect.catch((cause) =>
                        isLostLease(cause)
                            ? Effect.succeed(false)
                            : Effect.fail(cause)
                    )
                ),
        },
        {
            heartbeatEvery: options.heartbeatEveryMs ?? HEARTBEAT_MS,
            // The runner reports from inside its fibers; a log line is all a warning needs.
            warn: (message) => {
                Effect.runFork(Effect.logWarning(message))
            },
        }
    )

    /** Resolves the container image under the build retry policy, retrying with `retryIntervalMs` between attempts. */
    const resolveContainerImageWithPolicy = (
        builder: DeploymentArtifactBuilderShape,
        input: {
            deploymentId: string
            serviceId: string
            sourceCheckout: z.infer<
                typeof deploymentSourceCheckoutContextSchema
            > | null
            executionPlan: DeploymentExecutionPlan | null
            fallbackContainerImage: string | null
        },
        policy: PhaseRetryPolicy
    ): Effect.Effect<
        string | null,
        unknown,
        DeploymentArtifactBuilderRequirements
    > => {
        const build = Effect.suspend(() =>
            // The signal comes from the fiber: cancelling or losing the lease interrupts it and aborts the build.
            builder.buildContainerizedArtifact({
                deploymentId: input.deploymentId,
                serviceId: input.serviceId,
                builder: input.executionPlan?.builder ?? null,
                sourceCheckout: input.sourceCheckout,
                fallbackContainerImage: input.fallbackContainerImage,
                customCommands: input.executionPlan?.customCommands ?? null,
            })
        )
        const attemptBuild = (
            n: number
        ): Effect.Effect<
            string | null,
            unknown,
            DeploymentArtifactBuilderRequirements
        > =>
            build.pipe(
                Effect.catch((error: unknown) =>
                    n >= policy.maxRetries
                        ? Effect.fail(
                              error instanceof Error
                                  ? error
                                  : new Error(
                                        'Build phase failed after retry policy exhausted'
                                    )
                          )
                        : Effect.logWarning(
                              `Build phase attempt ${String(n)}/${String(policy.maxRetries)} failed for deployment '${input.deploymentId}', retrying in ${String(policy.retryIntervalMs)}ms`
                          ).pipe(
                              Effect.andThen(
                                  Effect.sleep(policy.retryIntervalMs)
                              ),
                              Effect.andThen(attemptBuild(n + 1))
                          )
                )
            )
        return attemptBuild(1)
    }

    /** The job's work: resolve the container image under the build retry policy and describe what was built. */
    const executeJob = (
        builder: DeploymentArtifactBuilderShape,
        job: DeploymentQueueJob
    ): Effect.Effect<
        Record<string, unknown>,
        unknown,
        DeploymentArtifactBuilderRequirements
    > =>
        Effect.gen(function* () {
            const deploymentId = job.payload.deploymentId ?? ''
            const storageBinding = extractStorageBindingFromPayload(job.payload)
            const executionPlan = extractExecutionPlanFromPayload(job.payload)
            const buildHealthPolicy = resolvePhaseRetryPolicy(
                executionPlan?.healthChecks?.build
            )
            const parsedSourceCheckout = extractSourceCheckoutFromPayload(
                job.payload
            )
            const runtimeRunner =
                (typeof executionPlan?.runner === 'string' &&
                executionPlan.runner.trim().length > 0
                    ? executionPlan.runner
                    : null) ?? extractRuntimeRunnerFromPayload(job.payload)
            const runtimeRunnerOptionsFromPayload =
                executionPlan?.runtimeRunnerOptions ??
                extractRuntimeRunnerOptionsFromPayload(job.payload)
            const runtimeRunnerOptionsFromRuntimeConfiguration =
                extractRuntimeRunnerOptionsFromRuntimeConfiguration(
                    job.payload,
                    runtimeRunner
                )
            const runtimeRunnerOptions = mergeRuntimeRunnerOptions(
                runtimeRunnerOptionsFromPayload,
                runtimeRunnerOptionsFromRuntimeConfiguration
            )
            const runtimeEnvironmentVariables =
                extractRuntimeEnvironmentVariablesFromRuntimeConfiguration(
                    job.payload
                )
            const buildStartedAt = new Date()
            const containerImage = yield* resolveContainerImageWithPolicy(
                builder,
                {
                    deploymentId,
                    serviceId: job.payload.serviceId ?? '',
                    sourceCheckout: parsedSourceCheckout,
                    executionPlan,
                    fallbackContainerImage: extractContainerImageFromPayload(
                        job.payload
                    ),
                },
                buildHealthPolicy
            )
            const containerName = extractContainerNameFromPayload(job.payload)
            const buildCompletedAt = new Date()

            return {
                queueSource: QUEUE_SOURCE,
                jobType: job.type,
                runtimeRunner: runtimeRunner ?? 'docker',
                ...(executionPlan?.builder
                    ? { buildRunner: executionPlan.builder }
                    : {}),
                ...(executionPlan?.customCommands?.runCommand
                    ? {
                          customRunCommand:
                              executionPlan.customCommands.runCommand,
                      }
                    : {}),
                buildStartedAt: buildStartedAt.toISOString(),
                buildCompletedAt: buildCompletedAt.toISOString(),
                ...(runtimeRunnerOptions ? { runtimeRunnerOptions } : {}),
                ...(runtimeEnvironmentVariables
                    ? { runtimeEnvironmentVariables }
                    : {}),
                ...(executionPlan?.healthChecks?.runtime?.maxRetries
                    ? {
                          healthCheckMaxRetries:
                              executionPlan.healthChecks.runtime.maxRetries,
                      }
                    : {}),
                ...(executionPlan?.healthChecks?.runtime?.retryIntervalMs
                    ? {
                          healthCheckRetryIntervalMs:
                              executionPlan.healthChecks.runtime
                                  .retryIntervalMs,
                      }
                    : {}),
                ...(executionPlan?.healthChecks?.build?.maxRetries
                    ? {
                          buildHealthCheckMaxRetries:
                              executionPlan.healthChecks.build.maxRetries,
                      }
                    : {}),
                ...(executionPlan?.healthChecks?.build?.retryIntervalMs
                    ? {
                          buildHealthCheckRetryIntervalMs:
                              executionPlan.healthChecks.build.retryIntervalMs,
                      }
                    : {}),
                ...(executionPlan?.healthChecks?.deploy?.maxRetries
                    ? {
                          deployHealthCheckMaxRetries:
                              executionPlan.healthChecks.deploy.maxRetries,
                      }
                    : {}),
                ...(executionPlan?.healthChecks?.deploy?.retryIntervalMs
                    ? {
                          deployHealthCheckRetryIntervalMs:
                              executionPlan.healthChecks.deploy.retryIntervalMs,
                      }
                    : {}),
                ...(containerImage ? { containerImage } : {}),
                ...(containerName ? { containerName } : {}),
                ...(storageBinding ? { storageBinding } : {}),
            }
        })

    /** The body of `processQueueJob`, without the heavy-work accounting. */
    const runQueueJob = (
        job: DeploymentQueueJob
    ): Effect.Effect<void, unknown, DeploymentArtifactBuilder> =>
        Effect.gen(function* () {
            if (!job.payload.deploymentId) {
                yield* Effect.logWarning(
                    `Queue job '${job.id}' has no deploymentId — skipping`
                )
                return
            }

            const builder = yield* DeploymentArtifactBuilder
            // The builder reads the checkout, the state machine and the strategy registry. All three live in the
            // app-wide context the module provides, so a job reads them there instead of widening this worker's
            // own requirement channel to the builder's collaborators.
            const appContext = yield* Effect.promise(() => host.context())
            const buildContext = Context.pick(
                BuilderGitPort,
                BuilderStateMachinePort,
                BuilderRegistry
            )(appContext)
            const outcome = yield* runner.run(job, () =>
                executeJob(builder, job).pipe(
                    Effect.provideContext(buildContext)
                )
            )

            const failure = failures.get(job.id)
            failures.delete(job.id)
            if (outcome === 'failed' && failure !== undefined)
                return yield* Effect.fail(failure)
        })

    const processQueueJob: DeploymentQueueWorkerShape['processQueueJob'] = (
        job
    ) =>
        Effect.acquireUseRelease(
            Effect.sync(() => beginHeavyWork('deploy')),
            () => runQueueJob(job),
            (releaseDeploySlot) => Effect.sync(releaseDeploySlot)
        )

    const cancelRunningJob: DeploymentQueueWorkerShape['cancelRunningJob'] = (
        jobId
    ) => runner.cancel(jobId)

    return {
        processQueueJob,
        cancelRunningJob,

        onStart: () =>
            Effect.gen(function* () {
                const context = (yield* Effect.promise(() =>
                    host.context()
                )) as Context.Context<DeploymentArtifactBuilder>
                const spawn = (program: Effect.Effect<void>) => {
                    const fiber = Effect.runFork(program)
                    running.add(fiber)
                    fiber.addObserver(() => running.delete(fiber))
                }

                subscriptions = [
                    // A cancelled job stops the fiber executing it (its build and child processes with it).
                    lifecycle.jobCancelled$.subscribe((job) => {
                        spawn(Effect.asVoid(cancelRunningJob(job.id)))
                    }),
                    lifecycle.jobQueued$.subscribe((job) => {
                        // Each delivery waits for a free slot, then runs as its own job fiber.
                        spawn(
                            slots
                                .withPermits(1)(processQueueJob(job))
                                .pipe(
                                    Effect.provide(context),
                                    Effect.catchCause((cause) =>
                                        Effect.logError(
                                            `Queue job ${job.id} (${job.type}) processing failed: ${Cause.pretty(cause)}`
                                        )
                                    )
                                )
                        )
                    }),
                ]
                yield* Effect.logInfo(
                    `Deployment queue worker started (${workerId}) — executing typed queue jobs`
                )
            }),

        // Jobs still running are interrupted: the runner writes nothing and the lease expiry returns them to the pool.
        onStop: () =>
            Effect.suspend(() => {
                for (const subscription of subscriptions)
                    subscription.unsubscribe()
                subscriptions = []
                const pending = [...running]
                running.clear()
                return Fiber.interruptAll(pending)
            }),
    }
}

/** The queue refused a write because this worker no longer holds the job. */
function isLostLease(error: unknown): boolean {
    return (
        error instanceof RuntimeInvalid ||
        (error instanceof Error && /worker\/lock token/i.test(error.message))
    )
}

function extractSourceCheckoutFromPayload(
    payload: DeploymentQueueJob['payload'] | undefined
) {
    const parsedSourceCheckout =
        deploymentSourceCheckoutContextSchema.safeParse(
            payload?.context.sourceCheckout
        )

    return parsedSourceCheckout.success ? parsedSourceCheckout.data : null
}

/**
 * W-Queue (Q5): classify a queue-execution failure as transient (retryable)
 * vs permanent. Permanent client/configuration errors — bad request,
 * validation, not-found, conflict, auth — must NOT consume retry attempts or
 * pollute the dead-letter queue; transient infrastructure errors (timeouts,
 * service-unavailable, docker flakes, unknown) stay retryable.
 */
function isTransientQueueFailure(error: unknown): boolean {
    const permanent = [
        BadRequestError,
        ValidationError,
        NotFoundError,
        ConflictError,
        UnauthorizedError,
        ForbiddenError,
    ]
    if (
        error instanceof Error &&
        typeof (error as AppError).code === 'string'
    ) {
        for (const cls of permanent) {
            if (error instanceof cls) {
                return false
            }
        }
    }
    return true
}

function resolvePhaseRetryPolicy(
    phaseConfig:
        | {
              maxRetries?: number
              retryIntervalMs?: number
          }
        | null
        | undefined
): PhaseRetryPolicy {
    const maxRetries =
        typeof phaseConfig?.maxRetries === 'number' &&
        Number.isInteger(phaseConfig.maxRetries) &&
        phaseConfig.maxRetries > 0
            ? phaseConfig.maxRetries
            : 1

    const retryIntervalMs =
        typeof phaseConfig?.retryIntervalMs === 'number' &&
        Number.isInteger(phaseConfig.retryIntervalMs) &&
        phaseConfig.retryIntervalMs > 0
            ? phaseConfig.retryIntervalMs
            : 250

    return {
        maxRetries,
        retryIntervalMs,
    }
}

function extractStorageBindingFromPayload(
    payload: DeploymentQueueJob['payload'] | undefined
): DeploymentStorageBinding | null {
    const storageCandidate = payload?.context.storageBinding
    const parsedStorageBinding =
        deploymentStorageBindingSchema.safeParse(storageCandidate)
    return parsedStorageBinding.success ? parsedStorageBinding.data : null
}

function extractRuntimeRunnerFromPayload(
    payload: DeploymentQueueJob['payload'] | undefined
): string | null {
    const parsedSourceCheckout =
        deploymentSourceCheckoutContextSchema.safeParse(
            payload?.context.sourceCheckout
        )

    if (!parsedSourceCheckout.success) {
        return null
    }

    const runtimeRunner =
        'runtimeRunner' in parsedSourceCheckout.data
            ? parsedSourceCheckout.data.runtimeRunner
            : undefined

    return typeof runtimeRunner === 'string' && runtimeRunner.trim().length > 0
        ? runtimeRunner
        : null
}

function extractRuntimeRunnerOptionsFromPayload(
    payload: DeploymentQueueJob['payload'] | undefined
): RuntimeRunnerOptions | null {
    const parsedSourceCheckout =
        deploymentSourceCheckoutContextSchema.safeParse(
            payload?.context.sourceCheckout
        )

    if (
        !parsedSourceCheckout.success ||
        !('runtimeRunnerOptions' in parsedSourceCheckout.data)
    ) {
        return null
    }

    const parsedOptions = runtimeRunnerOptionsSchema.safeParse(
        parsedSourceCheckout.data.runtimeRunnerOptions
    )

    return parsedOptions.success ? parsedOptions.data : null
}

function mergeRuntimeRunnerOptions(
    primary: RuntimeRunnerOptions | null,
    fallback: RuntimeRunnerOptions | null
): RuntimeRunnerOptions | null {
    if (!primary) {
        return fallback
    }

    if (!fallback) {
        return primary
    }

    // Discriminated union: merging only makes sense when both sides target
    // the SAME runner kind — otherwise the explicit payload options win.
    if (primary.runner !== fallback.runner) {
        return primary
    }

    const runner = primary.runner
    const mergedBase: Record<string, unknown> = {
        ...fallback,
        ...primary,
        runner,
    }

    // Deep-merge the runner-specific nested options when both sides carry one.
    if (
        fallback.runner === 'dockerfile' &&
        primary.runner === 'dockerfile'
    ) {
        const a = fallback.dockerfile
        const b = primary.dockerfile
        if (a || b) {
            mergedBase.dockerfile = { ...(a ?? {}), ...(b ?? {}) }
        }
    } else if (
        fallback.runner === 'docker_compose' &&
        primary.runner === 'docker_compose'
    ) {
        const a = fallback.dockerCompose
        const b = primary.dockerCompose
        if (a || b) {
            mergedBase.dockerCompose = { ...(a ?? {}), ...(b ?? {}) }
        }
    } else if (
        fallback.runner === 'nixpacks' &&
        primary.runner === 'nixpacks'
    ) {
        const a = fallback.nixpacks
        const b = primary.nixpacks
        if (a || b) {
            mergedBase.nixpacks = { ...(a ?? {}), ...(b ?? {}) }
        }
    } else if (
        fallback.runner === 'buildpack' &&
        primary.runner === 'buildpack'
    ) {
        const a = fallback.buildpack
        const b = primary.buildpack
        if (a || b) {
            mergedBase.buildpack = { ...(a ?? {}), ...(b ?? {}) }
        }
    } else if (
        fallback.runner === 'railpack' &&
        primary.runner === 'railpack'
    ) {
        const a = fallback.railpack
        const b = primary.railpack
        if (a || b) {
            mergedBase.railpack = { ...(a ?? {}), ...(b ?? {}) }
        }
    }

    const parsed = runtimeRunnerOptionsSchema.safeParse(mergedBase)
    return parsed.success ? parsed.data : primary
}

function extractRuntimeConfigurationFromPayload(
    payload: DeploymentQueueJob['payload'] | undefined
): z.infer<typeof runtimeConfigurationContextSchema> | null {
    const parsedRuntimeConfiguration =
        runtimeConfigurationContextSchema.safeParse(
            payload?.context.runtimeConfiguration
        )

    return parsedRuntimeConfiguration.success
        ? parsedRuntimeConfiguration.data
        : null
}

function extractRuntimeRunnerOptionsFromRuntimeConfiguration(
    payload: DeploymentQueueJob['payload'] | undefined,
    runtimeRunner: string | null
): RuntimeRunnerOptions | null {
    const runtimeConfiguration = extractRuntimeConfigurationFromPayload(payload)
    if (!runtimeConfiguration) {
        return null
    }

    const networkModeCandidates = [
        runtimeConfiguration.environmentDomains?.network?.DEPLOYER_NETWORK_MODE,
        runtimeConfiguration.environmentDomains?.network
            ?.DEPLOYMENT_NETWORK_MODE,
        runtimeConfiguration.environmentDomains?.network?.NETWORK_MODE,
        runtimeConfiguration.environment?.DEPLOYER_NETWORK_MODE,
        runtimeConfiguration.environment?.DEPLOYMENT_NETWORK_MODE,
        runtimeConfiguration.environment?.NETWORK_MODE,
    ]

    const networkMode = networkModeCandidates.find(
        (candidate): candidate is string =>
            typeof candidate === 'string' && candidate.trim().length > 0
    )

    if (!networkMode) {
        return null
    }

    // The options union is discriminated on `runner` — hydrate noise under
    // the resolved runner kind (falls back to the platform default).
    const parsedOptions = runtimeRunnerOptionsSchema.safeParse({
        runner: runtimeRunner ?? 'docker',
        networkMode,
    })
    return parsedOptions.success ? parsedOptions.data : null
}

function extractRuntimeEnvironmentVariablesFromRuntimeConfiguration(
    payload: DeploymentQueueJob['payload'] | undefined
): Record<string, string> | null {
    const runtimeConfiguration = extractRuntimeConfigurationFromPayload(payload)
    if (!runtimeConfiguration?.environment) {
        return null
    }

    const environmentVariables = Object.entries(
        runtimeConfiguration.environment
    ).reduce<Record<string, string>>((accumulator, [key, value]) => {
        const normalizedKey = key.trim()
        if (!normalizedKey || normalizedKey.includes('\0')) {
            return accumulator
        }

        if (typeof value !== 'string' || value.includes('\0')) {
            return accumulator
        }

        accumulator[normalizedKey] = value
        return accumulator
    }, {})

    return Object.keys(environmentVariables).length > 0
        ? environmentVariables
        : null
}

function extractExecutionPlanFromPayload(
    payload: DeploymentQueueJob['payload'] | undefined
): DeploymentExecutionPlan | null {
    const parsedExecutionPlan = executionPlanSchema.safeParse(
        payload?.context.executionPlan
    )
    return parsedExecutionPlan.success ? parsedExecutionPlan.data : null
}

function extractContainerImageFromPayload(
    payload: DeploymentQueueJob['payload'] | undefined
): string | null {
    const parsedSourceCheckout =
        deploymentSourceCheckoutContextSchema.safeParse(
            payload?.context.sourceCheckout
        )

    if (
        !parsedSourceCheckout.success ||
        !('containerImage' in parsedSourceCheckout.data)
    ) {
        return null
    }

    const containerImage = parsedSourceCheckout.data.containerImage
    return typeof containerImage === 'string' &&
        containerImage.trim().length > 0
        ? containerImage
        : null
}

function extractContainerNameFromPayload(
    payload: DeploymentQueueJob['payload'] | undefined
): string | null {
    const parsedSourceCheckout =
        deploymentSourceCheckoutContextSchema.safeParse(
            payload?.context.sourceCheckout
        )

    if (
        !parsedSourceCheckout.success ||
        !('containerName' in parsedSourceCheckout.data)
    ) {
        return null
    }

    const containerName = parsedSourceCheckout.data.containerName
    return typeof containerName === 'string' && containerName.trim().length > 0
        ? containerName
        : null
}
