import { Process, Processor, OnQueueFailed } from "@nestjs/bull";
import { Logger, Optional } from "@nestjs/common";
import { BadRequestError } from "@/core/errors/app-error";
import type { Job } from "bull";
import { randomUUID } from "crypto";
import { DeploymentService } from "../services/deployment.service";
import {
    deploymentStorageBindingSchema,
    type DeploymentStorageBinding,
} from "../storage/base/storage-provider.interface";
import { deploymentSourceCheckoutContextSchema } from "../providers/base/source-provider.interface";
import {
    runtimeRunnerOptionsSchema,
    type RuntimeRunnerOptions,
} from "../providers/base/runtime-runner-options.schema";
import z from "zod/v4";
import {
    DeploymentArtifactBuilderService,
    type DeploymentBuilderKind,
} from "../builders/deployment-artifact-builder.service";

interface DeploymentBullJobPayload {
    context?: Record<string, unknown>;
}

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

type DeploymentExecutionPlan = z.infer<typeof executionPlanSchema>;

interface PhaseRetryPolicy {
    maxRetries: number;
    retryIntervalMs: number;
}

interface DeploymentBullJobData {
    deploymentId: string;
    serviceId: string;
    environment: string;
    payload: DeploymentBullJobPayload;
    idempotencyKey: string;
}

@Processor("deployment")
export class DeploymentQueueProcessor {
    private readonly logger = new Logger(DeploymentQueueProcessor.name);

    constructor(
        private readonly deploymentService: DeploymentService,
        @Optional() private readonly deploymentArtifactBuilderService?: DeploymentArtifactBuilderService,
    ) {}

    @Process("deploy")
    async processDeploy(job: Job<DeploymentBullJobData>): Promise<void> {
        await this.processQueueJob(job, ["deploy"]);
    }

    @Process("rollback")
    async processRollback(job: Job<DeploymentBullJobData>): Promise<void> {
        await this.processQueueJob(job, ["rollback"]);
    }

    @Process("retry")
    async processRetry(job: Job<DeploymentBullJobData>): Promise<void> {
        await this.processQueueJob(job);
    }

    @OnQueueFailed()
    onQueueFailed(job: Job<DeploymentBullJobData>, error: Error): void {
        this.logger.error(
            `Bull queue job '${String(job.id)}' (${job.name}) failed for deployment '${job.data.deploymentId}': ${error.message}`,
        );
    }

