import { Injectable } from "@nestjs/common";
import { ConfigurationDefinitionService } from "./configuration-definition.service";
import {
    resolvedRuntimeConfigurationSchema,
    runtimeConfigurationResolverInputSchema,
    type ConfigurationScope,
    type RuntimeConfigurationContext,
    type RuntimeConfigurationDispatchRule,
    type RuntimeConfigurationResolverInput,
    type RuntimeConfigurationResolverInputByScope,
    type RuntimeConfigurationResolverScopedInput,
    type ResolvedRuntimeConfiguration,
} from "../schemas/runtime-configuration.schema";

const ALL_PROVIDER_TYPES = ["github", "gitlab", "git", "upload", "custom"] as const;
const ALL_RUNNER_TYPES = ["docker", "buildpack", "static", "custom"] as const;
type LifecycleState = "draft" | "active" | "locked" | "deprecated";
type EnvironmentDomain =
    | "build"
    | "runtime"
    | "deployment"
    | "network"
    | "traefik"
    | "provider"
    | "runner"
    | "security";

const LIFECYCLE_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
    draft: ["active", "deprecated"],
    active: ["locked", "deprecated"],
    locked: ["active", "deprecated"],
    deprecated: [],
};

const ENVIRONMENT_DOMAINS: EnvironmentDomain[] = [
    "build",
    "runtime",
    "deployment",
    "network",
    "traefik",
    "provider",
    "runner",
    "security",
];

@Injectable()
export class ConfigurationResolverService {
    constructor(private readonly definitionService: ConfigurationDefinitionService) {}

    listDefinitions() {
        return this.definitionService.listDefinitions();
    }

    getDefinition(scope: RuntimeConfigurationResolverInput["scope"]) {
        return this.definitionService.getDefinition(scope);
    }

    private listConditionIncludes<T>(allowed: T[] | undefined, value: T | undefined): boolean {
        if (!allowed) {
            return true;
        }

        if (typeof value === "undefined") {
            return false;
        }

        return allowed.includes(value);
    }

    private withoutRecordKeys<TValue extends string | boolean>(
        record: Record<string, TValue>,
        keysToRemove: string[] | undefined,
    ): Record<string, TValue> {
        if (!keysToRemove || keysToRemove.length === 0) {
            return record;
        }

        const filtered: Record<string, TValue> = {};
        for (const [key, value] of Object.entries(record)) {
            if (!keysToRemove.includes(key)) {
                filtered[key] = value;
            }
        }

        return filtered;
    }

    private normalizeEnvironmentDomains(
        domains:
            | {
                  build?: Record<string, string>;
                  runtime?: Record<string, string>;
                  deployment?: Record<string, string>;
                  network?: Record<string, string>;
                  traefik?: Record<string, string>;
                  provider?: Record<string, string>;
                  runner?: Record<string, string>;
                  security?: Record<string, string>;
              }
            | undefined,
    ): ResolvedRuntimeConfiguration["effective"]["environmentDomains"] {
        return {
            build: domains?.build ?? {},
            runtime: domains?.runtime ?? {},
            deployment: domains?.deployment ?? {},
            network: domains?.network ?? {},
            traefik: domains?.traefik ?? {},
            provider: domains?.provider ?? {},
            runner: domains?.runner ?? {},
            security: domains?.security ?? {},
        };
    }

    private mergeEnvironmentDomains(
        ...layers: (
            | {
                  build?: Record<string, string>;
                  runtime?: Record<string, string>;
                  deployment?: Record<string, string>;
                  network?: Record<string, string>;
                  traefik?: Record<string, string>;
                  provider?: Record<string, string>;
                  runner?: Record<string, string>;
                  security?: Record<string, string>;
              }
            | undefined
        )[]
    ): ResolvedRuntimeConfiguration["effective"]["environmentDomains"] {
        const merged = this.normalizeEnvironmentDomains(undefined);

        for (const layer of layers) {
            if (!layer) {
                continue;
            }

            for (const domain of ENVIRONMENT_DOMAINS) {
                merged[domain] = {
                    ...merged[domain],
                    ...(layer[domain] ?? {}),
                };
            }
        }

        return merged;
    }

