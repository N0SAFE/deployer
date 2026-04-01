import z from "zod/v4";
import { providersCatalog } from "@repo/provider-schema/catalog";
import { buildersCatalog } from "@repo/provider-schema/catalog";

export const templateKindSchema = z.enum([
    "provider",
    "build",
    "deploy",
    "route",
    "preview",
    "dependency",
]);
export type TemplateKind = z.infer<typeof templateKindSchema>;

export const templateScopeSchema = z.enum(["global", "provider", "project", "environment", "run"]);
export type TemplateScope = z.infer<typeof templateScopeSchema>;

export const templateStatusSchema = z.enum(["draft", "active", "deprecated", "archived"]);
export type TemplateStatus = z.infer<typeof templateStatusSchema>;

export const templateVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, {
    message: "Template version must follow semver (e.g. 1.0.0)",
});

const nonEmptyString = z.string().min(1);
const providerIds = providersCatalog.map((provider: { id: string }) => provider.id);
const builderIds = buildersCatalog.map((builder: { id: string }) => builder.id);

if (providerIds.length === 0) {
    throw new Error("Provider catalog must not be empty when building template contracts.");
}

export const providerIdSchema = z.enum(providerIds as [string, ...string[]]);

if (builderIds.length === 0) {
    throw new Error("Builder catalog must not be empty when building template contracts.");
}

export const builderIdSchema = z.enum(builderIds as [string, ...string[]]);

const retryPolicySchema = z.object({
    maxAttempts: z.number().int().min(0).max(20).default(3),
    backoffMs: z.number().int().min(0).max(600_000).default(2_000),
});

export const providerTemplateConfigSchema = z.object({
    provider: providerIdSchema,
    defaultBranch: z.string().min(1).default("main"),
    webhookEvents: z.array(z.enum(["push", "pull_request", "tag", "release"])).default(["push"]),
    supportsPreview: z.boolean().default(true),
    secretRefs: z.array(nonEmptyString).default([]),
});
export type ProviderTemplateConfig = z.infer<typeof providerTemplateConfigSchema>;

export const buildTemplateConfigSchema = z.object({
    strategy: z.enum(["dockerfile", "nixpacks", "buildpacks", "custom"]),
    contextDir: nonEmptyString.default("."),
    dockerfilePath: z.string().optional(),
    installCommand: z.string().optional(),
    buildCommand: z.string().optional(),
    outputDir: z.string().optional(),
    cacheEnabled: z.boolean().default(true),
    envAllowlist: z.array(nonEmptyString).default([]),
});
export type BuildTemplateConfig = z.infer<typeof buildTemplateConfigSchema>;

export const deployTemplateConfigSchema = z.object({
    strategy: z.enum(["recreate", "rolling", "blue_green", "canary"]),
    maxUnavailable: z.number().int().min(0).max(100).default(1),
    maxSurge: z.number().int().min(0).max(100).default(1),
    healthCheckPath: z.string().default("/health"),
    healthCheckTimeoutSec: z.number().int().min(1).max(300).default(60),
    deploymentTimeoutSec: z.number().int().min(10).max(7_200).default(600),
    rollbackOnFailure: z.boolean().default(true),
});
export type DeployTemplateConfig = z.infer<typeof deployTemplateConfigSchema>;

export const deployStrategySchema = deployTemplateConfigSchema.shape.strategy;
export type DeployStrategy = z.infer<typeof deployStrategySchema>;

export const templateEnvironmentSchema = z.enum(["development", "preview", "staging", "production"]);
export type TemplateEnvironment = z.infer<typeof templateEnvironmentSchema>;

export const routeTemplateConfigSchema = z.object({
    hostPattern: nonEmptyString,
    entrypoints: z.array(z.enum(["web", "websecure"])).default(["websecure"]),
    tlsEnabled: z.boolean().default(true),
    tlsResolver: z.string().default("letsencrypt"),
    middlewares: z.array(nonEmptyString).default([]),
    healthProbeEnabled: z.boolean().default(true),
});
export type RouteTemplateConfig = z.infer<typeof routeTemplateConfigSchema>;

