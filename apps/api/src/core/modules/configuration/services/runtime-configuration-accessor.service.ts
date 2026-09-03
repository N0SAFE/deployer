import { Injectable } from "@nestjs/common";
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
import { ConfigurationDefinitionService } from "./configuration-definition.service";
import { ConfigurationResolverService } from "./configuration-resolver.service";
import { isRecord } from "@repo/type-guards";

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

/**
 * Injectable facade over `ConfigurationResolverService` that adapts
 * project/service records into the runtime configuration shape.
 *
 * Replaces the former module-level singleton `runtimeConfigurationAccessor`
 * (service-locator anti-pattern) with a proper DI provider so consumers
 * declare their dependency explicitly and tests can mock it.
 */
@Injectable()
export class RuntimeConfigurationAccessorService {
    constructor(private readonly resolver: ConfigurationResolverService) {}

    resolve(input: RuntimeConfigurationResolverScopedInput): ResolvedRuntimeConfiguration {
        return this.resolver.resolveStrict(input);
    }

    resolveStrict<TScope extends ConfigurationScope>(
        input: RuntimeConfigurationResolverInputByScope<TScope>,
    ): ResolvedRuntimeConfiguration {
        return this.resolver.resolveStrict(input);
    }

    resolveForDeployment(input: {
        serviceId: string;
        projectId: string;
        environment: RequestedEnvironment;
        sourceType: string;
        projectSettings?: Record<string, unknown> | null;
        serviceRecord?: {
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
    }): ResolvedRuntimeConfiguration {
        return this.resolver.resolveStrict({
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
        });
    }

    projectConfigFromSettings(settings: Record<string, unknown> | null | undefined): ProjectRuntimeConfig {
        return toProjectRuntimeConfig(settings);
    }

    serviceConfigFromRecord(input: {
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
        return toServiceRuntimeConfig(input);
    }
}