    private flattenEnvironmentDomains(
        domains: ResolvedRuntimeConfiguration["effective"]["environmentDomains"],
    ): Record<string, string> {
        return ENVIRONMENT_DOMAINS.reduce<Record<string, string>>((acc, domain) => {
            return {
                ...acc,
                ...domains[domain],
            };
        }, {});
    }

    private applyEnvironmentDomainPatch(
        current: ResolvedRuntimeConfiguration["effective"]["environmentDomains"],
        upserts:
            | {
                  build?: Record<string, string>;
                  runtime?: Record<string, string>;
                  deployment?: Record<string, string>;
                  network?: Record<string, string>;
                  traefik?: Record<string, string>;
                  provider?: Record<string, string>;
                  runner?: Record<string, string>;
                  security?: Record<string, string>;
              }
            | undefined,
        deletes:
            | {
                  build?: string[];
                  runtime?: string[];
                  deployment?: string[];
                  network?: string[];
                  traefik?: string[];
                  provider?: string[];
                  runner?: string[];
                  security?: string[];
              }
            | undefined,
    ): ResolvedRuntimeConfiguration["effective"]["environmentDomains"] {
        const merged = this.mergeEnvironmentDomains(current, upserts);

        for (const domain of ENVIRONMENT_DOMAINS) {
            merged[domain] = this.withoutRecordKeys(merged[domain], deletes?.[domain]);
        }

        return merged;
    }

    private resolveProviderFromSource(
        sourceProvider: RuntimeConfigurationContext["sourceProvider"],
    ): (typeof ALL_PROVIDER_TYPES)[number] {
        if (sourceProvider === "github") {
            return "github";
        }

        if (sourceProvider === "gitlab") {
            return "gitlab";
        }

        if (sourceProvider === "upload") {
            return "upload";
        }

        return "git";
    }

    private computeConstraints(
        context: RuntimeConfigurationContext,
        mesh: ResolvedRuntimeConfiguration["mesh"],
        project: ResolvedRuntimeConfiguration["project"],
        service: ResolvedRuntimeConfiguration["service"],
        effective: ResolvedRuntimeConfiguration["effective"],
    ): ResolvedRuntimeConfiguration["effective"]["constraints"] {
        const reasons: string[] = [];

        const canDeployToRequestedEnvironment =
            context.requestedEnvironment !== "preview" || effective.deployment.previewEnabled;

        if (!canDeployToRequestedEnvironment) {
            reasons.push("Preview deployments are disabled by resolved configuration");
        }

        const allowedProviders =
            project.allowedProviders ?? mesh.allowedProviders ?? [...ALL_PROVIDER_TYPES];
        const providerAllowed = allowedProviders.includes(effective.execution.providerType);
        if (!providerAllowed) {
            reasons.push(`Provider '${effective.execution.providerType}' is not allowed`);
        }

        const allowedRunners =
            project.allowedRunners ?? mesh.allowedRunners ?? [...ALL_RUNNER_TYPES];
        const runnerAllowed = allowedRunners.includes(effective.execution.runnerType);
        if (!runnerAllowed) {
            reasons.push(`Runner '${effective.execution.runnerType}' is not allowed`);
        }

        const projectReplicaLimit =
            project.maxReplicas ?? mesh.maxProjectReplicas ?? effective.replicas.max;

        const replicasWithinLimits =
            effective.replicas.min <= effective.replicas.desired &&
            effective.replicas.desired <= effective.replicas.max &&
            effective.replicas.desired <= projectReplicaLimit;

        if (!replicasWithinLimits) {
            reasons.push("Replica configuration exceeds allowed limits");
        }

        const cpuLimit =
            project.limits?.cpuMillicores ?? mesh.projectLimits?.cpuMillicores ?? null;
        const memoryLimit = project.limits?.memoryMb ?? mesh.projectLimits?.memoryMb ?? null;

        const resourcesWithinProjectLimits =
            (cpuLimit === null || effective.resources.cpuMillicores <= cpuLimit) &&
            (memoryLimit === null || effective.resources.memoryMb <= memoryLimit);

        if (!resourcesWithinProjectLimits) {
            reasons.push("Resource configuration exceeds project or global limits");
        }

        const requiredVariables = effective.envPolicy.required;
        const hasRequiredVariables = requiredVariables.every((name) => name in effective.environment);

        const denyList = effective.envPolicy.denyList;
        const hasDeniedVariables = denyList.some((name) => name in effective.environment);

        const allowList = effective.envPolicy.allowList;
        const allowListValid =
            allowList.length === 0 ||
            Object.keys(effective.environment).every((name) => allowList.includes(name));

        const envPolicyValid = hasRequiredVariables && !hasDeniedVariables && allowListValid;

        if (!envPolicyValid) {
            reasons.push("Environment variables violate service env policy");
        }

        const currentLifecycle =
            service.lifecycleState ?? project.lifecycleState ?? mesh.lifecycleState ?? "active";

        const lifecycleTransitionAllowed =
            typeof context.requestedLifecycleState === "undefined" ||
            LIFECYCLE_TRANSITIONS[currentLifecycle].includes(context.requestedLifecycleState);

        if (!lifecycleTransitionAllowed) {
            reasons.push("Requested lifecycle transition is not allowed");
        }

        const reason = reasons[0] ?? null;

        return {
            canDeployToRequestedEnvironment,
            providerAllowed,
            runnerAllowed,
            replicasWithinLimits,
            resourcesWithinProjectLimits,
            envPolicyValid,
            lifecycleTransitionAllowed,
            reason,
            reasons,
        };
    }

