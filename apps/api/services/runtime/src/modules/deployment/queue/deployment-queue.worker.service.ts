import { RuntimeInvalid } from "../../../core/runtime.errors";
/**
 * DeploymentQueueWorkerService — the TYPED execution engine for the deployment
 * queue (D-6).
 *
 * Replaces the Redis-backed Bull bridge (`@nestjs/bull` @Processor →
 * `DeploymentBullQueueService`). The queue is now fully typed + in-process:
 *
 *   enqueueQueueJob() → DeploymentQueueLifecycleService (Zod-typed store)
 *                     → jobQueued$ typed channel (onJobQueued())
 *                     → THIS worker (claims → executes → completes)
 *
 * The worker subscribes to the typed channel on module init (mirroring the
 * typed-observable pattern of the core events module) and runs the full
 * execution body that previously lived in the Bull processor: claim by
 * idempotency key, 30s heartbeats, storage/execution-plan/runtime-runner
 * hydration, container-image build-with-retry-policy, then
 * `completeQueueJob`/`failQueueJob` — all over the typed `DeploymentQueueJob`
 * Zod shape. No external queue IO; jobs that previously "stayed queued
 * forever" (Bull enqueue failed silently against a missing Redis) now run.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";

import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@deployer/errors";

import type { AppError } from "@deployer/errors";
import { randomUUID } from "crypto";
import { Effect, Semaphore } from "effect";
import { EnvService } from "@deployer/shared/config/env/env.module";
import type { Subscription } from "rxjs";
import type { DeploymentQueueJob } from "@deployer/contracts-entities";
import { DeploymentService } from "../services/deployment.service";
import {
    deploymentStorageBindingSchema,
    type DeploymentStorageBinding,
} from "../storage/base/storage-provider.interface";
import { deploymentSourceCheckoutContextSchema } from "@deployer/contracts-entities";
import {
    runtimeRunnerOptionsSchema,
    type RuntimeRunnerOptions,
} from "@deployer/contracts-entities";
import z from "zod/v4";
import {
    DeploymentArtifactBuilderService,
    type DeploymentBuilderKind,
} from "../builders/deployment-artifact-builder.service";
import { DeploymentQueueLifecycleService } from "./deployment-queue-lifecycle.service";
import { makeJobRunner } from "./worker/job-runner";

/** One async boundary; the original error travels as the failure (never Effect's generic wrapper). */
const attempt = <A>(operation: () => Promise<A>): Effect.Effect<A, unknown> =>
    Effect.tryPromise({ try: operation, catch: (error: unknown) => error });

type ClaimedJob = { readonly id: string; readonly lockToken: string; /** The delivered job this claim answers (ids can differ when the queue re-keys). */ readonly deliveredJobId: string };
import { beginHeavyWork } from "@deployer/shared/core/utils/heavy-work.registry";

const executionPlanSchema = z.object({
    builder: z
        .enum(["dockerfile", "docker_compose", "nixpacks", "buildpack", "railpack", "external"])
        .nullable()
        .optional(),
    runner: z
        .enum(["docker", "dockerfile", "docker_compose", "nixpacks", "buildpack", "railpack"])
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
});

type DeploymentExecutionPlan = z.infer<typeof executionPlanSchema>;

const runtimeConfigurationContextSchema = z
    .object({
        environment: z.record(z.string(), z.string()).optional(),
        environmentDomains: z
            .object({
                network: z.record(z.string(), z.string()).optional(),
            })
            .optional(),
    })
    .passthrough();

type PhaseRetryPolicy = {
    maxRetries: number;
    retryIntervalMs: number;
}

// Keep the queue result metadata honest: no Bull ids anymore — the worker
// tags its executions so the operator sees WHERE the job ran.
const QUEUE_SOURCE = "typed-worker";

