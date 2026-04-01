import { Injectable } from "@nestjs/common";
import z from "zod/v4";

export const deploymentProviderKindSchema = z.enum(["github", "upload", "custom"]);
export type DeploymentProviderKind = z.infer<typeof deploymentProviderKindSchema>;

export const deploymentBuilderKindSchema = z.enum([
    "dockerfile",
    "docker_compose",
    "nixpacks",
    "buildpack",
    "railpack",
    "external",
]);
export type DeploymentBuilderKind = z.infer<typeof deploymentBuilderKindSchema>;

export const deploymentRunnerKindSchema = z.enum([
    "docker",
    "dockerfile",
    "docker_compose",
    "nixpacks",
    "buildpack",
    "railpack",
]);
export type DeploymentRunnerKind = z.infer<typeof deploymentRunnerKindSchema>;

export const deploymentExecutionStateMachineInputSchema = z.object({
    provider: deploymentProviderKindSchema,
    builder: deploymentBuilderKindSchema.nullable(),
    runner: deploymentRunnerKindSchema.nullable(),
    hasContainerImage: z.boolean().default(false),
    hasCustomBuildCommand: z.boolean().default(false),
    hasCustomRunCommand: z.boolean().default(false),
});

export type DeploymentExecutionStateMachineInput = z.infer<typeof deploymentExecutionStateMachineInputSchema>;

export interface DeploymentExecutionStateMachineViolation {
    code: string;
    message: string;
}

export interface DeploymentExecutionStateMachineResolution {
    canProceed: boolean;
    normalizedBuilder: DeploymentBuilderKind | null;
    normalizedRunner: DeploymentRunnerKind | null;
    violations: DeploymentExecutionStateMachineViolation[];
}

const deploymentEnvironmentSchema = z.enum(["production", "staging", "preview", "development"]);
export type DeploymentEnvironment = z.infer<typeof deploymentEnvironmentSchema>;

const deploymentStrategySchema = z.enum(["rolling", "blue_green", "canary"]);
type DeploymentStrategy = z.infer<typeof deploymentStrategySchema>;

const rollbackStatusSchema = z.enum(["pending", "queued", "building", "deploying", "success", "failed", "cancelled"]);
type RollbackStatus = z.infer<typeof rollbackStatusSchema>;

const previewOperationSchema = z.enum(["create", "cleanup"]);
type PreviewOperation = z.infer<typeof previewOperationSchema>;

const deploymentStateMachinePolicySchema = z.object({
    deployment: z.object({
        managedCommandBuilders: z.array(deploymentBuilderKindSchema).default(["nixpacks", "buildpack", "railpack"]),
        autoNormalizeBuilderForCustomCommands: z.boolean().default(true),
        customProvider: z.object({
            forceExternalBuilder: z.boolean().default(true),
            requirePrebuiltImage: z.boolean().default(true),
            allowCustomCommands: z.boolean().default(false),
        }).default({ forceExternalBuilder: true, requirePrebuiltImage: true, allowCustomCommands: false }),
    }).default({
        managedCommandBuilders: ["nixpacks", "buildpack", "railpack"],
        autoNormalizeBuilderForCustomCommands: true,
        customProvider: {
            forceExternalBuilder: true,
            requirePrebuiltImage: true,
            allowCustomCommands: false,
        },
    }),
    rollback: z.object({
        enabled: z.boolean().default(true),
        allowedSourceStatuses: z.array(rollbackStatusSchema).default([
            "pending",
            "queued",
            "building",
            "deploying",
            "success",
            "failed",
            "cancelled",
        ]),
        allowedTargetStatuses: z.array(rollbackStatusSchema).default(["success"]),
        allowCrossEnvironmentRollback: z.boolean().default(true),
        blockedEnvironments: z.array(deploymentEnvironmentSchema).default([]),
        strategyByEnvironment: z.partialRecord(deploymentEnvironmentSchema, deploymentStrategySchema).default({}),
    }).default({
        enabled: true,
        allowedSourceStatuses: [
            "pending",
            "queued",
            "building",
            "deploying",
            "success",
            "failed",
            "cancelled",
        ],
        allowedTargetStatuses: ["success"],
        allowCrossEnvironmentRollback: true,
        blockedEnvironments: [],
        strategyByEnvironment: {},
    }),
    preview: z.object({
        createEnabled: z.boolean().default(true),
        cleanupEnabled: z.boolean().default(true),
        allowedEnvironments: z.array(deploymentEnvironmentSchema).default(["preview"]),
        requireResolvedPreviewFlag: z.boolean().default(true),
    }).default({
        createEnabled: true,
        cleanupEnabled: true,
        allowedEnvironments: ["preview"],
        requireResolvedPreviewFlag: true,
    }),
});