    private matchesRule(
        rule: RuntimeConfigurationDispatchRule,
        scope: ConfigurationScope,
        context: RuntimeConfigurationContext,
        effective: ResolvedRuntimeConfiguration["effective"],
    ): boolean {
        const condition = rule.when;

        if (!this.listConditionIncludes(condition.scopeIn, scope)) {
            return false;
        }

        if (
            !this.listConditionIncludes(
                condition.requestedEnvironmentIn,
                context.requestedEnvironment,
            )
        ) {
            return false;
        }

        if (!this.listConditionIncludes(condition.triggerIn, context.trigger)) {
            return false;
        }

        if (!this.listConditionIncludes(condition.sourceProviderIn, context.sourceProvider)) {
            return false;
        }

        if (
            !this.listConditionIncludes(condition.requestedProviderTypeIn, context.requestedProviderType)
        ) {
            return false;
        }

        if (!this.listConditionIncludes(condition.requestedRunnerTypeIn, context.requestedRunnerType)) {
            return false;
        }

        if (!this.listConditionIncludes(condition.actorRoleIn, context.actorRole)) {
            return false;
        }

        if (!this.listConditionIncludes(condition.projectIdIn, context.projectId)) {
            return false;
        }

        if (!this.listConditionIncludes(condition.serviceIdIn, context.serviceId)) {
            return false;
        }

        if (!this.listConditionIncludes(condition.userIdIn, context.userId)) {
            return false;
        }

        if (!this.listConditionIncludes(condition.branchNameIn, context.branchName)) {
            return false;
        }

        if (
            !this.listConditionIncludes(
                condition.requestedEnvironmentDomainIn,
                context.requestedEnvironmentDomain,
            )
        ) {
            return false;
        }

        if (condition.tagsAll) {
            const tags = context.tags ?? [];
            const hasAllTags = condition.tagsAll.every((tag) => tags.includes(tag));
            if (!hasAllTags) {
                return false;
            }
        }

        if (condition.attributesEquals) {
            const attributes = context.attributes ?? {};
            const hasAllAttributes = Object.entries(condition.attributesEquals).every(
                ([key, expectedValue]) => attributes[key] === expectedValue,
            );
            if (!hasAllAttributes) {
                return false;
            }
        }

        if (
            !this.listConditionIncludes(
                condition.effectiveDeploymentStrategyIn,
                effective.deployment.strategy,
            )
        ) {
            return false;
        }

        if (!this.listConditionIncludes(condition.effectiveProviderTypeIn, effective.execution.providerType)) {
            return false;
        }

        if (!this.listConditionIncludes(condition.effectiveRunnerTypeIn, effective.execution.runnerType)) {
            return false;
        }

        if (!this.listConditionIncludes(condition.effectiveLifecycleStateIn, effective.lifecycle.current)) {
            return false;
        }

        if (
            typeof condition.effectivePreviewEnabled !== "undefined" &&
            condition.effectivePreviewEnabled !== effective.deployment.previewEnabled
        ) {
            return false;
        }

        if (
            typeof condition.effectiveAutoDeployEnabled !== "undefined" &&
            condition.effectiveAutoDeployEnabled !== effective.deployment.autoDeployEnabled
        ) {
            return false;
        }

        return true;
    }