@Injectable()
export class DeploymentQueueWorkerService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(DeploymentQueueWorkerService.name);
    /** A claim lasts 60 s; a heartbeat every 15 s renews it, so a lost worker is reclaimed within a minute. */
    private static readonly LEASE_SEC = 60;
    private static readonly HEARTBEAT_MS = 15_000;
    private readonly workerId = `typed:${randomUUID()}`;
    private readonly failures = new Map<string, unknown>();
    private subscription: Subscription | null = null;
    private cancelSubscription: Subscription | null = null;
    /**
     * How many jobs execute at once. One by default (a deployment is the heaviest thing this service does);
     * raise it with `DEPLOYMENT_WORKER_CONCURRENCY` on a host that can take it.
     */
    private readonly slots: Semaphore.Semaphore;

    constructor(
        private readonly deploymentService: DeploymentService,
        private readonly queueLifecycle: DeploymentQueueLifecycleService,
        @Optional() private readonly deploymentArtifactBuilderService?: DeploymentArtifactBuilderService,
        @Optional() env?: EnvService,
    ) {
        this.slots = Semaphore.makeUnsafe(env?.get("DEPLOYMENT_WORKER_CONCURRENCY") ?? 1);
    }

    onModuleInit(): void {
        // A cancelled job stops the fiber executing it (its build and child processes with it).
        this.cancelSubscription = this.queueLifecycle.onJobCancelled().subscribe((job) => {
            void this.cancelRunningJob(job.id);
        });
        this.subscription = this.queueLifecycle.onJobQueued().subscribe((job) => {
            // Each delivery waits for a free slot, then runs as its own job fiber.
            void Effect.runPromise(
                this.slots.withPermits(1)(
                    Effect.tryPromise({ try: () => this.processQueueJob(job), catch: (error: unknown) => error }),
                ).pipe(
                    Effect.catch((error: unknown) =>
                        Effect.sync(() => {
                            this.logger.error(
                                `Queue job ${job.id} (${job.type}) processing failed: ${error instanceof Error ? error.message : String(error)}`,
                            );
                        }),
                    ),
                ),
            );
        });
        this.logger.log(`Deployment queue worker started (${this.workerId}) — executing typed queue jobs`);
    }

    onModuleDestroy(): void {
        this.subscription?.unsubscribe();
        this.subscription = null;
        this.cancelSubscription?.unsubscribe();
        this.cancelSubscription = null;
    }

    /**
     * Claim + execute ONE typed queue job. Exposed for direct testing.
     *
     * A deployment is the heaviest thing this service does (checkout, image
     * build, container rollout), so it is REPORTED while it runs: the image-scan
     * concurrency planner collapses a scan to serial when a deployment is in
     * flight, which is the pairing that took the dev host into swap.
     */
    async processQueueJob(job: DeploymentQueueJob): Promise<void> {
        const releaseDeploySlot = beginHeavyWork("deploy");
        try {
            await this.runQueueJob(job);
        } finally {
            releaseDeploySlot();
        }
    }

    /** The body of {@link processQueueJob}, without the heavy-work accounting. */
    private async runQueueJob(job: DeploymentQueueJob): Promise<void> {
        if (!job.payload.deploymentId) {
            this.logger.warn(`Queue job '${job.id}' has no deploymentId — skipping`);
            return;
        }

        const outcome = await Effect.runPromise(
            this.runner.run(job, () =>
                Effect.tryPromise({
                    try: (signal) => this.executeJob(job, signal),
                    catch: (error: unknown) => error,
                }),
            ),
        );

        const failure = this.failures.get(job.id);
        this.failures.delete(job.id);
        if (outcome === "failed" && failure !== undefined) throw failure;
    }

    /** Cancels the job's fiber when this worker is executing it. */
    cancelRunningJob(jobId: string): Promise<boolean> {
        return Effect.runPromise(this.runner.cancel(jobId));
    }

    /**
     * The job's work: resolve the container image under the build retry policy and describe what was built.
     * `signal` aborts when the job is cancelled or loses its lease, so waits and builds stop with it.
     */
    private async executeJob(job: DeploymentQueueJob, signal: AbortSignal): Promise<Record<string, unknown>> {
        const deploymentId = job.payload.deploymentId ?? "";
            const storageBinding = this.extractStorageBindingFromPayload(job.payload);
            const executionPlan = this.extractExecutionPlanFromPayload(job.payload);
            const buildHealthPolicy = this.resolvePhaseRetryPolicy(executionPlan?.healthChecks?.build);
            const parsedSourceCheckout = this.extractSourceCheckoutFromPayload(job.payload);
            const runtimeRunner =
                (typeof executionPlan?.runner === "string" && executionPlan.runner.trim().length > 0
                    ? executionPlan.runner
                    : null) ?? this.extractRuntimeRunnerFromPayload(job.payload);
            const runtimeRunnerOptionsFromPayload =
                executionPlan?.runtimeRunnerOptions ?? this.extractRuntimeRunnerOptionsFromPayload(job.payload);
            const runtimeRunnerOptionsFromRuntimeConfiguration =
                this.extractRuntimeRunnerOptionsFromRuntimeConfiguration(job.payload, runtimeRunner);
            const runtimeRunnerOptions = this.mergeRuntimeRunnerOptions(
                runtimeRunnerOptionsFromPayload,
                runtimeRunnerOptionsFromRuntimeConfiguration,
            );
            const runtimeEnvironmentVariables =
                this.extractRuntimeEnvironmentVariablesFromRuntimeConfiguration(job.payload);
            const buildStartedAt = new Date();
            const containerImage = await this.resolveContainerImageWithPolicy({
                deploymentId,
                serviceId: job.payload.serviceId ?? "",
                sourceCheckout: parsedSourceCheckout,
                executionPlan,
                fallbackContainerImage: this.extractContainerImageFromPayload(job.payload),
            }, buildHealthPolicy, signal);
            const containerName = this.extractContainerNameFromPayload(job.payload);
            const buildCompletedAt = new Date();


        return {
            queueSource: QUEUE_SOURCE,
            jobType: job.type,
            runtimeRunner: runtimeRunner ?? "docker",
            ...(executionPlan?.builder ? { buildRunner: executionPlan.builder } : {}),
            ...(executionPlan?.customCommands?.runCommand
                ? { customRunCommand: executionPlan.customCommands.runCommand }
                : {}),
            buildStartedAt: buildStartedAt.toISOString(),
            buildCompletedAt: buildCompletedAt.toISOString(),
            ...(runtimeRunnerOptions ? { runtimeRunnerOptions } : {}),
            ...(runtimeEnvironmentVariables ? { runtimeEnvironmentVariables } : {}),
            ...(executionPlan?.healthChecks?.runtime?.maxRetries
                ? { healthCheckMaxRetries: executionPlan.healthChecks.runtime.maxRetries }
                : {}),
            ...(executionPlan?.healthChecks?.runtime?.retryIntervalMs
                ? { healthCheckRetryIntervalMs: executionPlan.healthChecks.runtime.retryIntervalMs }
                : {}),
            ...(executionPlan?.healthChecks?.build?.maxRetries
                ? { buildHealthCheckMaxRetries: executionPlan.healthChecks.build.maxRetries }
                : {}),
            ...(executionPlan?.healthChecks?.build?.retryIntervalMs
                ? { buildHealthCheckRetryIntervalMs: executionPlan.healthChecks.build.retryIntervalMs }
                : {}),
            ...(executionPlan?.healthChecks?.deploy?.maxRetries
                ? { deployHealthCheckMaxRetries: executionPlan.healthChecks.deploy.maxRetries }
                : {}),
            ...(executionPlan?.healthChecks?.deploy?.retryIntervalMs
                ? { deployHealthCheckRetryIntervalMs: executionPlan.healthChecks.deploy.retryIntervalMs }
                : {}),
            ...(containerImage ? { containerImage } : {}),
            ...(containerName ? { containerName } : {}),
            ...(storageBinding ? { storageBinding } : {}),
        };
    }

    /** What this worker needs from the queue, as the Effect runner's ports. */
    private readonly runner = makeJobRunner<DeploymentQueueJob, ClaimedJob, Record<string, unknown>, unknown>(
        {
            claim: (job) =>
                attempt(async () => {
                    const claimed = await this.deploymentService.claimQueueJobByIdempotencyKey(job.idempotencyKey, {
                        workerId: this.workerId,
                        limit: 1,
                        leaseDurationSec: DeploymentQueueWorkerService.LEASE_SEC,
                        types: [job.type],
                    });
                    if (!claimed) {
                        this.logger.warn(
                            `No queued lifecycle job matched '${job.id}' (${job.idempotencyKey}); skipping duplicate or stale delivery.`,
                        );
                        return null;
                    }
                    if (!claimed.lockToken) {
                        throw new RuntimeInvalid({ reason: `Claimed queue job '${claimed.id}' is missing a lock token` });
                    }
                    return { id: claimed.id, lockToken: claimed.lockToken, deliveredJobId: job.id };
                }),
            heartbeat: (claimed) =>
                attempt(async () => {
                    const heartbeat = await this.deploymentService.heartbeatQueueJob(claimed.id, {
                        workerId: this.workerId,
                        lockToken: claimed.lockToken,
                        extendLeaseSec: DeploymentQueueWorkerService.LEASE_SEC,
                    });
                    if (!heartbeat.acknowledged) {
                        this.logger.warn(`Heartbeat was not acknowledged for lifecycle job '${claimed.id}'`);
                    }
                    return heartbeat.acknowledged;
                }),
            complete: (claimed, result) =>
                attempt(() =>
                    this.deploymentService
                        .completeQueueJob(claimed.id, { workerId: this.workerId, lockToken: claimed.lockToken, result })
                        .then(() => true),
                ).pipe(Effect.catch((error) => (this.isLostLease(error) ? Effect.succeed(false) : Effect.fail(error)))),
            fail: (claimed, error) =>
                attempt(() => {
                    // Kept so `processQueueJob` can reject with the original error, as callers expect.
                    this.failures.set(claimed.deliveredJobId, error);
                    return this.deploymentService
                        .failQueueJob(claimed.id, {
                            workerId: this.workerId,
                            lockToken: claimed.lockToken,
                            error: error instanceof Error ? error.message : String(error),
                            retryable: this.isTransientQueueFailure(error),
                        })
                        .then(() => true);
                }).pipe(Effect.catch((cause) => (this.isLostLease(cause) ? Effect.succeed(false) : Effect.fail(cause)))),
        },
        {
            heartbeatEvery: DeploymentQueueWorkerService.HEARTBEAT_MS,
            warn: (message) => {
                this.logger.warn(message);
            },
        },
    );

    /** The queue refused a write because this worker no longer holds the job. */
    private isLostLease(error: unknown): boolean {
        return error instanceof RuntimeInvalid || (error instanceof Error && /worker\/lock token/i.test(error.message));
    }

    private extractSourceCheckoutFromPayload(payload: DeploymentQueueJob["payload"] | undefined) {
        const parsedSourceCheckout = deploymentSourceCheckoutContextSchema.safeParse(
            payload?.context?.sourceCheckout,
        );

        return parsedSourceCheckout.success ? parsedSourceCheckout.data : null;
    }

    private async resolveContainerImage(input: {
        deploymentId: string;
        serviceId: string;
        sourceCheckout: z.infer<typeof deploymentSourceCheckoutContextSchema> | null;
        executionPlan: DeploymentExecutionPlan | null;
        fallbackContainerImage: string | null;
    }, signal?: AbortSignal): Promise<string | null> {
        if (!this.deploymentArtifactBuilderService) {
            throw new RuntimeInvalid({ reason: "DeploymentArtifactBuilderService is required for builder stage execution" });
        }

        return this.deploymentArtifactBuilderService.buildContainerizedArtifact({
            deploymentId: input.deploymentId,
            serviceId: input.serviceId,
            builder: (input.executionPlan?.builder ?? null),
            sourceCheckout: input.sourceCheckout,
            fallbackContainerImage: input.fallbackContainerImage,
            customCommands: input.executionPlan?.customCommands ?? null,
            signal,
        });
    }

    /**
     * W-Queue (Q5): classify a queue-execution failure as transient (retryable)
     * vs permanent. Permanent client/configuration errors — bad request,
     * validation, not-found, conflict, auth — must NOT consume retry attempts or
     * pollute the dead-letter queue; transient infrastructure errors (timeouts,
     * service-unavailable, docker flakes, unknown) stay retryable.
     */
    private isTransientQueueFailure(error: unknown): boolean {
        const permanent = [
            BadRequestError,
            ValidationError,
            NotFoundError,
            ConflictError,
            UnauthorizedError,
            ForbiddenError,
        ];
        if (error instanceof Error && typeof (error as AppError).code === "string") {
            for (const cls of permanent) {
                if (error instanceof cls) {
                    return false;
                }
            }
        }
        return true;
    }

    private async resolveContainerImageWithPolicy(
        input: {
            deploymentId: string;
            serviceId: string;
            sourceCheckout: z.infer<typeof deploymentSourceCheckoutContextSchema> | null;
            executionPlan: DeploymentExecutionPlan | null;
            fallbackContainerImage: string | null;
        },
        policy: PhaseRetryPolicy,
        signal?: AbortSignal,
    ): Promise<string | null> {
        let lastError: unknown;

        for (let attempt = 1; attempt <= policy.maxRetries; attempt += 1) {
            try {
                return await this.resolveContainerImage(input, signal);
            } catch (error) {
                lastError = error;

                if (attempt >= policy.maxRetries) {
                    break;
                }

                this.logger.warn(
                    `Build phase attempt ${String(attempt)}/${String(policy.maxRetries)} failed for deployment '${input.deploymentId}', retrying in ${String(policy.retryIntervalMs)}ms`,
                );
                await this.sleep(policy.retryIntervalMs, signal);
            }
        }

        throw lastError instanceof Error
            ? lastError
            : new Error("Build phase failed after retry policy exhausted");
    }

    private resolvePhaseRetryPolicy(
        phaseConfig:
            | {
                  maxRetries?: number;
                  retryIntervalMs?: number;
              }
            | null
            | undefined,
    ): PhaseRetryPolicy {
        const maxRetries =
            typeof phaseConfig?.maxRetries === "number" && Number.isInteger(phaseConfig.maxRetries) && phaseConfig.maxRetries > 0
                ? phaseConfig.maxRetries
                : 1;

        const retryIntervalMs =
            typeof phaseConfig?.retryIntervalMs === "number" && Number.isInteger(phaseConfig.retryIntervalMs) && phaseConfig.retryIntervalMs > 0
                ? phaseConfig.retryIntervalMs
                : 250;

        return {
            maxRetries,
            retryIntervalMs,
        };
    }

    /** Waits `delayMs`, or rejects as soon as `signal` aborts (the job was cancelled or lost its lease). */
    private sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new Error("aborted"));
                return;
            }
            const onAbort = () => {
                clearTimeout(timer);
                reject(new Error("aborted"));
            };
            const timer = setTimeout(() => {
                signal?.removeEventListener("abort", onAbort);
                resolve();
            }, delayMs);
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    }

    private extractStorageBindingFromPayload(
        payload: DeploymentQueueJob["payload"] | undefined,
    ): DeploymentStorageBinding | null {
        const storageCandidate = payload?.context?.storageBinding;
        const parsedStorageBinding = deploymentStorageBindingSchema.safeParse(storageCandidate);
        return parsedStorageBinding.success ? parsedStorageBinding.data : null;
    }

    private extractRuntimeRunnerFromPayload(
        payload: DeploymentQueueJob["payload"] | undefined,
    ): string | null {
        const parsedSourceCheckout = deploymentSourceCheckoutContextSchema.safeParse(
            payload?.context?.sourceCheckout,
        );

        if (!parsedSourceCheckout.success) {
            return null;
        }

        const runtimeRunner = "runtimeRunner" in parsedSourceCheckout.data
            ? parsedSourceCheckout.data.runtimeRunner
            : undefined;

        return typeof runtimeRunner === "string" && runtimeRunner.trim().length > 0
            ? runtimeRunner
            : null;
    }

    private extractRuntimeRunnerOptionsFromPayload(
        payload: DeploymentQueueJob["payload"] | undefined,
    ): RuntimeRunnerOptions | null {
        const parsedSourceCheckout = deploymentSourceCheckoutContextSchema.safeParse(
            payload?.context?.sourceCheckout,
        );

        if (!parsedSourceCheckout.success || !("runtimeRunnerOptions" in parsedSourceCheckout.data)) {
            return null;
        }

        const parsedOptions = runtimeRunnerOptionsSchema.safeParse(
            parsedSourceCheckout.data.runtimeRunnerOptions,
        );

        return parsedOptions.success ? parsedOptions.data : null;
    }

    private mergeRuntimeRunnerOptions(
        primary: RuntimeRunnerOptions | null,
        fallback: RuntimeRunnerOptions | null,
    ): RuntimeRunnerOptions | null {
        if (!primary) {
            return fallback;
        }

        if (!fallback) {
            return primary;
        }

        // Discriminated union: merging only makes sense when both sides target
        // the SAME runner kind — otherwise the explicit payload options win.
        if (primary.runner !== fallback.runner) {
            return primary;
        }

        const runner = primary.runner;
        const mergedBase: Record<string, unknown> = {
            ...fallback,
            ...primary,
            runner,
        };

        // Deep-merge the runner-specific nested options when both sides carry one.
        if (runner === "dockerfile" && fallback.runner === "dockerfile" && primary.runner === "dockerfile") {
            const a = fallback.dockerfile;
            const b = primary.dockerfile;
            if (a || b) {
                mergedBase.dockerfile = { ...(a ?? {}), ...(b ?? {}) };
            }
        } else if (runner === "docker_compose" && fallback.runner === "docker_compose" && primary.runner === "docker_compose") {
            const a = fallback.dockerCompose;
            const b = primary.dockerCompose;
            if (a || b) {
                mergedBase.dockerCompose = { ...(a ?? {}), ...(b ?? {}) };
            }
        } else if (runner === "nixpacks" && fallback.runner === "nixpacks" && primary.runner === "nixpacks") {
            const a = fallback.nixpacks;
            const b = primary.nixpacks;
            if (a || b) {
                mergedBase.nixpacks = { ...(a ?? {}), ...(b ?? {}) };
            }
        } else if (runner === "buildpack" && fallback.runner === "buildpack" && primary.runner === "buildpack") {
            const a = fallback.buildpack;
            const b = primary.buildpack;
            if (a || b) {
                mergedBase.buildpack = { ...(a ?? {}), ...(b ?? {}) };
            }
        } else if (runner === "railpack" && fallback.runner === "railpack" && primary.runner === "railpack") {
            const a = fallback.railpack;
            const b = primary.railpack;
            if (a || b) {
                mergedBase.railpack = { ...(a ?? {}), ...(b ?? {}) };
            }
        }

        const parsed = runtimeRunnerOptionsSchema.safeParse(mergedBase);
        return parsed.success ? parsed.data : primary;
    }

    private extractRuntimeConfigurationFromPayload(
        payload: DeploymentQueueJob["payload"] | undefined,
    ): z.infer<typeof runtimeConfigurationContextSchema> | null {
        const parsedRuntimeConfiguration = runtimeConfigurationContextSchema.safeParse(
            payload?.context?.runtimeConfiguration,
        );

        return parsedRuntimeConfiguration.success ? parsedRuntimeConfiguration.data : null;
    }

    private extractRuntimeRunnerOptionsFromRuntimeConfiguration(
        payload: DeploymentQueueJob["payload"] | undefined,
        runtimeRunner: string | null,
    ): RuntimeRunnerOptions | null {
        const runtimeConfiguration = this.extractRuntimeConfigurationFromPayload(payload);
        if (!runtimeConfiguration) {
            return null;
        }

        const networkModeCandidates = [
            runtimeConfiguration.environmentDomains?.network?.DEPLOYER_NETWORK_MODE,
            runtimeConfiguration.environmentDomains?.network?.DEPLOYMENT_NETWORK_MODE,
            runtimeConfiguration.environmentDomains?.network?.NETWORK_MODE,
            runtimeConfiguration.environment?.DEPLOYER_NETWORK_MODE,
            runtimeConfiguration.environment?.DEPLOYMENT_NETWORK_MODE,
            runtimeConfiguration.environment?.NETWORK_MODE,
        ];

        const networkMode = networkModeCandidates.find(
            (candidate): candidate is string =>
                typeof candidate === "string" && candidate.trim().length > 0,
        );

        if (!networkMode) {
            return null;
        }

        // The options union is discriminated on `runner` — hydrate noise under
        // the resolved runner kind (falls back to the platform default).
        const parsedOptions = runtimeRunnerOptionsSchema.safeParse({
            runner: (runtimeRunner ?? "docker"),
            networkMode,
        });
        return parsedOptions.success ? parsedOptions.data : null;
    }

    private extractRuntimeEnvironmentVariablesFromRuntimeConfiguration(
        payload: DeploymentQueueJob["payload"] | undefined,
    ): Record<string, string> | null {
        const runtimeConfiguration = this.extractRuntimeConfigurationFromPayload(payload);
        if (!runtimeConfiguration?.environment) {
            return null;
        }

        const environmentVariables = Object.entries(runtimeConfiguration.environment).reduce<Record<string, string>>(
            (accumulator, [key, value]) => {
                const normalizedKey = key.trim();
                if (!normalizedKey || normalizedKey.includes('\0')) {
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

        return Object.keys(environmentVariables).length > 0 ? environmentVariables : null;
    }

    private extractExecutionPlanFromPayload(
        payload: DeploymentQueueJob["payload"] | undefined,
    ): DeploymentExecutionPlan | null {
        const parsedExecutionPlan = executionPlanSchema.safeParse(payload?.context?.executionPlan);
        return parsedExecutionPlan.success ? parsedExecutionPlan.data : null;
    }

    private extractContainerImageFromPayload(
        payload: DeploymentQueueJob["payload"] | undefined,
    ): string | null {
        const parsedSourceCheckout = deploymentSourceCheckoutContextSchema.safeParse(
            payload?.context?.sourceCheckout,
        );

        if (!parsedSourceCheckout.success || !("containerImage" in parsedSourceCheckout.data)) {
            return null;
        }

        const containerImage = parsedSourceCheckout.data.containerImage;
        return typeof containerImage === "string" && containerImage.trim().length > 0
            ? containerImage
            : null;
    }

    private extractContainerNameFromPayload(
        payload: DeploymentQueueJob["payload"] | undefined,
    ): string | null {
        const parsedSourceCheckout = deploymentSourceCheckoutContextSchema.safeParse(
            payload?.context?.sourceCheckout,
        );

        if (!parsedSourceCheckout.success || !("containerName" in parsedSourceCheckout.data)) {
            return null;
        }

        const containerName = parsedSourceCheckout.data.containerName;
        return typeof containerName === "string" && containerName.trim().length > 0
            ? containerName
            : null;
    }
}