    private async processQueueJob(
        job: Job<DeploymentBullJobData>,
        types?: ("deploy" | "rollback" | "retry")[],
    ): Promise<void> {
        const workerId = `bull:${randomUUID()}`;
        const claimed = await this.deploymentService.claimQueueJobByIdempotencyKey(job.data.idempotencyKey, {
            workerId,
            limit: 1,
            leaseDurationSec: 120,
            ...(types ? { types } : {}),
        });

        if (!claimed) {
            this.logger.warn(
                `No queued lifecycle job matched Bull job '${String(job.id)}' (${job.data.idempotencyKey}); skipping duplicate or stale delivery.`,
            );
            return;
        }

        const lockToken = claimed.lockToken;
        if (!lockToken) {
            throw new BadRequestError(`Claimed queue job '${claimed.id}' is missing a lock token`);
        }

        const heartbeatTimer = setInterval(() => {
            this.sendHeartbeat(claimed.id, workerId, lockToken);
        }, 30_000);

        try {
            const storageBinding = this.extractStorageBindingFromPayload(job.data.payload);
            const executionPlan = this.extractExecutionPlanFromPayload(job.data.payload);
            const buildHealthPolicy = this.resolvePhaseRetryPolicy(executionPlan?.healthChecks?.build);
            const parsedSourceCheckout = this.extractSourceCheckoutFromPayload(job.data.payload);
            const runtimeRunner =
                (typeof executionPlan?.runner === "string" && executionPlan.runner.trim().length > 0
                    ? executionPlan.runner
                    : null) ?? this.extractRuntimeRunnerFromPayload(job.data.payload);
            const runtimeRunnerOptionsFromPayload =
                executionPlan?.runtimeRunnerOptions ?? this.extractRuntimeRunnerOptionsFromPayload(job.data.payload);
            const runtimeRunnerOptionsFromRuntimeConfiguration =
                this.extractRuntimeRunnerOptionsFromRuntimeConfiguration(job.data.payload);
            const runtimeRunnerOptions = this.mergeRuntimeRunnerOptions(
                runtimeRunnerOptionsFromPayload,
                runtimeRunnerOptionsFromRuntimeConfiguration,
            );
            const runtimeEnvironmentVariables =
                this.extractRuntimeEnvironmentVariablesFromRuntimeConfiguration(job.data.payload);
            const buildStartedAt = new Date();
            const containerImage = await this.resolveContainerImageWithPolicy({
                deploymentId: job.data.deploymentId,
                serviceId: job.data.serviceId,
                sourceCheckout: parsedSourceCheckout,
                executionPlan,
                fallbackContainerImage: this.extractContainerImageFromPayload(job.data.payload),
            }, buildHealthPolicy);
            const containerName = this.extractContainerNameFromPayload(job.data.payload);
            const buildCompletedAt = new Date();

            await this.deploymentService.completeQueueJob(claimed.id, {
                workerId,
                lockToken,
                result: {
                    bullJobId: String(job.id),
                    bullJobName: job.name,
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
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            try {
                this.deploymentService.failQueueJob(claimed.id, {
                    workerId,
                    lockToken,
                    error: message,
                    retryable: true,
                });
            } catch (failError) {
                const failMessage = failError instanceof Error ? failError.message : String(failError);
                this.logger.error(
                    `Queue failure transition also failed for lifecycle job '${claimed.id}': ${failMessage}`,
                );
            }

            throw error;
        } finally {
            clearInterval(heartbeatTimer);
        }
    }

    private extractSourceCheckoutFromPayload(payload: DeploymentBullJobPayload | undefined) {
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
    }): Promise<string | null> {
        if (!this.deploymentArtifactBuilderService) {
            throw new BadRequestError("DeploymentArtifactBuilderService is required for builder stage execution");
        }

        return this.deploymentArtifactBuilderService.buildContainerizedArtifact({
            deploymentId: input.deploymentId,
            serviceId: input.serviceId,
            builder: (input.executionPlan?.builder ?? null),
            sourceCheckout: input.sourceCheckout,
            fallbackContainerImage: input.fallbackContainerImage,
            customCommands: input.executionPlan?.customCommands ?? null,
        });
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
    ): Promise<string | null> {
        let lastError: unknown;

        for (let attempt = 1; attempt <= policy.maxRetries; attempt += 1) {
            try {
                return await this.resolveContainerImage(input);
            } catch (error) {
                lastError = error;

                if (attempt >= policy.maxRetries) {
                    break;
                }

                this.logger.warn(
                    `Build phase attempt ${String(attempt)}/${String(policy.maxRetries)} failed for deployment '${input.deploymentId}', retrying in ${String(policy.retryIntervalMs)}ms`,
                );
                await this.sleep(policy.retryIntervalMs);
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

    private sleep(delayMs: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, delayMs);
        });
    }

    private sendHeartbeat(jobId: string, workerId: string, lockToken: string): void {
        const heartbeat = this.deploymentService.heartbeatQueueJob(jobId, {
            workerId,
            lockToken,
            extendLeaseSec: 120,
        });

        if (!heartbeat.acknowledged) {
            this.logger.warn(`Heartbeat was not acknowledged for lifecycle job '${jobId}'`);
        }
    }

    private extractStorageBindingFromPayload(
        payload: DeploymentBullJobPayload | undefined,
    ): DeploymentStorageBinding | null {
        const storageCandidate = payload?.context?.storageBinding;
        const parsedStorageBinding = deploymentStorageBindingSchema.safeParse(storageCandidate);
        return parsedStorageBinding.success ? parsedStorageBinding.data : null;
    }

    private extractRuntimeRunnerFromPayload(
        payload: DeploymentBullJobPayload | undefined,
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
        payload: DeploymentBullJobPayload | undefined,
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

        return {
            ...fallback,
            ...primary,
            ...(fallback.dockerfile || primary.dockerfile
                ? {
                      dockerfile: {
                          ...(fallback.dockerfile ?? {}),
                          ...(primary.dockerfile ?? {}),
                      },
                  }
                : {}),
            ...(fallback.dockerCompose || primary.dockerCompose
                ? {
                      dockerCompose: {
                          ...(fallback.dockerCompose ?? {}),
                          ...(primary.dockerCompose ?? {}),
                      },
                  }
                : {}),
            ...(fallback.nixpacks || primary.nixpacks
                ? {
                      nixpacks: {
                          ...(fallback.nixpacks ?? {}),
                          ...(primary.nixpacks ?? {}),
                      },
                  }
                : {}),
            ...(fallback.buildpack || primary.buildpack
                ? {
                      buildpack: {
                          ...(fallback.buildpack ?? {}),
                          ...(primary.buildpack ?? {}),
                      },
                  }
                : {}),
            ...(fallback.railpack || primary.railpack
                ? {
                      railpack: {
                          ...(fallback.railpack ?? {}),
                          ...(primary.railpack ?? {}),
                      },
                  }
                : {}),
        };
    }

    private extractRuntimeConfigurationFromPayload(
        payload: DeploymentBullJobPayload | undefined,
    ): z.infer<typeof runtimeConfigurationContextSchema> | null {
        const parsedRuntimeConfiguration = runtimeConfigurationContextSchema.safeParse(
            payload?.context?.runtimeConfiguration,
        );

        return parsedRuntimeConfiguration.success ? parsedRuntimeConfiguration.data : null;
    }

    private extractRuntimeRunnerOptionsFromRuntimeConfiguration(
        payload: DeploymentBullJobPayload | undefined,
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

        const parsedOptions = runtimeRunnerOptionsSchema.safeParse({ networkMode });
        return parsedOptions.success ? parsedOptions.data : null;
    }

    private extractRuntimeEnvironmentVariablesFromRuntimeConfiguration(
        payload: DeploymentBullJobPayload | undefined,
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
        payload: DeploymentBullJobPayload | undefined,
    ): DeploymentExecutionPlan | null {
        const parsedExecutionPlan = executionPlanSchema.safeParse(payload?.context?.executionPlan);
        return parsedExecutionPlan.success ? parsedExecutionPlan.data : null;
    }

    private extractContainerImageFromPayload(
        payload: DeploymentBullJobPayload | undefined,
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
        payload: DeploymentBullJobPayload | undefined,
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