export const previewTemplateConfigSchema = z.object({
    urlPattern: nonEmptyString,
    namingStrategy: z.enum(["pr", "branch", "branch_hash", "custom"]),
    ttlHours: z.number().int().min(1).max(24 * 90).default(168),
    autoDeleteOnMerge: z.boolean().default(true),
    autoDeleteOnClose: z.boolean().default(true),
    envOverlayStrategy: z.enum(["inherit", "merge", "replace"]).default("merge"),
});
export type PreviewTemplateConfig = z.infer<typeof previewTemplateConfigSchema>;

export const dependencyTemplateConfigSchema = z.object({
    orderingStrategy: z.enum(["topological", "explicit", "hybrid"]).default("topological"),
    rolloutMode: z.enum(["ordered", "parallel", "rolling", "canary"]).default("ordered"),
    gateOnDependencyHealth: z.boolean().default(true),
    retryPolicy: retryPolicySchema,
    failureIsolation: z.enum(["service", "project", "fleet"]).default("service"),
});
export type DependencyTemplateConfig = z.infer<typeof dependencyTemplateConfigSchema>;

export const templateConfigSchema = z.union([
    providerTemplateConfigSchema,
    buildTemplateConfigSchema,
    deployTemplateConfigSchema,
    routeTemplateConfigSchema,
    previewTemplateConfigSchema,
    dependencyTemplateConfigSchema,
]);
export type TemplateConfig = z.infer<typeof templateConfigSchema>;

export const templateCompatibilityMatrixItemSchema = z.object({
    provider: providerIdSchema,
    buildStrategy: builderIdSchema,
    deployStrategy: deployStrategySchema,
    environments: z.array(templateEnvironmentSchema).min(1),
    supported: z.boolean(),
    reasons: z.array(z.string()).default([]),
});
export type TemplateCompatibilityMatrixItem = z.infer<typeof templateCompatibilityMatrixItemSchema>;

export const templateCompatibilityMatrixSchema = z.object({
    generatedAt: z.iso.datetime(),
    matrix: z.array(templateCompatibilityMatrixItemSchema),
});
export type TemplateCompatibilityMatrix = z.infer<typeof templateCompatibilityMatrixSchema>;

export const templateCompatibilityValidationInputSchema = z.object({
    provider: providerIdSchema,
    buildStrategy: builderIdSchema,
    deployStrategy: deployStrategySchema,
    environment: templateEnvironmentSchema,
    templateIds: z
        .object({
            providerTemplateId: z.uuid().optional(),
            buildTemplateId: z.uuid().optional(),
            deployTemplateId: z.uuid().optional(),
            routeTemplateId: z.uuid().optional(),
            previewTemplateId: z.uuid().optional(),
            dependencyTemplateId: z.uuid().optional(),
        })
        .optional(),
});
export type TemplateCompatibilityValidationInput = z.infer<typeof templateCompatibilityValidationInputSchema>;

export const templateCompatibilityValidationResultSchema = z.object({
    compatible: z.boolean(),
    reasons: z.array(z.string()).default([]),
    evaluated: z.object({
        provider: providerIdSchema,
        buildStrategy: builderIdSchema,
        deployStrategy: deployStrategySchema,
        environment: templateEnvironmentSchema,
    }),
});
export type TemplateCompatibilityValidationResult = z.infer<typeof templateCompatibilityValidationResultSchema>;

export const templateValidationIssueSeveritySchema = z.enum(["error", "warning", "info"]);
export type TemplateValidationIssueSeverity = z.infer<typeof templateValidationIssueSeveritySchema>;

export const templateValidationIssueSchema = z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    severity: templateValidationIssueSeveritySchema,
    path: z.array(z.union([z.string(), z.number()])).default([]),
    kind: templateKindSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export type TemplateValidationIssue = z.infer<typeof templateValidationIssueSchema>;

export const templateSemanticValidationContextSchema = z.object({
    provider: providerIdSchema.optional(),
    buildStrategy: builderIdSchema.optional(),
    deployStrategy: deployStrategySchema.optional(),
    environment: templateEnvironmentSchema.optional(),
    strict: z.boolean().default(true),
});
export type TemplateSemanticValidationContext = z.infer<typeof templateSemanticValidationContextSchema>;

