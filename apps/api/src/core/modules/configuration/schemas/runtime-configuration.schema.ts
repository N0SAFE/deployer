import z from "zod/v4";

export const configurationScopeSchema = z.enum(["organization", "project", "service", "user"]);
export type ConfigurationScope = z.infer<typeof configurationScopeSchema>;

export const requestedEnvironmentSchema = z.enum([
    "production",
    "staging",
    "preview",
    "development",
]);
export type RequestedEnvironment = z.infer<typeof requestedEnvironmentSchema>;

export const configurationTriggerSchema = z.enum(["manual", "auto", "webhook", "schedule"]);

export const configurationSourceProviderSchema = z.enum([
    "git",
    "github",
    "gitlab",
    "upload",
    "custom",
]);

export const configurationStrategySchema = z.enum(["rolling", "blue_green", "canary"]);
export const configurationProviderTypeSchema = z.enum([
    "github",
    "gitlab",
    "git",
    "upload",
    "custom",
]);
export type ConfigurationProviderType = z.infer<typeof configurationProviderTypeSchema>;
export const configurationRunnerTypeSchema = z.enum(["docker", "buildpack", "static", "custom"]);
export type ConfigurationRunnerType = z.infer<typeof configurationRunnerTypeSchema>;
export const configurationLifecycleStateSchema = z.enum([
    "draft",
    "active",
    "locked",
    "deprecated",
]);
export type ConfigurationLifecycleState = z.infer<typeof configurationLifecycleStateSchema>;
export const configurationEnvironmentDomainSchema = z.enum([
    "build",
    "runtime",
    "deployment",
    "network",
    "traefik",
    "provider",
    "runner",
    "security",
]);

export const primitiveAttributeValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const domainEnvironmentVariablesSchema = z.record(z.string(), z.string());
export type DomainEnvironmentVariables = z.infer<typeof domainEnvironmentVariablesSchema>;
export const runtimeEnvironmentByDomainSchema = z.object({
    build: domainEnvironmentVariablesSchema.optional(),
    runtime: domainEnvironmentVariablesSchema.optional(),
    deployment: domainEnvironmentVariablesSchema.optional(),
    network: domainEnvironmentVariablesSchema.optional(),
    traefik: domainEnvironmentVariablesSchema.optional(),
    provider: domainEnvironmentVariablesSchema.optional(),
    runner: domainEnvironmentVariablesSchema.optional(),
    security: domainEnvironmentVariablesSchema.optional(),
});

export const runtimeEnvironmentByDomainEffectiveSchema = z.object({
    build: domainEnvironmentVariablesSchema,
    runtime: domainEnvironmentVariablesSchema,
    deployment: domainEnvironmentVariablesSchema,
    network: domainEnvironmentVariablesSchema,
    traefik: domainEnvironmentVariablesSchema,
    provider: domainEnvironmentVariablesSchema,
    runner: domainEnvironmentVariablesSchema,
    security: domainEnvironmentVariablesSchema,
});

export const runtimeEnvironmentByDomainDeletesSchema = z.object({
    build: z.array(z.string()).optional(),
    runtime: z.array(z.string()).optional(),
    deployment: z.array(z.string()).optional(),
    network: z.array(z.string()).optional(),
    traefik: z.array(z.string()).optional(),
    provider: z.array(z.string()).optional(),
    runner: z.array(z.string()).optional(),
    security: z.array(z.string()).optional(),
});

export const runtimeEnvironmentMutationFlatSchema = z.object({
    mode: z.literal("flat"),
    upserts: domainEnvironmentVariablesSchema.optional(),
    deletes: z.array(z.string()).optional(),
});

export const runtimeEnvironmentMutationDomainSchema = z.object({
    mode: z.literal("domain"),
    domain: configurationEnvironmentDomainSchema,
    upserts: domainEnvironmentVariablesSchema.optional(),
    deletes: z.array(z.string()).optional(),
});

export const runtimeEnvironmentMutationSchema = z.discriminatedUnion("mode", [
    runtimeEnvironmentMutationFlatSchema,
    runtimeEnvironmentMutationDomainSchema,
]);
export type RuntimeEnvironmentMutationInput = z.input<typeof runtimeEnvironmentMutationSchema>;

export const runtimeResourcesSchema = z.object({
    cpuMillicores: z.number().int().positive().optional(),
    memoryMb: z.number().int().positive().optional(),
});

