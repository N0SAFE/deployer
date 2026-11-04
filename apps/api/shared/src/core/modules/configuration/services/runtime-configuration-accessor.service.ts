import { Context, Effect } from "effect";

import { isRecord } from "@deployer/type-guards";

import {
    domainEnvironmentVariablesSchema,
    type ConfigurationScope,
    type ConfigurationProviderType,
    type ConfigurationRunnerType,
    type ProjectRuntimeConfig,
    type RequestedEnvironment,
    type ResolvedRuntimeConfiguration,
    type RuntimeConfigurationResolverInputByScope,
    type RuntimeConfigurationResolverScopedInput,
    runtimeStoragePolicySchema,
    type ServiceRuntimeConfig,
} from "../schemas/runtime-configuration.schema";

import type { RuntimeConfigurationInvalid } from "../configuration.errors";

import type { ConfigurationResolverServiceShape } from "./configuration-resolver.service";

const PROVIDER_TYPE_SET = new Set<ConfigurationProviderType>([
    "github",
    "gitlab",
    "git",
    "upload",
    "custom",
]);

const RUNNER_TYPE_SET = new Set<ConfigurationRunnerType>([
    "docker",
    "buildpack",
    "static",
    "custom",
]);

const PROVIDER_VALUES = [...PROVIDER_TYPE_SET.values()];
const RUNNER_VALUES = [...RUNNER_TYPE_SET.values()];

function toProviderType(value: string | null | undefined): ConfigurationProviderType {
    if (!value) {
        return "custom";
    }

    for (const providerType of PROVIDER_VALUES) {
        if (providerType === value) {
            return providerType;
        }
    }

    return "custom";
}

function toRunnerType(value: string | null | undefined): ConfigurationRunnerType {
    if (!value) {
        return "custom";
    }

    if (value === "dockerfile") {
        return "docker";
    }

    if (value === "nixpacks") {
        return "buildpack";
    }

    for (const runnerType of RUNNER_VALUES) {
        if (runnerType === value) {
            return runnerType;
        }
    }

    return "custom";
}

function parseCpuMillicores(value: string | null | undefined): number | undefined {
    if (!value) {
        return undefined;
    }

    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return undefined;
    }

    return Math.round(parsed * 1000);
}

function parseMemoryMb(value: string | null | undefined): number | undefined {
    if (!value) {
        return undefined;
    }

    const normalized = value.trim().toLowerCase();
    const match = new RegExp(/^(\d+(?:\.\d+)?)(kb|mb|gb|tb)?$/).exec(normalized);
    if (!match) {
        return undefined;
    }

    const amount = Number.parseFloat(match[1] ?? "0");
    const unit = match[2] ?? "mb";

    if (!Number.isFinite(amount) || amount <= 0) {
        return undefined;
    }

    const multipliers: Record<string, number> = {
        kb: 1 / 1024,
        mb: 1,
        gb: 1024,
        tb: 1024 * 1024,
    };

    return Math.round(amount * (multipliers[unit] ?? 1));
}

function toProjectRuntimeConfig(settings: Record<string, unknown> | null | undefined): ProjectRuntimeConfig {
    const source = settings ?? {};
    const deploymentStateMachine =
        typeof source.deploymentStateMachine === "object" && source.deploymentStateMachine !== null
            ? (isRecord(source.deploymentStateMachine) ? source.deploymentStateMachine : {})
            : undefined;

    const defaultEnvironmentVariables =
        source.defaultEnvironmentVariables && typeof source.defaultEnvironmentVariables === "object"
            ? domainEnvironmentVariablesSchema.safeParse(source.defaultEnvironmentVariables).data
            : undefined;

    const deploymentStrategy =
        source.deploymentStrategy === "rolling" ||
        source.deploymentStrategy === "blue_green" ||
        source.deploymentStrategy === "canary"
            ? source.deploymentStrategy
            : undefined;

    return {
        settings: {
            autoDeployEnabled:
                typeof source.autoDeployEnabled === "boolean" ? source.autoDeployEnabled : undefined,
            enablePreviewEnvironments:
                typeof source.enablePreviewEnvironments === "boolean"
                    ? source.enablePreviewEnvironments
                    : undefined,
            deploymentStrategy,
            requireApprovalForProduction:
                typeof source.requireApprovalForProduction === "boolean"
                    ? source.requireApprovalForProduction
                    : undefined,
            enableHttpsRedirect:
                typeof source.enableHttpsRedirect === "boolean"
                    ? source.enableHttpsRedirect
                    : undefined,
            defaultEnvironmentVariables,
        },
        ...(deploymentStateMachine
            ? {
                  metadata: {
                      deploymentStateMachine,
                  },
              }
            : {}),
    };
}