export const templateValidationInputSchema = z.object({
    template: z.lazy(() => templateCreateInputSchema),
    context: templateSemanticValidationContextSchema.optional(),
});
export type TemplateValidationInput = z.infer<typeof templateValidationInputSchema>;

export const templateValidationResultSchema = z.object({
    valid: z.boolean(),
    structuralValid: z.boolean(),
    semanticValid: z.boolean(),
    issues: z.array(templateValidationIssueSchema).default([]),
    normalizedTemplate: z.lazy(() => templateCreateInputSchema).optional(),
});
export type TemplateValidationResult = z.infer<typeof templateValidationResultSchema>;

export const templateSetValidationInputSchema = z.object({
    templates: z
        .object({
            provider: z.lazy(() => providerTemplateCreateSchema).optional(),
            build: z.lazy(() => buildTemplateCreateSchema).optional(),
            deploy: z.lazy(() => deployTemplateCreateSchema).optional(),
            route: z.lazy(() => routeTemplateCreateSchema).optional(),
            preview: z.lazy(() => previewTemplateCreateSchema).optional(),
            dependency: z.lazy(() => dependencyTemplateCreateSchema).optional(),
        })
        .partial(),
    context: templateSemanticValidationContextSchema.optional(),
});
export type TemplateSetValidationInput = z.infer<typeof templateSetValidationInputSchema>;

export const templateSetValidationResultSchema = z.object({
    valid: z.boolean(),
    issues: z.array(templateValidationIssueSchema).default([]),
    compatibility: templateCompatibilityValidationResultSchema.optional(),
    byKind: z.object({
        provider: templateValidationResultSchema.optional(),
        build: templateValidationResultSchema.optional(),
        deploy: templateValidationResultSchema.optional(),
        route: templateValidationResultSchema.optional(),
        preview: templateValidationResultSchema.optional(),
        dependency: templateValidationResultSchema.optional(),
    }),
});
export type TemplateSetValidationResult = z.infer<typeof templateSetValidationResultSchema>;

export const templateResolverLayerSchema = z.enum(["global", "provider", "project", "environment", "run"]);
export type TemplateResolverLayer = z.infer<typeof templateResolverLayerSchema>;

export const templateResolverContextSchema = z.object({
    provider: providerIdSchema.optional(),
    projectId: z.uuid().optional(),
    environment: templateEnvironmentSchema.optional(),
    runId: z.uuid().optional(),
});
export type TemplateResolverContext = z.infer<typeof templateResolverContextSchema>;