export const runtimeReplicasSchema = z.object({
    min: z.number().int().min(0).optional(),
    desired: z.number().int().min(0).optional(),
    max: z.number().int().min(0).optional(),
});

export const runtimeTraefikTlsSchema = z.object({
    enabled: z.boolean().optional(),
    resolver: z.string().optional(),
});

export const runtimeTraefikConfigSchema = z.object({
    enabled: z.boolean().optional(),
    entryPoints: z.array(z.string()).optional(),
    middlewares: z.array(z.string()).optional(),
    stripPrefix: z.string().optional(),
    domains: z.array(z.string()).optional(),
    tls: runtimeTraefikTlsSchema.optional(),
});

export const runtimeEnvPolicySchema = z.object({
    required: z.array(z.string()).optional(),
    allowList: z.array(z.string()).optional(),
    denyList: z.array(z.string()).optional(),
});

export const runtimeExecutionSpecSchema = z.object({
    providerType: configurationProviderTypeSchema.optional(),
    runnerType: configurationRunnerTypeSchema.optional(),
});

export const runtimeStorageTypeSchema = z.enum(["local", "s3", "nfs", "volume"]);
export type RuntimeStorageType = z.infer<typeof runtimeStorageTypeSchema>;

const runtimeStoragePolicyBaseSchema = z
    .object({
        autoRedeployOnUpdate: z.boolean().optional(),
        mountPath: z.string().min(1).optional(),
    })
    .loose();

const runtimeLocalStoragePolicySchema = runtimeStoragePolicyBaseSchema
    .extend({
        type: z.literal("local"),
        local: z
            .object({
                rootPath: z.string().min(1).optional(),
                watchPath: z.string().min(1).optional(),
            })
            .optional(),
    })
    .loose();

const runtimeS3StoragePolicySchema = runtimeStoragePolicyBaseSchema
    .extend({
        type: z.literal("s3"),
        s3: z
            .object({
                bucket: z.string().min(1).optional(),
                region: z.string().min(1).optional(),
                endpoint: z.string().min(1).optional(),
                prefix: z.string().min(1).optional(),
            })
            .optional(),
    })
    .loose();

const runtimeNfsStoragePolicySchema = runtimeStoragePolicyBaseSchema
    .extend({
        type: z.literal("nfs"),
        nfs: z
            .object({
                server: z.string().min(1).optional(),
                exportPath: z.string().min(1).optional(),
                readOnly: z.boolean().optional(),
            })
            .optional(),
    })
    .loose();

const runtimeVolumeStoragePolicySchema = runtimeStoragePolicyBaseSchema
    .extend({
        type: z.literal("volume"),
        volume: z
            .object({
                volumeName: z.string().min(1).optional(),
                driver: z.string().min(1).optional(),
            })
            .optional(),
    })
    .loose();

const runtimeStoragePolicyWithoutTypeSchema = z
    .object({
        type: z.undefined().optional(),
        autoRedeployOnUpdate: z.boolean().optional(),
        mountPath: z.string().min(1).optional(),
        local: z
            .object({
                rootPath: z.string().min(1).optional(),
                watchPath: z.string().min(1).optional(),
            })
            .optional(),
        s3: z
            .object({
                bucket: z.string().min(1).optional(),
                region: z.string().min(1).optional(),
                endpoint: z.string().min(1).optional(),
                prefix: z.string().min(1).optional(),
            })
            .optional(),
        nfs: z
            .object({
                server: z.string().min(1).optional(),
                exportPath: z.string().min(1).optional(),
                readOnly: z.boolean().optional(),
            })
            .optional(),
        volume: z
            .object({
                volumeName: z.string().min(1).optional(),
                driver: z.string().min(1).optional(),
            })
            .optional(),
    })
    .loose();

export const runtimeStoragePolicyDiscriminatedSchema = z.discriminatedUnion("type", [
    runtimeLocalStoragePolicySchema,
    runtimeS3StoragePolicySchema,
    runtimeNfsStoragePolicySchema,
    runtimeVolumeStoragePolicySchema,
]);

export const runtimeStoragePolicySchema = z.union([
    runtimeStoragePolicyDiscriminatedSchema,
    runtimeStoragePolicyWithoutTypeSchema,
]);
export type RuntimeStoragePolicy = z.infer<typeof runtimeStoragePolicySchema>;

