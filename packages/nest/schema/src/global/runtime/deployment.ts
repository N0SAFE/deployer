import { pgTable, text, timestamp, boolean, integer, uuid, jsonb, pgEnum, type AnyPgColumn } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "@deployer/nest-schema/global/identity/auth";
import { environments } from "@deployer/nest-schema/global/project/environment";
import { encryptedText } from "../../codecs/codec-registry";
import { traefikConfigBuilder } from "../../codecs/codec-registry";
import {
    deploymentEnvironmentSchema,
    deploymentPhaseSchema,
    deploymentStatusSchema,
    logLevelSchema,
    rollbackStatusSchema,
    serviceProviderTypeSchema,
    serviceRunnerTypeSchema,
    serviceTypeSchema,
    sourceTypeSchema,
} from "@deployer/contracts-common";
import type { NetworkDnsRecordType } from "@deployer/contracts-entities";
import { zodEnumToPgEnumValues } from "@deployer/nest-schema/global/utils/zod-enum";
import { PROJECT_ROLES } from "@deployer/auth";
import { projects, services } from "@deployer/nest-schema/global/project/deployment";
import { sourceTypeEnum } from "@deployer/nest-schema/global/platform/deployment";
import { environmentVariables } from "@deployer/nest-schema/global/project/environment";
import { previewEnvironments } from "@deployer/nest-schema/global/fleet/deployment";
export const deploymentStatusEnum = pgEnum("deployment_status", [...zodEnumToPgEnumValues(deploymentStatusSchema)]);


export const deploymentPhaseEnum = pgEnum("deployment_phase", [...zodEnumToPgEnumValues(deploymentPhaseSchema)]);


export const deploymentEnvironmentEnum = pgEnum("deployment_environment", [...zodEnumToPgEnumValues(deploymentEnvironmentSchema)]);


export const logLevelEnum = pgEnum("log_level", [...zodEnumToPgEnumValues(logLevelSchema)]);


// Deployments table - individual deployment instances
export const deployments = pgTable("deployments", {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
        .notNull()
        .references(() => services.id, { onDelete: "cascade" }),
    triggeredBy: text("triggered_by").references(() => user.id, { onDelete: "set null" }), // Can be null for webhook triggers
    status: deploymentStatusEnum("status").default("pending").notNull(),
    environment: deploymentEnvironmentEnum("environment").default("production").notNull(),
    /** The environment this deployment was created FROM (its rules were active). */
    environmentId: uuid("environment_id").references((): AnyPgColumn => environments.id, { onDelete: "set null" }),
    sourceType: sourceTypeEnum("source_type").notNull(),
    sourceConfig: jsonb("source_config").$type<{
        // Discriminated union shape — see DeploymentTriggerSourceSchema.
        sourceType: "github" | "gitlab" | "upload" | "custom";
        // GitHub / GitLab
        repositoryUrl?: string;
        branch?: string;
        commitSha?: string;
        // GitHub
        pullRequestNumber?: number;
        // GitLab
        mergeRequestIid?: number;
        // Upload
        uploadId?: string;
        uploadPath?: string;
        fileName?: string;
        fileSize?: number;
        // Custom
        customData?: Record<string, unknown>;
    }>(),
    buildStartedAt: timestamp("build_started_at"),
    buildCompletedAt: timestamp("build_completed_at"),
    deployStartedAt: timestamp("deploy_started_at"),
    deployCompletedAt: timestamp("deploy_completed_at"),
    containerName: text("container_name"), // Docker container name
    containerImage: text("container_image"), // Docker image tag
    domainUrl: text("domain_url"), // Full domain URL for the deployment
    healthCheckUrl: text("health_check_url"), // Full URL for health checks
    errorMessage: text("error_message"), // Error details if deployment fails
    // Phase tracking for reconciliation and crash recovery
    phase: deploymentPhaseEnum("phase").default("queued"),
    phaseProgress: integer("phase_progress").default(0),
    phaseMetadata: jsonb("phase_metadata").$type<{
        sourceCommit?: string;
        filesCopied?: number;
        totalFiles?: number;
        containerId?: string;
        error?: string;
        stack?: string;
    }>(),
    phaseUpdatedAt: timestamp("phase_updated_at").$defaultFn(() => new Date()),
    metadata: jsonb("metadata").$type<{
        buildLogs?: string;
        buildDuration?: number;
        deployDuration?: number;
        resourceUsage?: Record<string, any>;
        // Additional fields for deployment controller
        stage?: string;
        progress?: number;
        cancelReason?: string;
        cancelledAt?: Date;
        version?: string;
        // Git-related metadata
        branch?: string;
        pr?: number;
        customName?: string;
        // Rollback metadata
        rollbackFrom?: string;
        targetDeploymentId?: string;
    }>(),
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
    updatedAt: timestamp("updated_at")
        .$defaultFn(() => new Date())
        .notNull(),
});