type DeploymentStateMachinePolicy = z.infer<typeof deploymentStateMachinePolicySchema>;
const deploymentStateMachinePolicyPatchSchema = z.object({
    deployment: z.object({
        managedCommandBuilders: z.array(deploymentBuilderKindSchema).optional(),
        autoNormalizeBuilderForCustomCommands: z.boolean().optional(),
        customProvider: z.object({
            forceExternalBuilder: z.boolean().optional(),
            requirePrebuiltImage: z.boolean().optional(),
            allowCustomCommands: z.boolean().optional(),
        }).optional(),
    }).optional(),
    rollback: z.object({
        enabled: z.boolean().optional(),
        allowedSourceStatuses: z.array(rollbackStatusSchema).optional(),
        allowedTargetStatuses: z.array(rollbackStatusSchema).optional(),
        allowCrossEnvironmentRollback: z.boolean().optional(),
        blockedEnvironments: z.array(deploymentEnvironmentSchema).optional(),
        strategyByEnvironment: z.partialRecord(deploymentEnvironmentSchema, deploymentStrategySchema).optional(),
    }).optional(),
    preview: z.object({
        createEnabled: z.boolean().optional(),
        cleanupEnabled: z.boolean().optional(),
        allowedEnvironments: z.array(deploymentEnvironmentSchema).optional(),
        requireResolvedPreviewFlag: z.boolean().optional(),
    }).optional(),
});
type DeploymentStateMachinePolicyPatchInput = z.input<typeof deploymentStateMachinePolicyPatchSchema>;

const deploymentStateMachineScopeConfigSchema = z.object({
    organization: deploymentStateMachinePolicyPatchSchema.optional(),
    project: deploymentStateMachinePolicyPatchSchema.optional(),
    service: deploymentStateMachinePolicyPatchSchema.optional(),
    runtime: z.object({
        previewEnabled: z.boolean().optional(),
        deploymentStrategy: deploymentStrategySchema.optional(),
    }).optional(),
});

export type DeploymentStateMachineScopeConfigInput = z.input<typeof deploymentStateMachineScopeConfigSchema>;

const rollbackTransitionInputSchema = z.object({
    sourceStatus: rollbackStatusSchema,
    targetStatus: rollbackStatusSchema,
    sourceEnvironment: deploymentEnvironmentSchema,
    targetEnvironment: deploymentEnvironmentSchema,
});

export type RollbackTransitionInput = z.infer<typeof rollbackTransitionInputSchema>;

export interface RollbackTransitionResolution {
    canProceed: boolean;
    strategy: DeploymentStrategy;
    violations: DeploymentExecutionStateMachineViolation[];
}

const previewTransitionInputSchema = z.object({
    operation: previewOperationSchema,
    environment: deploymentEnvironmentSchema,
    resolvedPreviewEnabled: z.boolean().optional(),
});

export type PreviewTransitionInput = z.infer<typeof previewTransitionInputSchema>;

export interface PreviewTransitionResolution {
    canProceed: boolean;
    violations: DeploymentExecutionStateMachineViolation[];
}