export const organizationDeploymentConfigSchema = z.object({
    defaultStrategy: configurationStrategySchema.optional(),
    enforceHttpsRedirect: z.boolean().optional(),
    previewEnabled: z.boolean().optional(),
});

export const organizationRuntimeConfigSchema = z
    .object({
        deployment: organizationDeploymentConfigSchema.optional(),
        allowedProviders: z.array(configurationProviderTypeSchema).optional(),
        allowedRunners: z.array(configurationRunnerTypeSchema).optional(),
        projectLimits: runtimeResourcesSchema.optional(),
        maxProjectReplicas: z.number().int().min(0).optional(),
        traefik: runtimeTraefikConfigSchema.optional(),
        lifecycleState: configurationLifecycleStateSchema.optional(),
        environmentByDomain: runtimeEnvironmentByDomainSchema.optional(),
        environment: z.record(z.string(), z.string()).optional(),
        featureFlags: z.record(z.string(), z.boolean()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .partial();
export type OrganizationRuntimeConfig = z.infer<typeof organizationRuntimeConfigSchema>;

export const projectSettingsRuntimeConfigSchema = z.object({
    autoDeployEnabled: z.boolean().optional(),
    enablePreviewEnvironments: z.boolean().optional(),
    deploymentStrategy: configurationStrategySchema.optional(),
    requireApprovalForProduction: z.boolean().optional(),
    enableHttpsRedirect: z.boolean().optional(),
    defaultEnvironmentVariables: z.record(z.string(), z.string()).optional(),
});

export const projectRuntimeConfigSchema = z
    .object({
        settings: projectSettingsRuntimeConfigSchema.optional(),
        allowedProviders: z.array(configurationProviderTypeSchema).optional(),
        allowedRunners: z.array(configurationRunnerTypeSchema).optional(),
        limits: runtimeResourcesSchema.optional(),
        maxReplicas: z.number().int().min(0).optional(),
        traefik: runtimeTraefikConfigSchema.optional(),
        lifecycleState: configurationLifecycleStateSchema.optional(),
        environmentByDomain: runtimeEnvironmentByDomainSchema.optional(),
        environment: z.record(z.string(), z.string()).optional(),
        featureFlags: z.record(z.string(), z.boolean()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .partial();
export type ProjectRuntimeConfig = z.infer<typeof projectRuntimeConfigSchema>;

export const serviceDeploymentRuntimeConfigSchema = z.object({
    strategy: configurationStrategySchema.optional(),
    autoDeployEnabled: z.boolean().optional(),
});

export const serviceRoutingRuntimeConfigSchema = z.object({
    forceHttps: z.boolean().optional(),
    domains: z.array(z.string()).optional(),
});

export const serviceRuntimeConfigSchema = z
    .object({
        deployment: serviceDeploymentRuntimeConfigSchema.optional(),
        execution: runtimeExecutionSpecSchema.optional(),
        storage: runtimeStoragePolicySchema.optional(),
        resources: runtimeResourcesSchema.optional(),
        replicas: runtimeReplicasSchema.optional(),
        envPolicy: runtimeEnvPolicySchema.optional(),
        traefik: runtimeTraefikConfigSchema.optional(),
        lifecycleState: configurationLifecycleStateSchema.optional(),
        environmentByDomain: runtimeEnvironmentByDomainSchema.optional(),
        routing: serviceRoutingRuntimeConfigSchema.optional(),
        environment: z.record(z.string(), z.string()).optional(),
        featureFlags: z.record(z.string(), z.boolean()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .partial();
export type ServiceRuntimeConfig = z.infer<typeof serviceRuntimeConfigSchema>;

export const userDeploymentRuntimeConfigSchema = z.object({
    autoDeployEnabled: z.boolean().optional(),
    previewEnabled: z.boolean().optional(),
});

export const userRuntimeConfigSchema = z
    .object({
        environmentOverrides: z.record(z.string(), z.string()).optional(),
        featureFlagOverrides: z.record(z.string(), z.boolean()).optional(),
        deployment: userDeploymentRuntimeConfigSchema.optional(),
        preferredExecution: runtimeExecutionSpecSchema.optional(),
        preferredTraefik: runtimeTraefikConfigSchema.optional(),
        environmentByDomainOverrides: runtimeEnvironmentByDomainSchema.optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .partial();
export type UserRuntimeConfig = z.infer<typeof userRuntimeConfigSchema>;

export const runtimeDeploymentEffectiveSchema = z.object({
    strategy: configurationStrategySchema,
    autoDeployEnabled: z.boolean(),
    previewEnabled: z.boolean(),
    requireApprovalForProduction: z.boolean(),
});

export const runtimeRoutingEffectiveSchema = z.object({
    forceHttps: z.boolean(),
    domains: z.array(z.string()),
});

export const runtimeExecutionEffectiveSchema = z.object({
    providerType: configurationProviderTypeSchema,
    runnerType: configurationRunnerTypeSchema,
});

export const runtimeReplicasEffectiveSchema = z.object({
    min: z.number().int().min(0),
    desired: z.number().int().min(0),
    max: z.number().int().min(0),
});

export const runtimeResourcesEffectiveSchema = z.object({
    cpuMillicores: z.number().int().positive(),
    memoryMb: z.number().int().positive(),
});

export const runtimeEnvPolicyEffectiveSchema = z.object({
    required: z.array(z.string()),
    allowList: z.array(z.string()),
    denyList: z.array(z.string()),
});

export const runtimeTraefikTlsEffectiveSchema = z.object({
    enabled: z.boolean(),
    resolver: z.string().nullable(),
});

export const runtimeTraefikEffectiveSchema = z.object({
    enabled: z.boolean(),
    entryPoints: z.array(z.string()),
    middlewares: z.array(z.string()),
    stripPrefix: z.string().nullable(),
    domains: z.array(z.string()),
    tls: runtimeTraefikTlsEffectiveSchema,
});

export const runtimeLifecycleEffectiveSchema = z.object({
    current: configurationLifecycleStateSchema,
    allowedNextStates: z.array(configurationLifecycleStateSchema),
});

export const runtimeConstraintsEffectiveSchema = z.object({
    canDeployToRequestedEnvironment: z.boolean(),
    providerAllowed: z.boolean(),
    runnerAllowed: z.boolean(),
    replicasWithinLimits: z.boolean(),
    resourcesWithinProjectLimits: z.boolean(),
    envPolicyValid: z.boolean(),
    lifecycleTransitionAllowed: z.boolean(),
    reason: z.string().nullable(),
    reasons: z.array(z.string()),
});

export const runtimeConfigurationContextSchema = z
    .object({
        organizationId: z.string().optional(),
        projectId: z.string().optional(),
        serviceId: z.string().optional(),
        userId: z.string().optional(),
        requestedEnvironment: requestedEnvironmentSchema.optional(),
        trigger: configurationTriggerSchema.optional(),
        sourceProvider: configurationSourceProviderSchema.optional(),
        requestedProviderType: configurationProviderTypeSchema.optional(),
        requestedRunnerType: configurationRunnerTypeSchema.optional(),
        actorRole: z.string().optional(),
        branchName: z.string().optional(),
        requestedReplicas: z.number().int().min(0).optional(),
        requestedResources: runtimeResourcesSchema.optional(),
        requestedLifecycleState: configurationLifecycleStateSchema.optional(),
        requestedEnvironmentDomain: configurationEnvironmentDomainSchema.optional(),
        tags: z.array(z.string()).optional(),
        attributes: z.record(z.string(), primitiveAttributeValueSchema).optional(),
    })
    .partial()
    .default({});
export type RuntimeConfigurationContext = z.infer<typeof runtimeConfigurationContextSchema>;

export const runtimeConfigurationDispatchConditionSchema = z
    .object({
        scopeIn: z.array(configurationScopeSchema).optional(),
        requestedEnvironmentIn: z.array(requestedEnvironmentSchema).optional(),
        triggerIn: z.array(configurationTriggerSchema).optional(),
        sourceProviderIn: z.array(configurationSourceProviderSchema).optional(),
        requestedProviderTypeIn: z.array(configurationProviderTypeSchema).optional(),
        requestedRunnerTypeIn: z.array(configurationRunnerTypeSchema).optional(),
        actorRoleIn: z.array(z.string()).optional(),
        organizationIdIn: z.array(z.string()).optional(),
        projectIdIn: z.array(z.string()).optional(),
        serviceIdIn: z.array(z.string()).optional(),
        userIdIn: z.array(z.string()).optional(),
        branchNameIn: z.array(z.string()).optional(),
        tagsAll: z.array(z.string()).optional(),
        attributesEquals: z.record(z.string(), primitiveAttributeValueSchema).optional(),
        effectiveDeploymentStrategyIn: z.array(configurationStrategySchema).optional(),
        effectivePreviewEnabled: z.boolean().optional(),
        effectiveAutoDeployEnabled: z.boolean().optional(),
        effectiveProviderTypeIn: z.array(configurationProviderTypeSchema).optional(),
        effectiveRunnerTypeIn: z.array(configurationRunnerTypeSchema).optional(),
        effectiveLifecycleStateIn: z.array(configurationLifecycleStateSchema).optional(),
        requestedEnvironmentDomainIn: z.array(configurationEnvironmentDomainSchema).optional(),
    })
    .partial()
    .default({});
export type RuntimeConfigurationDispatchConditionInput = z.input<
    typeof runtimeConfigurationDispatchConditionSchema
>;

export const runtimeConfigurationDispatchPatchSchema = z
    .object({
        deployment: runtimeDeploymentEffectiveSchema.partial().optional(),
        routing: runtimeRoutingEffectiveSchema.partial().optional(),
        execution: runtimeExecutionEffectiveSchema.partial().optional(),
        replicas: runtimeReplicasEffectiveSchema.partial().optional(),
        resources: runtimeResourcesEffectiveSchema.partial().optional(),
        envPolicy: runtimeEnvPolicyEffectiveSchema.partial().optional(),
        traefik: runtimeTraefikEffectiveSchema
            .omit({ tls: true })
            .partial()
            .extend({
                tls: runtimeTraefikTlsEffectiveSchema.partial().optional(),
            })
            .optional(),
        lifecycle: runtimeLifecycleEffectiveSchema.partial().optional(),
        environmentDomainUpserts: runtimeEnvironmentByDomainSchema.optional(),
        environmentDomainDeletes: runtimeEnvironmentByDomainDeletesSchema.optional(),
        environmentUpserts: z.record(z.string(), z.string()).optional(),
        environmentDeletes: z.array(z.string()).optional(),
        environmentMutations: z.array(runtimeEnvironmentMutationSchema).optional(),
        featureFlagUpserts: z.record(z.string(), z.boolean()).optional(),
        featureFlagDeletes: z.array(z.string()).optional(),
        constraints: runtimeConstraintsEffectiveSchema.partial().optional(),
    })
    .partial();
export type RuntimeConfigurationDispatchPatchInput = z.input<
    typeof runtimeConfigurationDispatchPatchSchema
>;

export const runtimeConfigurationDispatchRuleSchema = z.object({
    id: z.string().min(1),
    description: z.string().optional(),
    enabled: z.boolean().default(true),
    priority: z.number().int().default(0),
    when: runtimeConfigurationDispatchConditionSchema.default({}),
    apply: runtimeConfigurationDispatchPatchSchema,
});

export const runtimeConfigurationDispatchSchema = z.object({
    rules: z.array(runtimeConfigurationDispatchRuleSchema).default([]),
});
export type RuntimeConfigurationDispatchRule = z.infer<typeof runtimeConfigurationDispatchRuleSchema>;
export type RuntimeConfigurationDispatchRuleInput = z.input<
    typeof runtimeConfigurationDispatchRuleSchema
>;

export const runtimeConfigurationStateNodeSchema = z.object({
    scope: configurationScopeSchema,
    lifecycleState: configurationLifecycleStateSchema,
    description: z.string().optional(),
    dependsOnScopes: z.array(configurationScopeSchema).default([]),
    allowedProviderTypes: z.array(configurationProviderTypeSchema).default([]),
    allowedRunnerTypes: z.array(configurationRunnerTypeSchema).default([]),
});
export type RuntimeConfigurationStateNodeInput = z.input<
    typeof runtimeConfigurationStateNodeSchema
>;

export const runtimeConfigurationStateTransitionSchema = z.object({
    from: configurationLifecycleStateSchema,
    to: configurationLifecycleStateSchema,
    when: runtimeConfigurationDispatchConditionSchema.default({}),
    description: z.string().optional(),
});
export type RuntimeConfigurationStateTransitionInput = z.input<
    typeof runtimeConfigurationStateTransitionSchema
>;

export const runtimeConfigurationStateMachineSchema = z.object({
    nodes: z.array(runtimeConfigurationStateNodeSchema).default([]),
    transitions: z.array(runtimeConfigurationStateTransitionSchema).default([]),
    dispatch: runtimeConfigurationDispatchSchema.default({ rules: [] }),
});
export type RuntimeConfigurationStateMachine = z.infer<typeof runtimeConfigurationStateMachineSchema>;

export const runtimeConfigurationResolverInputSchema = z.object({
    scope: configurationScopeSchema,
    context: runtimeConfigurationContextSchema,
    organization: organizationRuntimeConfigSchema.optional(),
    project: projectRuntimeConfigSchema.optional(),
    service: serviceRuntimeConfigSchema.optional(),
    user: userRuntimeConfigSchema.optional(),
    dispatch: runtimeConfigurationDispatchSchema.optional(),
});
export type RuntimeConfigurationResolverInput = z.input<typeof runtimeConfigurationResolverInputSchema>;

interface RuntimeConfigurationResolverSharedInput {
    dispatch?: z.input<typeof runtimeConfigurationDispatchSchema>;
}

interface RuntimeConfigurationContextByScopeMap {
    organization: RuntimeConfigurationContext & {
        organizationId: string;
    };
    project: RuntimeConfigurationContext & {
        projectId: string;
    };
    service: RuntimeConfigurationContext & {
        projectId: string;
        serviceId: string;
    };
    user: RuntimeConfigurationContext & {
        userId: string;
    };
}

export type RuntimeConfigurationContextByScope<TScope extends ConfigurationScope> =
    RuntimeConfigurationContextByScopeMap[TScope];

interface RuntimeConfigurationResolverInputByScopeMap {
    organization: RuntimeConfigurationResolverSharedInput & {
        scope: "organization";
        context: RuntimeConfigurationContextByScope<"organization">;
        organization: OrganizationRuntimeConfig;
        project?: ProjectRuntimeConfig;
        service?: ServiceRuntimeConfig;
        user?: UserRuntimeConfig;
    };
    project: RuntimeConfigurationResolverSharedInput & {
        scope: "project";
        context: RuntimeConfigurationContextByScope<"project">;
        organization?: OrganizationRuntimeConfig;
        project: ProjectRuntimeConfig;
        service?: ServiceRuntimeConfig;
        user?: UserRuntimeConfig;
    };
    service: RuntimeConfigurationResolverSharedInput & {
        scope: "service";
        context: RuntimeConfigurationContextByScope<"service">;
        organization?: OrganizationRuntimeConfig;
        project?: ProjectRuntimeConfig;
        service: ServiceRuntimeConfig;
        user?: UserRuntimeConfig;
    };
    user: RuntimeConfigurationResolverSharedInput & {
        scope: "user";
        context: RuntimeConfigurationContextByScope<"user">;
        organization?: OrganizationRuntimeConfig;
        project?: ProjectRuntimeConfig;
        service?: ServiceRuntimeConfig;
        user: UserRuntimeConfig;
    };
}

export type RuntimeConfigurationResolverInputByScope<TScope extends ConfigurationScope> =
    RuntimeConfigurationResolverInputByScopeMap[TScope];
export type RuntimeConfigurationResolverScopedInput =
    RuntimeConfigurationResolverInputByScopeMap[keyof RuntimeConfigurationResolverInputByScopeMap];

export const resolvedRuntimeConfigurationSchema = z.object({
    scope: configurationScopeSchema,
    context: runtimeConfigurationContextSchema,
    organization: organizationRuntimeConfigSchema,
    project: projectRuntimeConfigSchema,
    service: serviceRuntimeConfigSchema,
    user: userRuntimeConfigSchema,
    effective: z.object({
        deployment: runtimeDeploymentEffectiveSchema,
        routing: runtimeRoutingEffectiveSchema,
        execution: runtimeExecutionEffectiveSchema,
        replicas: runtimeReplicasEffectiveSchema,
        resources: runtimeResourcesEffectiveSchema,
        envPolicy: runtimeEnvPolicyEffectiveSchema,
        traefik: runtimeTraefikEffectiveSchema,
        lifecycle: runtimeLifecycleEffectiveSchema,
        environmentDomains: runtimeEnvironmentByDomainEffectiveSchema,
        environment: z.record(z.string(), z.string()),
        featureFlags: z.record(z.string(), z.boolean()),
        constraints: runtimeConstraintsEffectiveSchema,
    }),
    dispatchAudit: z.object({
        evaluatedRules: z.number().int().nonnegative(),
        appliedRuleIds: z.array(z.string()),
    }),
});
export type ResolvedRuntimeConfiguration = z.infer<typeof resolvedRuntimeConfigurationSchema>;
