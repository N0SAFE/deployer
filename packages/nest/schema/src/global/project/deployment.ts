import { pgTable, text, timestamp, boolean, integer, uuid, jsonb, pgEnum, type AnyPgColumn } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "@deployer/nest-schema/global/identity/auth";
import { environments } from "@deployer/nest-schema/global/project/environment";
import { encryptedText } from "@deployer/nest-schema/codecs/codec-registry";
import { traefikConfigBuilder } from "@deployer/nest-schema/codecs/codec-registry";
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
import { environmentVariables } from "@deployer/nest-schema/global/project/environment";
import { sourceTypeEnum } from "@deployer/nest-schema/global/platform/deployment";
import { deploymentRules, deployments } from "@deployer/nest-schema/global/runtime/deployment";
// Enums for deployment-related types
// project_role is the SSOT PROJECT_ROLES (owner/maintainer/deployer/viewer) —
// the canonical project roles from the permission system.
export const projectRoleEnum = pgEnum("project_role", [...PROJECT_ROLES] as [string, ...string[]]);


export const serviceTypeEnum = pgEnum("service_type", [...zodEnumToPgEnumValues(serviceTypeSchema)]);


export const serviceProviderTypeEnum = pgEnum("service_provider_type", [...zodEnumToPgEnumValues(serviceProviderTypeSchema)]);


export const serviceRunnerTypeEnum = pgEnum("service_runner_type", [...zodEnumToPgEnumValues(serviceRunnerTypeSchema)]);


// Projects table - main container for all services and deployments
export const projects = pgTable("projects", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    baseDomain: text("base_domain"), // e.g., "myapp.example.com"
    /** Provider-backed network config (DNS provider + zone + record policy). */
    network: jsonb("network").$type<{
        dnsProviderId?: string | null;
        zoneId?: string | null;
        zoneName?: string | null;
        autoProvisionRecords?: boolean;
        proxiedDefault?: boolean;
        wildcardSubdomains?: boolean;
        recordType?: NetworkDnsRecordType;
        recordContent?: string | null;
    } | null>(),
    ownerId: text("owner_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    settings: jsonb("settings").$type<{
        autoCleanupDays?: number;
        maxPreviewEnvironments?: number;
        defaultEnvironmentVariables?: Record<string, string>;
        webhookSecret?: string;
    }>(),
    metadata: jsonb("metadata").$type<{
        lastHealthIssue?: string;
        healthStatus?: "healthy" | "degraded" | "unhealthy";
        healthError?: string;
        restartWarning?: boolean;
        restartCount?: number;
        lastRestartCheck?: string;
    }>(),
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
    updatedAt: timestamp("updated_at")
        .$defaultFn(() => new Date())
        .notNull(),
});