@Injectable()
export class DeploymentProviderBuilderRunnerStateMachineService {
    evaluate(
        input: DeploymentExecutionStateMachineInput,
        scopeConfig?: DeploymentStateMachineScopeConfigInput,
    ): DeploymentExecutionStateMachineResolution {
        const policy = this.resolvePolicy(scopeConfig);
        const parsedInput = deploymentExecutionStateMachineInputSchema.parse(input);
        const hasCustomCommands = parsedInput.hasCustomBuildCommand || parsedInput.hasCustomRunCommand;

        const violations: DeploymentExecutionStateMachineViolation[] = [];
        let normalizedBuilder = parsedInput.builder;
        const normalizedRunner = parsedInput.runner;

        const managedCommandCapableBuilders = new Set(policy.deployment.managedCommandBuilders);

        if (parsedInput.provider === "custom") {
            if (hasCustomCommands && !policy.deployment.customProvider.allowCustomCommands) {
                violations.push({
                    code: "CUSTOM_PROVIDER_NO_COMMAND_BUILD",
                    message:
                        "Docker registry/custom provider uses prebuilt images and does not support custom build/run commands.",
                });
            }

            if (
                policy.deployment.customProvider.forceExternalBuilder &&
                parsedInput.builder &&
                parsedInput.builder !== "external"
            ) {
                violations.push({
                    code: "CUSTOM_PROVIDER_BUILDER_MUST_BE_EXTERNAL",
                    message:
                        "When provider is docker registry/custom, builder must be 'external' (prebuilt image) or omitted.",
                });
            }

            if (policy.deployment.customProvider.requirePrebuiltImage && !parsedInput.hasContainerImage) {
                violations.push({
                    code: "CUSTOM_PROVIDER_REQUIRES_IMAGE",
                    message: "Docker registry/custom provider requires a prebuilt container image.",
                });
            }

            if (policy.deployment.customProvider.forceExternalBuilder && !normalizedBuilder) {
                normalizedBuilder = "external";
            }
        }

        if (normalizedRunner === "dockerfile" && !parsedInput.hasContainerImage && !normalizedBuilder) {
            violations.push({
                code: "DOCKERFILE_RUNNER_REQUIRES_ARTIFACT",
                message:
                    "Runtime runner 'dockerfile' requires a built/prebuilt image (execution.builder or container image).",
            });
        }

        if (hasCustomCommands) {
            if (!normalizedBuilder && policy.deployment.autoNormalizeBuilderForCustomCommands) {
                // platform-managed command builder mode (custom Dockerfile generated by platform)
                normalizedBuilder = "dockerfile";
            } else if (!normalizedBuilder || !managedCommandCapableBuilders.has(normalizedBuilder)) {
                violations.push({
                    code: "CUSTOM_COMMAND_UNSUPPORTED_BUILDER",
                    message:
                        `Custom build/run commands are allowed only for platform-managed builders (${Array.from(managedCommandCapableBuilders).join(", ")}) or command-driven custom builder mode.`,
                });
            }
        }

        return {
            canProceed: violations.length === 0,
            normalizedBuilder,
            normalizedRunner,
            violations,
        };
    }

    evaluateRollbackTransition(
        input: RollbackTransitionInput,
        scopeConfig?: DeploymentStateMachineScopeConfigInput,
    ): RollbackTransitionResolution {
        const parsedInput = rollbackTransitionInputSchema.parse(input);
        const policy = this.resolvePolicy(scopeConfig);
        const violations: DeploymentExecutionStateMachineViolation[] = [];

        if (!policy.rollback.enabled) {
            violations.push({
                code: "ROLLBACK_DISABLED",
                message: "Rollback is disabled by deployment state-machine policy.",
            });
        }

        if (!policy.rollback.allowedSourceStatuses.includes(parsedInput.sourceStatus)) {
            violations.push({
                code: "ROLLBACK_SOURCE_STATUS_BLOCKED",
                message: `Rollback is not allowed from status '${parsedInput.sourceStatus}'.`,
            });
        }

        if (!policy.rollback.allowedTargetStatuses.includes(parsedInput.targetStatus)) {
            violations.push({
                code: "ROLLBACK_TARGET_STATUS_BLOCKED",
                message: `Rollback target must be in statuses: ${policy.rollback.allowedTargetStatuses.join(", ")}.`,
            });
        }

        if (policy.rollback.blockedEnvironments.includes(parsedInput.sourceEnvironment)) {
            violations.push({
                code: "ROLLBACK_SOURCE_ENVIRONMENT_BLOCKED",
                message: `Rollback is blocked for environment '${parsedInput.sourceEnvironment}'.`,
            });
        }

        if (policy.rollback.blockedEnvironments.includes(parsedInput.targetEnvironment)) {
            violations.push({
                code: "ROLLBACK_TARGET_ENVIRONMENT_BLOCKED",
                message: `Rollback target environment '${parsedInput.targetEnvironment}' is blocked.`,
            });
        }

        if (
            !policy.rollback.allowCrossEnvironmentRollback &&
            parsedInput.sourceEnvironment !== parsedInput.targetEnvironment
        ) {
            violations.push({
                code: "ROLLBACK_CROSS_ENVIRONMENT_BLOCKED",
                message: "Cross-environment rollback is disabled by deployment state-machine policy.",
            });
        }

        const strategy =
            policy.rollback.strategyByEnvironment[parsedInput.sourceEnvironment] ??
            policy.rollback.strategyByEnvironment[parsedInput.targetEnvironment] ??
            scopeConfig?.runtime?.deploymentStrategy ??
            "rolling";

        return {
            canProceed: violations.length === 0,
            strategy,
            violations,
        };
    }