export const templateResolverChainInputSchema = z.object({
    globalTemplateId: z.uuid().optional(),
    providerTemplateId: z.uuid().optional(),
    projectTemplateId: z.uuid().optional(),
    environmentTemplateId: z.uuid().optional(),
    runTemplateId: z.uuid().optional(),
    inlineOverrides: z
        .object({
            global: z.record(z.string(), z.unknown()).optional(),
            provider: z.record(z.string(), z.unknown()).optional(),
            project: z.record(z.string(), z.unknown()).optional(),
            environment: z.record(z.string(), z.unknown()).optional(),
            run: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
});
export type TemplateResolverChainInput = z.infer<typeof templateResolverChainInputSchema>;

export const templateResolveInputSchema = z.object({
    kind: templateKindSchema,
    context: templateResolverContextSchema.optional(),
    chain: templateResolverChainInputSchema,
    strict: z.boolean().default(true),
});
export type TemplateResolveInput = z.infer<typeof templateResolveInputSchema>;

export const templateResolvedLayerTraceSchema = z.object({
    layer: templateResolverLayerSchema,
    applied: z.boolean(),
    source: z.enum(["template", "inlineOverride", "default", "none"]),
    templateId: z.uuid().optional(),
    templateVersion: templateVersionSchema.optional(),
    notes: z.array(z.string()).default([]),
});
export type TemplateResolvedLayerTrace = z.infer<typeof templateResolvedLayerTraceSchema>;

export const templateResolveResultSchema = z.object({
    resolved: z.boolean(),
    kind: templateKindSchema,
    resolvedConfig: templateConfigSchema.optional(),
    chainTrace: z.array(templateResolvedLayerTraceSchema),
    issues: z.array(templateValidationIssueSchema).default([]),
});
export type TemplateResolveResult = z.infer<typeof templateResolveResultSchema>;

export const templateSetResolveInputSchema = z.object({
    context: templateResolverContextSchema.optional(),
    strict: z.boolean().default(true),
    byKind: z
        .object({
            provider: templateResolverChainInputSchema.optional(),
            build: templateResolverChainInputSchema.optional(),
            deploy: templateResolverChainInputSchema.optional(),
            route: templateResolverChainInputSchema.optional(),
            preview: templateResolverChainInputSchema.optional(),
            dependency: templateResolverChainInputSchema.optional(),
        })
        .partial(),
});
export type TemplateSetResolveInput = z.infer<typeof templateSetResolveInputSchema>;

export const templateSetResolveResultSchema = z.object({
    resolved: z.boolean(),
    byKind: z.object({
        provider: templateResolveResultSchema.optional(),
        build: templateResolveResultSchema.optional(),
        deploy: templateResolveResultSchema.optional(),
        route: templateResolveResultSchema.optional(),
        preview: templateResolveResultSchema.optional(),
        dependency: templateResolveResultSchema.optional(),
    }),
    issues: z.array(templateValidationIssueSchema).default([]),
});
export type TemplateSetResolveResult = z.infer<typeof templateSetResolveResultSchema>;

export const templateMigrationDirectionSchema = z.enum(["up", "down"]);
export type TemplateMigrationDirection = z.infer<typeof templateMigrationDirectionSchema>;

export const templateMigrationOperationSchema = z.object({
    op: z.enum(["set", "unset", "rename", "move", "merge", "split"]),
    fromPath: z.string().optional(),
    toPath: z.string().optional(),
    value: z.unknown().optional(),
    description: z.string().optional(),
});
export type TemplateMigrationOperation = z.infer<typeof templateMigrationOperationSchema>;

export const templateVersionTransformSchema = z.object({
    id: z.string().min(1),
    kind: templateKindSchema.optional(),
    fromVersion: templateVersionSchema,
    toVersion: templateVersionSchema,
    direction: templateMigrationDirectionSchema,
    title: z.string().min(1),
    operations: z.array(templateMigrationOperationSchema).default([]),
    introducesBreakingChange: z.boolean().default(false),
});
export type TemplateVersionTransform = z.infer<typeof templateVersionTransformSchema>;

export const templateMigrationSafetyCheckSchema = z.object({
    id: z.string().min(1),
    severity: z.enum(["error", "warning", "info"]),
    status: z.enum(["pass", "fail", "skip"]),
    title: z.string().min(1),
    message: z.string().min(1),
    remediation: z.string().optional(),
});
export type TemplateMigrationSafetyCheck = z.infer<typeof templateMigrationSafetyCheckSchema>;

const templateVersionMigrationBaseInputSchema = z.object({
    templateId: z.uuid(),
    kind: templateKindSchema,
    direction: templateMigrationDirectionSchema,
    sourceVersion: templateVersionSchema,
    targetVersion: templateVersionSchema,
    sourceConfig: templateConfigSchema,
    strict: z.boolean().default(true),
});

export const templateVersionMigrationPreviewInputSchema = templateVersionMigrationBaseInputSchema;
export type TemplateVersionMigrationPreviewInput = z.infer<typeof templateVersionMigrationPreviewInputSchema>;

export const templateVersionMigrationPreviewResultSchema = z.object({
    canMigrate: z.boolean(),
    selectedTransform: templateVersionTransformSchema.optional(),
    safetyChecks: z.array(templateMigrationSafetyCheckSchema).default([]),
    issues: z.array(templateValidationIssueSchema).default([]),
    migratedConfig: templateConfigSchema.optional(),
});
export type TemplateVersionMigrationPreviewResult = z.infer<typeof templateVersionMigrationPreviewResultSchema>;

export const templateVersionMigrationApplyInputSchema = templateVersionMigrationBaseInputSchema.extend({
    expectedCurrentVersion: templateVersionSchema.optional(),
    dryRun: z.boolean().default(false),
});
export type TemplateVersionMigrationApplyInput = z.infer<typeof templateVersionMigrationApplyInputSchema>;

export const templateVersionMigrationApplyResultSchema = z.object({
    applied: z.boolean(),
    dryRun: z.boolean(),
    templateId: z.uuid(),
    previousVersion: templateVersionSchema,
    nextVersion: templateVersionSchema,
    selectedTransform: templateVersionTransformSchema.optional(),
    safetyChecks: z.array(templateMigrationSafetyCheckSchema).default([]),
    issues: z.array(templateValidationIssueSchema).default([]),
    migratedConfig: templateConfigSchema.optional(),
});
export type TemplateVersionMigrationApplyResult = z.infer<typeof templateVersionMigrationApplyResultSchema>;

export const templateVersionMigrationListInputSchema = z.object({
    kind: templateKindSchema.optional(),
    direction: templateMigrationDirectionSchema.optional(),
    fromVersion: templateVersionSchema.optional(),
    toVersion: templateVersionSchema.optional(),
});
export type TemplateVersionMigrationListInput = z.infer<typeof templateVersionMigrationListInputSchema>;

export const templateVersionMigrationListResultSchema = z.object({
    transforms: z.array(templateVersionTransformSchema),
});
export type TemplateVersionMigrationListResult = z.infer<typeof templateVersionMigrationListResultSchema>;

export const deploymentTemplateSchema = z.object({
    id: z.uuid(),
    key: nonEmptyString,
    name: nonEmptyString,
    description: z.string().nullable(),
    kind: templateKindSchema,
    scope: templateScopeSchema,
    version: templateVersionSchema,
    status: templateStatusSchema,
    isSystem: z.boolean(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    config: templateConfigSchema,
    createdBy: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
});
export type DeploymentTemplate = z.infer<typeof deploymentTemplateSchema>;

const templateCreateBaseSchema = z.object({
    key: nonEmptyString,
    name: nonEmptyString,
    description: z.string().optional(),
    scope: templateScopeSchema.default("project"),
    version: templateVersionSchema.default("1.0.0"),
    status: templateStatusSchema.default("draft"),
    isSystem: z.boolean().default(false),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export const providerTemplateCreateSchema = templateCreateBaseSchema.extend({
    kind: z.literal("provider"),
    config: providerTemplateConfigSchema,
});

export const buildTemplateCreateSchema = templateCreateBaseSchema.extend({
    kind: z.literal("build"),
    config: buildTemplateConfigSchema,
});

export const deployTemplateCreateSchema = templateCreateBaseSchema.extend({
    kind: z.literal("deploy"),
    config: deployTemplateConfigSchema,
});

export const routeTemplateCreateSchema = templateCreateBaseSchema.extend({
    kind: z.literal("route"),
    config: routeTemplateConfigSchema,
});

export const previewTemplateCreateSchema = templateCreateBaseSchema.extend({
    kind: z.literal("preview"),
    config: previewTemplateConfigSchema,
});

export const dependencyTemplateCreateSchema = templateCreateBaseSchema.extend({
    kind: z.literal("dependency"),
    config: dependencyTemplateConfigSchema,
});

export const templateCreateInputSchema = z.discriminatedUnion("kind", [
    providerTemplateCreateSchema,
    buildTemplateCreateSchema,
    deployTemplateCreateSchema,
    routeTemplateCreateSchema,
    previewTemplateCreateSchema,
    dependencyTemplateCreateSchema,
]);

export const templateUpdateInputSchema = z.object({
    id: z.uuid(),
    key: nonEmptyString.optional(),
    name: nonEmptyString.optional(),
    description: z.string().nullable().optional(),
    scope: templateScopeSchema.optional(),
    version: templateVersionSchema.optional(),
    status: templateStatusSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    config: templateConfigSchema.optional(),
});

export type TemplateCreateInput = z.infer<typeof templateCreateInputSchema>;
export type TemplateUpdateInput = z.infer<typeof templateUpdateInputSchema>;