// Services table - individual deployable components within projects
// Organized into logical sections for better readability and maintainability
export const services = pgTable("services", {
    // ==========================================
    // IDENTITY & RELATIONSHIP
    // ==========================================
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
        .notNull()
        .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // Service name, e.g., "web", "api", "docs"
    description: text("description"), // Optional service description
    type: serviceTypeEnum("type").notNull(), // dokploy-style service type

    // ==========================================
    // SOURCE PROVIDER CONFIGURATION
    // Dynamic configuration based on provider registry
    // ==========================================
    providerId: serviceProviderTypeEnum("provider_id").notNull(), // Provider ID from registry: "github", "static", etc.
    // Dynamic provider configuration - validated against provider's ConfigSchema
    // Structure defined by the provider's getConfigSchema() method
    providerConfig: jsonb("provider_config").$type<Record<string, any>>(),

    // ==========================================
    // BUILD SYSTEM CONFIGURATION
    // Dynamic configuration based on builder registry
    // ==========================================
    builderId: serviceRunnerTypeEnum("builder_id").notNull(), // Builder ID from registry: "dockerfile", "nixpack", etc.
    // Dynamic builder configuration - validated against builder's ConfigSchema
    // Structure defined by the builder's getConfigSchema() method
    builderConfig: jsonb("builder_config").$type<Record<string, any>>(),

    // ==========================================
    // RUNTIME CONFIGURATION
    // ==========================================
    port: integer("port"), // Main service port
    environmentVariables: jsonb("environment_variables").$type<Record<string, string>>(),
    resourceLimits: jsonb("resource_limits").$type<{
        memory?: string; // e.g., "512m", "1g", "2g"
        cpu?: string; // e.g., "0.5", "1", "2"
        storage?: string; // e.g., "1g", "5g", "10g"
    }>(),

    // ==========================================
    // HEALTH & MONITORING
    // ==========================================
    healthCheckPath: text("health_check_path").default("/health"),
    healthCheckInterval: integer("health_check_interval").default(30), // Seconds
    healthCheckTimeout: integer("health_check_timeout").default(10), // Seconds
    healthCheckRetries: integer("health_check_retries").default(3), // Number of retries

    // ==========================================
    // DEPLOYMENT CONFIGURATION
    // ==========================================
    deploymentRetention: jsonb("deployment_retention")
        .$type<{
            maxSuccessfulDeployments?: number; // Default: 5 - max successful deployments to keep
            keepArtifacts?: boolean; // Default: true - keep Docker images and build artifacts
            autoCleanup?: boolean; // Default: true - auto-cleanup old deployments
            cleanupSchedule?: string; // Cron expression for cleanup schedule
        }>()
        .default({
            maxSuccessfulDeployments: 5,
            keepArtifacts: true,
            autoCleanup: true,
        }),

    // ==========================================
    // ROUTING & NETWORK CONFIGURATION
    // ==========================================
    // Traefik configuration with variable support (~##domain##~, ~##containerName##~, etc.)
    // Variables are resolved during Traefik sync, not during storage
    traefikConfig: traefikConfigBuilder("traefik_config"),
    customDomains: jsonb("custom_domains").$type<string[]>(), // Additional custom domains
    /** Provider-backed network config (DNS provider + zone + record policy). */
    network: jsonb("network").$type<{
        dnsProviderId?: string | null;
        zoneId?: string | null;
        zoneName?: string | null;
        recordType?: string;
        recordContent?: string | null;
        proxied?: boolean;
        autoProvision?: boolean;
        visibility?: "private" | "public";
        tls?: { enabled?: boolean; httpRedirect?: boolean };
    } | null>(),

    // ==========================================
    // PREVIEW & MOCK CONFIGURATION (POC)
    // ==========================================
    // Contract this service implements (DI semantics — mocks must match the
    // replaced service's contractRef). See mock-config.schema.ts.
    implementsContract: jsonb("implements_contract").$type<{
        contractRef: string
        compatibility?: "http" | "grpc" | "events"
    }>(),
    // Per-service preview resolution template (how previews of THIS service
    // resolve their backend dependencies). See preview-template.schema.ts.
    preview: jsonb("preview").$type<{
        backendResolution:
            | { mode: "linked-preview" }
            | { mode: "fixed"; targetEnvironment: string }
            | { mode: "mock"; mockRef: string; engine?: string }
            | { mode: "derive"; fromInputKey: string; fallbackEnvironment: string }
        linkedServices?: Array<{
            serviceId: string
            mode?: "inherit" | "mock" | "fixed"
            mockRef?: string
            fixedEnvironment?: string
        }>
        subdomainTemplate?: string
    }>(),

    // ==========================================
    // METADATA & STATE
    // ==========================================
    isActive: boolean("is_active").default(true).notNull(),
    metadata: jsonb("metadata").$type<{
        tags?: string[]; // Service tags
        category?: string; // Service category
        icon?: string; // Service icon URL or emoji
        color?: string; // UI color for the service
        lastDeployedAt?: string; // Last successful deployment timestamp
        lastDeployedBy?: string; // User ID who triggered last deployment
        deploymentCount?: number; // Total number of deployments
        customData?: Record<string, any>; // Additional custom metadata
    }>(),

    // ==========================================
    // HIERARCHY (sub-services)
    // A sub-service is a REAL service row linked to its parent. Any service
    // may have children (they become orchestrators); a child may itself have
    // children — full nesting. parentPath is a materialized ancestor path
    // (e.g. "root/child/grandchild") for cheap subtree queries; depth is the
    // nesting level (root = 0).
    //
    // NOTE: `(): AnyPgColumn` is required for the self-referencing FK —
    // without it, TypeScript resolves `services` to `any` inside its own
    // definition (circular inference).
    // ==========================================
    parentId: uuid("parent_id").references((): AnyPgColumn => services.id, { onDelete: "cascade" }),
    parentPath: text("parent_path"),
    depth: integer("depth").default(0).notNull(),

    // ==========================================
    // TIMESTAMPS
    // ==========================================
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
    updatedAt: timestamp("updated_at")
        .$defaultFn(() => new Date())
        .notNull(),
});


// Service dependencies - defines deployment order and relationships
export const serviceDependencies = pgTable("service_dependencies", {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
        .notNull()
        .references(() => services.id, { onDelete: "cascade" }),
    dependsOnServiceId: uuid("depends_on_service_id")
        .notNull()
        .references(() => services.id, { onDelete: "cascade" }),
    isRequired: boolean("is_required").default(true).notNull(),
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
});