    private domainEnvironmentUpsertsFromMutation(
        domain: EnvironmentDomain,
        upserts: Record<string, string> | undefined,
    ):
        | {
              build?: Record<string, string>;
              runtime?: Record<string, string>;
              deployment?: Record<string, string>;
              network?: Record<string, string>;
              traefik?: Record<string, string>;
              provider?: Record<string, string>;
              runner?: Record<string, string>;
              security?: Record<string, string>;
          }
        | undefined {
        if (!upserts) {
            return undefined;
        }

        switch (domain) {
            case "build":
                return { build: upserts };
            case "runtime":
                return { runtime: upserts };
            case "deployment":
                return { deployment: upserts };
            case "network":
                return { network: upserts };
            case "traefik":
                return { traefik: upserts };
            case "provider":
                return { provider: upserts };
            case "runner":
                return { runner: upserts };
            case "security":
                return { security: upserts };
        }
    }

    private domainEnvironmentDeletesFromMutation(
        domain: EnvironmentDomain,
        deletes: string[] | undefined,
    ):
        | {
              build?: string[];
              runtime?: string[];
              deployment?: string[];
              network?: string[];
              traefik?: string[];
              provider?: string[];
              runner?: string[];
              security?: string[];
          }
        | undefined {
        if (!deletes || deletes.length === 0) {
            return undefined;
        }

        switch (domain) {
            case "build":
                return { build: deletes };
            case "runtime":
                return { runtime: deletes };
            case "deployment":
                return { deployment: deletes };
            case "network":
                return { network: deletes };
            case "traefik":
                return { traefik: deletes };
            case "provider":
                return { provider: deletes };
            case "runner":
                return { runner: deletes };
            case "security":
                return { security: deletes };
        }
    }

    private applyRulePatch(
        effective: ResolvedRuntimeConfiguration["effective"],
        rule: RuntimeConfigurationDispatchRule,
    ): {
        effective: ResolvedRuntimeConfiguration["effective"];
        touchedConstraints: boolean;
    } {
        const patch = rule.apply;

        const nextEnvironment = {
            ...effective.environment,
            ...(patch.environmentUpserts ?? {}),
        };

        const filteredEnvironment = this.withoutRecordKeys(
            nextEnvironment,
            patch.environmentDeletes,
        );

        const nextFeatureFlags = {
            ...effective.featureFlags,
            ...(patch.featureFlagUpserts ?? {}),
        };

        const filteredFeatureFlags = this.withoutRecordKeys(
            nextFeatureFlags,
            patch.featureFlagDeletes,
        );

        const nextEnvironmentDomains = this.applyEnvironmentDomainPatch(
            effective.environmentDomains,
            patch.environmentDomainUpserts,
            patch.environmentDomainDeletes,
        );

        let mutatedEnvironmentDomains = nextEnvironmentDomains;
        let mutatedEnvironment = filteredEnvironment;

        for (const mutation of patch.environmentMutations ?? []) {
            if (mutation.mode === "flat") {
                mutatedEnvironment = this.withoutRecordKeys(
                    {
                        ...mutatedEnvironment,
                        ...(mutation.upserts ?? {}),
                    },
                    mutation.deletes,
                );
                continue;
            }

            mutatedEnvironmentDomains = this.applyEnvironmentDomainPatch(
                mutatedEnvironmentDomains,
                this.domainEnvironmentUpsertsFromMutation(mutation.domain, mutation.upserts),
                this.domainEnvironmentDeletesFromMutation(mutation.domain, mutation.deletes),
            );
        }

        const flattenedEnvironment = {
            ...this.flattenEnvironmentDomains(mutatedEnvironmentDomains),
            ...mutatedEnvironment,
        };

        return {
            touchedConstraints: typeof patch.constraints !== "undefined",
            effective: {
                deployment: {
                    ...effective.deployment,
                    ...(patch.deployment ?? {}),
                },
                routing: {
                    ...effective.routing,
                    ...(patch.routing ?? {}),
                },
                execution: {
                    ...effective.execution,
                    ...(patch.execution ?? {}),
                },
                replicas: {
                    ...effective.replicas,
                    ...(patch.replicas ?? {}),
                },
                resources: {
                    ...effective.resources,
                    ...(patch.resources ?? {}),
                },
                envPolicy: {
                    ...effective.envPolicy,
                    ...(patch.envPolicy ?? {}),
                },
                traefik: {
                    ...effective.traefik,
                    ...(patch.traefik ?? {}),
                    tls: {
                        ...effective.traefik.tls,
                        ...(patch.traefik?.tls ?? {}),
                    },
                },
                lifecycle: {
                    ...effective.lifecycle,
                    ...(patch.lifecycle ?? {}),
                },
                environmentDomains: mutatedEnvironmentDomains,
                environment: flattenedEnvironment,
                featureFlags: filteredFeatureFlags,
                constraints: {
                    ...effective.constraints,
                    ...(patch.constraints ?? {}),
                },
            },
        };
    }