function toServiceRuntimeConfig(input: {
    providerId?: string | null;
    builderId?: string | null;
    customDomains?: string[] | null;
    environmentVariables?: Record<string, string> | null;
    metadata?: Record<string, unknown> | null;
    storage?: Record<string, unknown> | null;
    resourceLimits?: {
        memory?: string | null;
        cpu?: string | null;
    } | null;
    deploymentStateMachine?: Record<string, unknown> | null;
}): ServiceRuntimeConfig {
    const cpuMillicores = parseCpuMillicores(input.resourceLimits?.cpu);
    const memoryMb = parseMemoryMb(input.resourceLimits?.memory);

    const baseMetadata =
        input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
            ? input.metadata
            : undefined;

    const storageFromRecord = runtimeStoragePolicySchema.safeParse(input.storage).data;
    const storageFromCustomDataMetadata = runtimeStoragePolicySchema.safeParse(
        baseMetadata &&
            typeof baseMetadata.customData === "object" &&
            baseMetadata.customData !== null &&
            !Array.isArray(baseMetadata.customData)
            ? (isRecord(baseMetadata.customData) ? baseMetadata.customData : {}).storage
            : undefined,
    ).data;
    const storageFromTopLevelMetadata = runtimeStoragePolicySchema.safeParse(
        baseMetadata?.storage,
    ).data;
    const resolvedStoragePolicy =
        storageFromRecord ?? storageFromCustomDataMetadata ?? storageFromTopLevelMetadata;

    const mergedMetadata = {
        ...(baseMetadata ?? {}),
        ...(input.deploymentStateMachine
            ? {
                  deploymentStateMachine: input.deploymentStateMachine,
              }
            : {}),
    };
    const hasMetadata = Object.keys(mergedMetadata).length > 0;

    return {
        execution: {
            providerType: toProviderType(input.providerId),
            runnerType: toRunnerType(input.builderId),
        },
        routing: {
            domains: input.customDomains ?? undefined,
        },
        storage: resolvedStoragePolicy,
        environment: input.environmentVariables ?? undefined,
        resources:
            cpuMillicores || memoryMb
                ? {
                      ...(cpuMillicores ? { cpuMillicores } : {}),
                      ...(memoryMb ? { memoryMb } : {}),
                  }
                : undefined,
        ...(hasMetadata
            ? {
                  metadata: {
                      ...mergedMetadata,
                  },
              }
            : {}),
    };
}

type ServiceRecordInput = {
    providerId?: string | null;
    builderId?: string | null;
    customDomains?: string[] | null;
    environmentVariables?: Record<string, string> | null;
    metadata?: Record<string, unknown> | null;
    storage?: Record<string, unknown> | null;
    resourceLimits?: {
        memory?: string | null;
        cpu?: string | null;
    } | null;
    deploymentStateMachine?: Record<string, unknown> | null;
};

type Resolution = Effect.Effect<ResolvedRuntimeConfiguration, RuntimeConfigurationInvalid>;

/**
 * Facade over the configuration resolver that adapts project/service records into the runtime configuration shape. The
 * record → config mappers are pure, so they are plain reads; the resolutions are Effects failing with
 * `RuntimeConfigurationInvalid`.
 */
export type RuntimeConfigurationAccessorServiceShape = {
    readonly resolve: (input: RuntimeConfigurationResolverScopedInput) => Resolution;
    readonly resolveStrict: <TScope extends ConfigurationScope>(input: RuntimeConfigurationResolverInputByScope<TScope>) => Resolution;
    readonly resolveForDeployment: (input: {
        serviceId: string;
        projectId: string;
        environment: RequestedEnvironment;
        sourceType: string;
        projectSettings?: Record<string, unknown> | null;
        serviceRecord?: ServiceRecordInput;
    }) => Resolution;
    readonly projectConfigFromSettings: (settings: Record<string, unknown> | null | undefined) => ProjectRuntimeConfig;
    readonly serviceConfigFromRecord: (input: ServiceRecordInput) => ServiceRuntimeConfig;
};

export function makeRuntimeConfigurationAccessorService(resolver: ConfigurationResolverServiceShape): RuntimeConfigurationAccessorServiceShape {
    return {
        resolve: (input) => resolver.resolveStrict(input),
        resolveStrict: (input) => resolver.resolveStrict(input),

        resolveForDeployment: (input) =>
            resolver.resolveStrict({
                scope: "service",
                context: {
                    serviceId: input.serviceId,
                    projectId: input.projectId,
                    requestedEnvironment: input.environment,
                    sourceProvider: input.sourceType === "gitlab" ? "gitlab" : input.sourceType === "github" ? "github" : input.sourceType === "git" ? "git" : input.sourceType === "upload" ? "upload" : "custom",
                    requestedProviderType: toProviderType(input.serviceRecord?.providerId),
                    requestedRunnerType: toRunnerType(input.serviceRecord?.builderId),
                },
                project: toProjectRuntimeConfig(input.projectSettings),
                service: toServiceRuntimeConfig(input.serviceRecord ?? {}),
            }),

        projectConfigFromSettings: toProjectRuntimeConfig,
        serviceConfigFromRecord: toServiceRuntimeConfig,
    };
}

export class RuntimeConfigurationAccessorService extends Context.Service<
    RuntimeConfigurationAccessorService,
    RuntimeConfigurationAccessorServiceShape
>()("shared/RuntimeConfigurationAccessorService") {}