// Project collaborators - team access management
export const projectCollaborators = pgTable("project_collaborators", {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
        .notNull()
        .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    role: projectRoleEnum("role").default("viewer").notNull(),
    permissions: jsonb("permissions").$type<{
        canDeploy?: boolean;
        canManageServices?: boolean;
        canManageCollaborators?: boolean;
        canViewLogs?: boolean;
        canDeleteDeployments?: boolean;
    }>(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    invitedAt: timestamp("invited_at")
        .$defaultFn(() => new Date())
        .notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
    updatedAt: timestamp("updated_at")
        .$defaultFn(() => new Date())
        .notNull(),
});


// Webhooks table - manage webhook endpoints and secrets
export const webhooks = pgTable("webhooks", {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
        .notNull()
        .references(() => projects.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "cascade" }), // Optional: specific service
    sourceType: sourceTypeEnum("source_type").notNull(),
    webhookUrl: text("webhook_url").notNull(), // Our webhook endpoint URL
    externalWebhookId: text("external_webhook_id"), // ID from external platform
    secret: encryptedText("secret").notNull(), // HMAC-SHA256 signing secret (encrypted at rest)
    isActive: boolean("is_active").default(true).notNull(),
    lastTriggered: timestamp("last_triggered"),
    triggerCount: integer("trigger_count").default(0).notNull(),
    settings: jsonb("settings").$type<{
        events?: string[]; // Which events to listen for
        branches?: string[]; // Which branches to deploy
        skipCi?: boolean;
        autoPreview?: boolean;
    }>(),
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
    updatedAt: timestamp("updated_at")
        .$defaultFn(() => new Date())
        .notNull(),
});


// API keys for programmatic access
export const apiKeys = pgTable("api_keys", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }), // Optional: project-specific key
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(), // Hashed API key
    keyPreview: text("key_preview").notNull(), // First few chars for display
    scopes: jsonb("scopes").$type<string[]>(), // e.g., ["deploy", "read", "logs"]
    lastUsed: timestamp("last_used"),
    expiresAt: timestamp("expires_at"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at")
        .$defaultFn(() => new Date())
        .notNull(),
    updatedAt: timestamp("updated_at")
        .$defaultFn(() => new Date())
        .notNull(),
});



// Relations
export const projectsRelations = relations(projects, ({ one, many }) => ({
    owner: one(user, {
        fields: [projects.ownerId],
        references: [user.id],
    }),
    services: many(services),
    collaborators: many(projectCollaborators),
    webhooks: many(webhooks),
    apiKeys: many(apiKeys),
}));



export const servicesRelations = relations(services, ({ one, many }) => ({
    project: one(projects, {
        fields: [services.projectId],
        references: [projects.id],
    }),
    // Sub-service hierarchy: parent ↔ children.
    parent: one(services, {
        fields: [services.parentId],
        references: [services.id],
        relationName: "serviceChildren",
    }),
    children: many(services, {
        relationName: "serviceChildren",
    }),
    deployments: many(deployments),
    dependencies: many(serviceDependencies, {
        relationName: "serviceDependencies",
    }),
    dependents: many(serviceDependencies, {
        relationName: "serviceDependents",
    }),
    webhooks: many(webhooks),
    deploymentRules: many(deploymentRules),
    // Temporarily omitted in e2e compile-deadlock investigation to avoid deployment<->health schema import cycle.
}));



export const serviceDependenciesRelations = relations(serviceDependencies, ({ one }) => ({
    service: one(services, {
        fields: [serviceDependencies.serviceId],
        references: [services.id],
        relationName: "serviceDependencies",
    }),
    dependsOnService: one(services, {
        fields: [serviceDependencies.dependsOnServiceId],
        references: [services.id],
        relationName: "serviceDependents",
    }),
}));



export const projectCollaboratorsRelations = relations(projectCollaborators, ({ one }) => ({
    project: one(projects, {
        fields: [projectCollaborators.projectId],
        references: [projects.id],
    }),
    user: one(user, {
        fields: [projectCollaborators.userId],
        references: [user.id],
    }),
    invitedByUser: one(user, {
        fields: [projectCollaborators.invitedBy],
        references: [user.id],
    }),
}));



export const webhooksRelations = relations(webhooks, ({ one }) => ({
    project: one(projects, {
        fields: [webhooks.projectId],
        references: [projects.id],
    }),
    service: one(services, {
        fields: [webhooks.serviceId],
        references: [services.id],
    }),
}));



export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
    user: one(user, {
        fields: [apiKeys.userId],
        references: [user.id],
    }),
    project: one(projects, {
        fields: [apiKeys.projectId],
        references: [projects.id],
    }),
}));