    resolve(input: RuntimeConfigurationResolverInput): ResolvedRuntimeConfiguration {
        const parsedInput = runtimeConfigurationResolverInputSchema.parse(input);

        const mesh = {
            deployment: {
                defaultStrategy: parsedInput.mesh?.deployment?.defaultStrategy ?? "rolling",
                enforceHttpsRedirect:
                    parsedInput.mesh?.deployment?.enforceHttpsRedirect ?? true,
                previewEnabled: parsedInput.mesh?.deployment?.previewEnabled ?? true,
            },
            allowedProviders: parsedInput.mesh?.allowedProviders,
            allowedRunners: parsedInput.mesh?.allowedRunners,
            projectLimits: parsedInput.mesh?.projectLimits,
            maxProjectReplicas: parsedInput.mesh?.maxProjectReplicas,
            traefik: parsedInput.mesh?.traefik,
            lifecycleState: parsedInput.mesh?.lifecycleState,
            environmentByDomain: parsedInput.mesh?.environmentByDomain,
            environment: parsedInput.mesh?.environment ?? {},
            featureFlags: parsedInput.mesh?.featureFlags ?? {},
            metadata: parsedInput.mesh?.metadata ?? {},
        };

        const project = {
            settings: {
                autoDeployEnabled: parsedInput.project?.settings?.autoDeployEnabled,
                enablePreviewEnvironments:
                    parsedInput.project?.settings?.enablePreviewEnvironments,
                deploymentStrategy: parsedInput.project?.settings?.deploymentStrategy,
                requireApprovalForProduction:
                    parsedInput.project?.settings?.requireApprovalForProduction,
                enableHttpsRedirect: parsedInput.project?.settings?.enableHttpsRedirect,
                defaultEnvironmentVariables:
                    parsedInput.project?.settings?.defaultEnvironmentVariables,
            },
            allowedProviders: parsedInput.project?.allowedProviders,
            allowedRunners: parsedInput.project?.allowedRunners,
            limits: parsedInput.project?.limits,
            maxReplicas: parsedInput.project?.maxReplicas,
            traefik: parsedInput.project?.traefik,
            lifecycleState: parsedInput.project?.lifecycleState,
            environmentByDomain: parsedInput.project?.environmentByDomain,
            environment: parsedInput.project?.environment ?? {},
            featureFlags: parsedInput.project?.featureFlags ?? {},
            metadata: parsedInput.project?.metadata ?? {},
        };

        const service = {
            deployment: {
                strategy: parsedInput.service?.deployment?.strategy,
                autoDeployEnabled: parsedInput.service?.deployment?.autoDeployEnabled,
            },
            execution: {
                providerType: parsedInput.service?.execution?.providerType,
                runnerType: parsedInput.service?.execution?.runnerType,
            },
            resources: {
                cpuMillicores: parsedInput.service?.resources?.cpuMillicores,
                memoryMb: parsedInput.service?.resources?.memoryMb,
            },
            replicas: {
                min: parsedInput.service?.replicas?.min,
                desired: parsedInput.service?.replicas?.desired,
                max: parsedInput.service?.replicas?.max,
            },
            envPolicy: {
                required: parsedInput.service?.envPolicy?.required ?? [],
                allowList: parsedInput.service?.envPolicy?.allowList ?? [],
                denyList: parsedInput.service?.envPolicy?.denyList ?? [],
            },
            traefik: parsedInput.service?.traefik,
            lifecycleState: parsedInput.service?.lifecycleState,
            environmentByDomain: parsedInput.service?.environmentByDomain,
            routing: {
                forceHttps: parsedInput.service?.routing?.forceHttps,
                domains: parsedInput.service?.routing?.domains ?? [],
            },
            environment: parsedInput.service?.environment ?? {},
            featureFlags: parsedInput.service?.featureFlags ?? {},
            metadata: parsedInput.service?.metadata ?? {},
        };

        const user = {
            environmentOverrides: parsedInput.user?.environmentOverrides ?? {},
            featureFlagOverrides: parsedInput.user?.featureFlagOverrides ?? {},
            deployment: {
                autoDeployEnabled: parsedInput.user?.deployment?.autoDeployEnabled,
                previewEnabled: parsedInput.user?.deployment?.previewEnabled,
            },
            preferredExecution: parsedInput.user?.preferredExecution,
            preferredTraefik: parsedInput.user?.preferredTraefik,
            environmentByDomainOverrides: parsedInput.user?.environmentByDomainOverrides,
            metadata: parsedInput.user?.metadata ?? {},
        };

        const strategy =
            service.deployment.strategy ??
            project.settings.deploymentStrategy ??
            mesh.deployment.defaultStrategy;

        const autoDeployEnabled =
            user.deployment.autoDeployEnabled ??
            service.deployment.autoDeployEnabled ??
            project.settings.autoDeployEnabled ??
            true;

        const previewEnabled =
            user.deployment.previewEnabled ??
            project.settings.enablePreviewEnvironments ??
            mesh.deployment.previewEnabled;

        const requireApprovalForProduction = project.settings.requireApprovalForProduction ?? false;

        const forceHttps =
            service.routing.forceHttps ??
            project.settings.enableHttpsRedirect ??
            mesh.deployment.enforceHttpsRedirect;

        const environmentDomains = this.mergeEnvironmentDomains(
            mesh.environmentByDomain,
            project.environmentByDomain,
            service.environmentByDomain,
            user.environmentByDomainOverrides,
        );

        const environment = {
            ...this.flattenEnvironmentDomains(environmentDomains),
            ...mesh.environment,
            ...(project.settings.defaultEnvironmentVariables ?? {}),
            ...project.environment,
            ...service.environment,
            ...user.environmentOverrides,
        };

        const featureFlags = {
            ...mesh.featureFlags,
            ...project.featureFlags,
            ...service.featureFlags,
            ...user.featureFlagOverrides,
        };

        const providerType =
            parsedInput.context.requestedProviderType ??
            user.preferredExecution?.providerType ??
            service.execution.providerType ??
            this.resolveProviderFromSource(parsedInput.context.sourceProvider);

        const runnerType =
            parsedInput.context.requestedRunnerType ??
            user.preferredExecution?.runnerType ??
            service.execution.runnerType ??
            "docker";

        const minReplicas = service.replicas.min ?? 1;
        const maxReplicas =
            service.replicas.max ?? project.maxReplicas ?? mesh.maxProjectReplicas ?? 10;
        const desiredReplicas =
            parsedInput.context.requestedReplicas ?? service.replicas.desired ?? minReplicas;

        const cpuMillicores =
            parsedInput.context.requestedResources?.cpuMillicores ??
            service.resources.cpuMillicores ??
            project.limits?.cpuMillicores ??
            mesh.projectLimits?.cpuMillicores ??
            500;

        const memoryMb =
            parsedInput.context.requestedResources?.memoryMb ??
            service.resources.memoryMb ??
            project.limits?.memoryMb ??
            mesh.projectLimits?.memoryMb ??
            512;

        const mergedTraefik = {
            ...(mesh.traefik ?? {}),
            ...(project.traefik ?? {}),
            ...(service.traefik ?? {}),
            ...(user.preferredTraefik ?? {}),
        };

        const lifecycleCurrent =
            parsedInput.context.requestedLifecycleState ??
            service.lifecycleState ??
            project.lifecycleState ??
            mesh.lifecycleState ??
            "active";

        let effective: ResolvedRuntimeConfiguration["effective"] = {
            deployment: {
                strategy,
                autoDeployEnabled,
                previewEnabled,
                requireApprovalForProduction,
            },
            routing: {
                forceHttps,
                domains: service.routing.domains,
            },
            execution: {
                providerType,
                runnerType,
            },
            replicas: {
                min: minReplicas,
                desired: desiredReplicas,
                max: maxReplicas,
            },
            resources: {
                cpuMillicores,
                memoryMb,
            },
            envPolicy: {
                required: service.envPolicy.required,
                allowList: service.envPolicy.allowList,
                denyList: service.envPolicy.denyList,
            },
            environmentDomains,
            traefik: {
                enabled: mergedTraefik.enabled ?? true,
                entryPoints: mergedTraefik.entryPoints ?? ["web", "websecure"],
                middlewares: mergedTraefik.middlewares ?? [],
                stripPrefix: mergedTraefik.stripPrefix ?? null,
                domains: mergedTraefik.domains ?? service.routing.domains,
                tls: {
                    enabled: mergedTraefik.tls?.enabled ?? forceHttps,
                    resolver: mergedTraefik.tls?.resolver ?? null,
                },
            },
            lifecycle: {
                current: lifecycleCurrent,
                allowedNextStates: [...LIFECYCLE_TRANSITIONS[lifecycleCurrent]],
            },
            environment,
            featureFlags,
            constraints: {
                canDeployToRequestedEnvironment: true,
                providerAllowed: true,
                runnerAllowed: true,
                replicasWithinLimits: true,
                resourcesWithinProjectLimits: true,
                envPolicyValid: true,
                lifecycleTransitionAllowed: true,
                reason: null,
                reasons: [],
            },
        };

        effective = {
            ...effective,
            constraints: this.computeConstraints(parsedInput.context, mesh, project, service, effective),
        };

        const dispatchRules = [...(parsedInput.dispatch?.rules ?? [])]
            .filter((rule) => rule.enabled)
            .sort((a, b) => a.priority - b.priority);

        const appliedRuleIds: string[] = [];
        let touchedConstraints = false;

        for (const rule of dispatchRules) {
            if (!this.matchesRule(rule, parsedInput.scope, parsedInput.context, effective)) {
                continue;
            }

            const patched = this.applyRulePatch(effective, rule);
            effective = patched.effective;
            touchedConstraints = touchedConstraints || patched.touchedConstraints;
            appliedRuleIds.push(rule.id);
        }

        if (!touchedConstraints) {
            effective = {
                ...effective,
                constraints: this.computeConstraints(parsedInput.context, mesh, project, service, effective),
            };
        }

        return resolvedRuntimeConfigurationSchema.parse({
            scope: parsedInput.scope,
            context: parsedInput.context,
            mesh,
            project,
            service,
            user,
            effective,
            dispatchAudit: {
                evaluatedRules: dispatchRules.length,
                appliedRuleIds,
            },
        });
    }