// Deployment logs - structured logging for all deployment activities
export const deploymentLogs = pgTable("deployment_logs", {
    id: uuid("id").primaryKey().defaultRandom(),
    deploymentId: uuid("deployment_id")
        .notNull()
        .references(() => deployments.id, { onDelete: "cascade" }),
    level: logLevelEnum("level").default("info").notNull(),
    message: text("message").notNull(),
    phase: text("phase"), // e.g., "build", "deploy", "health-check"
    step: text("step"), // e.g., "clone-repository", "docker-build", "start-container"
    service: text("service"), // Service name for logs
    stage: text("stage"), // Current deployment stage
    metadata: jsonb("metadata").$type<{
        duration?: number;
        exitCode?: number;
        containerLogs?: string;
        errorStack?: string;
        correlationId?: string;
        traceId?: string;
        spanId?: string;
    }>(),
    timestamp: timestamp("timestamp")
        .$defaultFn(() => new Date())
        .notNull(),
});



// Saved deployment stream definitions (typed stream search + CRUD)
export const deploymentStreams = pgTable("deployment_streams", {
    id: uuid("id").primaryKey().defaultRandom(),
    coreStreamId: uuid("core_stream_id"),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").default(true).notNull(),
    deploymentId: uuid("deployment_id").references(() => deployments.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    statusFilter: deploymentStatusEnum("status_filter"),
    environmentFilter: deploymentEnvironmentEnum("environment_filter"),
    eventTypes: jsonb("event_types").$type<string[]>(),
    replayDefault: boolean("replay_default").default(true).notNull(),
    replayLimitDefault: integer("replay_limit_default").default(100).notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
    updatedAt: timestamp("updated_at")
        .$defaultFn(() => new Date())
        .notNull(),
});



// Deployment Rollbacks - track rollback operations
export const rollbackStatusEnum = pgEnum("rollback_status", [...zodEnumToPgEnumValues(rollbackStatusSchema)]);



export const deploymentRollbacks = pgTable("deployment_rollbacks", {
    id: uuid("id").primaryKey().defaultRandom(),
    fromDeploymentId: uuid("from_deployment_id")
        .notNull()
        .references(() => deployments.id, { onDelete: "cascade" }),
    toDeploymentId: uuid("to_deployment_id")
        .notNull()
        .references(() => deployments.id, { onDelete: "cascade" }),
    triggeredBy: text("triggered_by").references(() => user.id, { onDelete: "set null" }),
    status: rollbackStatusEnum("status").default("pending").notNull(),
    reason: text("reason"), // Why the rollback was triggered
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    failedAt: timestamp("failed_at"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<{
        containersRemoved?: string[];
        routesUpdated?: string[];
        symlinksRecreated?: string[];
        filesRestored?: number;
        [key: string]: any;
    }>(),
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
    updatedAt: timestamp("updated_at")
        .$defaultFn(() => new Date())
        .notNull(),
});



// Deployment Rules - configure automatic deployments based on GitHub events
export const deploymentRuleTriggerEnum = pgEnum("deployment_rule_trigger", [
    "push", // On push to branch
    "pull_request", // On PR open/update
    "tag", // On tag creation
    "release", // On release creation
    "manual", // Manual trigger only
]);



export const deploymentRules = pgTable("deployment_rules", {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
        .notNull()
        .references(() => services.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // e.g., "Production deployments", "Preview PRs"
    trigger: deploymentRuleTriggerEnum("trigger").notNull(),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    priority: integer("priority").default(0).notNull(), // Higher number = higher priority

    // Branch/Tag matching
    branchPattern: text("branch_pattern"), // e.g., "main", "master", "release/*", "feature/*"
    excludeBranchPattern: text("exclude_branch_pattern"), // e.g., "dev/*"
    tagPattern: text("tag_pattern"), // e.g., "v*", "release-*"

    // PR-specific rules
    prLabels: jsonb("pr_labels").$type<string[]>(), // Only deploy PRs with these labels
    prTargetBranches: jsonb("pr_target_branches").$type<string[]>(), // Only PRs targeting these branches
    requireApproval: boolean("require_approval").default(false),
    minApprovals: integer("min_approvals").default(1),

    // Deployment configuration
    environment: deploymentEnvironmentEnum("environment").notNull(),
    autoMergeOnSuccess: boolean("auto_merge_on_success").default(false),
    autoDeleteOnMerge: boolean("auto_delete_on_merge").default(true), // For preview envs

    // Custom configuration overrides
    environmentVariables: jsonb("environment_variables").$type<Record<string, string>>(),
    builderConfigOverride: jsonb("builder_config_override").$type<{
        buildCommand?: string;
        outputDirectory?: string;
        [key: string]: any;
    }>(),

    metadata: jsonb("metadata").$type<{
        description?: string;
        lastTriggeredAt?: string;
        triggerCount?: number;
        [key: string]: any;
    }>(),

    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
    updatedAt: timestamp("updated_at")
        .$defaultFn(() => new Date())
        .notNull(),
});



export const deploymentsRelations = relations(deployments, ({ one, many }) => ({
    service: one(services, {
        fields: [deployments.serviceId],
        references: [services.id],
    }),
    triggeredByUser: one(user, {
        fields: [deployments.triggeredBy],
        references: [user.id],
    }),
    previewEnvironments: many(previewEnvironments),
    logs: many(deploymentLogs),
}));



export const deploymentLogsRelations = relations(deploymentLogs, ({ one }) => ({
    deployment: one(deployments, {
        fields: [deploymentLogs.deploymentId],
        references: [deployments.id],
    }),
}));



export const deploymentStreamsRelations = relations(deploymentStreams, ({ one }) => ({
    deployment: one(deployments, {
        fields: [deploymentStreams.deploymentId],
        references: [deployments.id],
    }),
    service: one(services, {
        fields: [deploymentStreams.serviceId],
        references: [services.id],
    }),
    project: one(projects, {
        fields: [deploymentStreams.projectId],
        references: [projects.id],
    }),
    createdByUser: one(user, {
        fields: [deploymentStreams.createdBy],
        references: [user.id],
    }),
}));



export const deploymentRollbacksRelations = relations(deploymentRollbacks, ({ one }) => ({
    fromDeployment: one(deployments, {
        fields: [deploymentRollbacks.fromDeploymentId],
        references: [deployments.id],
    }),
    toDeployment: one(deployments, {
        fields: [deploymentRollbacks.toDeploymentId],
        references: [deployments.id],
    }),
    triggeredByUser: one(user, {
        fields: [deploymentRollbacks.triggeredBy],
        references: [user.id],
    }),
}));



export const deploymentRulesRelations = relations(deploymentRules, ({ one }) => ({
    service: one(services, {
        fields: [deploymentRules.serviceId],
        references: [services.id],
    }),
}));