    evaluatePreviewTransition(
        input: PreviewTransitionInput,
        scopeConfig?: DeploymentStateMachineScopeConfigInput,
    ): PreviewTransitionResolution {
        const parsedInput = previewTransitionInputSchema.parse(input);
        const policy = this.resolvePolicy(scopeConfig);
        const violations: DeploymentExecutionStateMachineViolation[] = [];

        if (parsedInput.operation === "create" && !policy.preview.createEnabled) {
            violations.push({
                code: "PREVIEW_CREATE_DISABLED",
                message: "Preview deployment creation is disabled by deployment state-machine policy.",
            });
        }

        if (parsedInput.operation === "cleanup" && !policy.preview.cleanupEnabled) {
            violations.push({
                code: "PREVIEW_CLEANUP_DISABLED",
                message: "Preview deployment cleanup is disabled by deployment state-machine policy.",
            });
        }

        if (!policy.preview.allowedEnvironments.includes(parsedInput.environment)) {
            violations.push({
                code: "PREVIEW_ENVIRONMENT_BLOCKED",
                message: `Preview operation is not allowed for environment '${parsedInput.environment}'.`,
            });
        }

        if (
            policy.preview.requireResolvedPreviewFlag &&
            parsedInput.operation === "create" &&
            parsedInput.resolvedPreviewEnabled === false
        ) {
            violations.push({
                code: "PREVIEW_RUNTIME_FLAG_DISABLED",
                message: "Preview deployments are disabled by resolved runtime configuration.",
            });
        }

        return {
            canProceed: violations.length === 0,
            violations,
        };
    }

    resolvePolicy(scopeConfig?: DeploymentStateMachineScopeConfigInput): DeploymentStateMachinePolicy {
        const parsed = deploymentStateMachineScopeConfigSchema.safeParse(scopeConfig ?? {});
        const scopedConfig = parsed.success ? parsed.data : {};

        const mergedPolicy = this.mergePolicy(
            deploymentStateMachinePolicySchema.parse({}),
            scopedConfig.organization,
            scopedConfig.project,
            scopedConfig.service,
        );

        return deploymentStateMachinePolicySchema.parse(mergedPolicy);
    }

    private mergePolicy(
        basePolicy: DeploymentStateMachinePolicy,
        ...patches: (DeploymentStateMachinePolicyPatchInput | undefined)[]
    ): DeploymentStateMachinePolicy {
        let currentPolicy = basePolicy;
        for (const patchCandidate of patches) {
            if (!patchCandidate) {
                continue;
            }

            const patch = deploymentStateMachinePolicyPatchSchema.parse(patchCandidate);
            currentPolicy = {
                deployment: {
                    ...currentPolicy.deployment,
                    ...(patch.deployment ?? {}),
                    customProvider: {
                        ...currentPolicy.deployment.customProvider,
                        ...(patch.deployment?.customProvider ?? {}),
                    },
                },
                rollback: {
                    ...currentPolicy.rollback,
                    ...(patch.rollback ?? {}),
                    strategyByEnvironment: {
                        ...currentPolicy.rollback.strategyByEnvironment,
                        ...(patch.rollback?.strategyByEnvironment ?? {}),
                    },
                },
                preview: {
                    ...currentPolicy.preview,
                    ...(patch.preview ?? {}),
                },
            };
        }

        return currentPolicy;
    }
}