    resolveStrict(input: RuntimeConfigurationResolverInputByScope<"project">): ResolvedRuntimeConfiguration;
    resolveStrict(input: RuntimeConfigurationResolverInputByScope<"service">): ResolvedRuntimeConfiguration;
    resolveStrict(input: RuntimeConfigurationResolverInputByScope<"user">): ResolvedRuntimeConfiguration;
    resolveStrict(input: RuntimeConfigurationResolverScopedInput): ResolvedRuntimeConfiguration;
    resolveStrict(input: RuntimeConfigurationResolverScopedInput): ResolvedRuntimeConfiguration {
        return this.resolve(input);
    }

    resolveForProject(
        input: Omit<RuntimeConfigurationResolverInputByScope<"project">, "scope">,
    ): ResolvedRuntimeConfiguration {
        return this.resolveStrict({ ...input, scope: "project" });
    }

    resolveForService(
        input: Omit<RuntimeConfigurationResolverInputByScope<"service">, "scope">,
    ): ResolvedRuntimeConfiguration {
        return this.resolveStrict({ ...input, scope: "service" });
    }

    resolveForUser(
        input: Omit<RuntimeConfigurationResolverInputByScope<"user">, "scope">,
    ): ResolvedRuntimeConfiguration {
        return this.resolveStrict({ ...input, scope: "user" });
    }
}
