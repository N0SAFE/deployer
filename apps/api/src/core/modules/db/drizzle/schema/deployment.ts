import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// Enums for deployment-related types
export const projectRoleEnum = pgEnum('project_role', ['owner', 'admin', 'developer', 'viewer']);
export const deploymentStatusEnum = pgEnum('deployment_status', [
  'pending',
  'queued', 
  'building',
  'deploying',
  'success',
  'failed',
  'cancelled'
]);
export const deploymentEnvironmentEnum = pgEnum('deployment_environment', [
  'production',
  'staging', 
  'preview',
  'development'
]);
export const sourceTypeEnum = pgEnum('source_type', [
  'github',
  'gitlab', 
  'git',
  'upload',
  'custom'
]);
export const logLevelEnum = pgEnum('log_level', ['info', 'warn', 'error', 'debug']);

// Projects table - main container for all services and deployments
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  baseDomain: text("base_domain"), // e.g., "myapp.example.com"
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<{
    autoCleanupDays?: number;
    maxPreviewEnvironments?: number;
    defaultEnvironmentVariables?: Record<string, string>;
    webhookSecret?: string;
  }>(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// Services table - individual deployable components within projects
export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // e.g., "web", "api", "docs"
  type: text("type").notNull(), // e.g., "web", "worker", "database"
  dockerfilePath: text("dockerfile_path").default("Dockerfile"),
  buildContext: text("build_context").default("."),
  port: integer("port"), // Main port for the service
  healthCheckPath: text("health_check_path").default("/health"),
  environmentVariables: jsonb("environment_variables").$type<Record<string, string>>(),
  buildArguments: jsonb("build_arguments").$type<Record<string, string>>(),
  resourceLimits: jsonb("resource_limits").$type<{
    memory?: string; // e.g., "512m"
    cpu?: string; // e.g., "0.5"
    storage?: string; // e.g., "1g" 
  }>(),
  isActive: boolean("is_active").default(true).notNull(),
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

// Deployments table - individual deployment instances
export const deployments = pgTable("deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceId: uuid("service_id")
    .notNull()
    .references(() => services.id, { onDelete: "cascade" }),
  triggeredBy: text("triggered_by")
    .references(() => user.id, { onDelete: "set null" }), // Can be null for webhook triggers
  status: deploymentStatusEnum("status").default("pending").notNull(),
  environment: deploymentEnvironmentEnum("environment").default("production").notNull(),
  sourceType: sourceTypeEnum("source_type").notNull(),
  sourceConfig: jsonb("source_config").$type<{
    // GitHub/GitLab
    repositoryUrl?: string;
    branch?: string;
    commitSha?: string;
    pullRequestNumber?: number;
    // File upload
    fileName?: string;
    fileSize?: number;
    // Custom
    customData?: Record<string, any>;
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
  }>(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// Preview environments - temporary deployments with subdomains
export const previewEnvironments = pgTable("preview_environments", {
  id: uuid("id").primaryKey().defaultRandom(),
  deploymentId: uuid("deployment_id")
    .notNull()
    .references(() => deployments.id, { onDelete: "cascade" }),
  subdomain: text("subdomain").notNull().unique(), // e.g., "myapp-pr-123"
  fullDomain: text("full_domain").notNull(), // e.g., "myapp-pr-123.preview.example.com"
  sslEnabled: boolean("ssl_enabled").default(true).notNull(),
  sslCertificatePath: text("ssl_certificate_path"), // Path to SSL cert if custom
  expiresAt: timestamp("expires_at"), // Auto-cleanup date
  isActive: boolean("is_active").default(true).notNull(),
  webhookTriggered: boolean("webhook_triggered").default(false).notNull(),
  environmentVariables: jsonb("environment_variables").$type<Record<string, string>>(),
  metadata: jsonb("metadata").$type<{
    pullRequestUrl?: string;
    branchName?: string;
    lastAccessedAt?: string;
    accessCount?: number;
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
  }>(),
  timestamp: timestamp("timestamp")
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
  role: projectRoleEnum("role").default("developer").notNull(),
  permissions: jsonb("permissions").$type<{
    canDeploy?: boolean;
    canManageServices?: boolean;
    canManageCollaborators?: boolean;
    canViewLogs?: boolean;
    canDeleteDeployments?: boolean;
  }>(),
  invitedBy: text("invited_by")
    .references(() => user.id, { onDelete: "set null" }),
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
  serviceId: uuid("service_id")
    .references(() => services.id, { onDelete: "cascade" }), // Optional: specific service
  sourceType: sourceTypeEnum("source_type").notNull(),
  webhookUrl: text("webhook_url").notNull(), // Our webhook endpoint URL
  externalWebhookId: text("external_webhook_id"), // ID from external platform
  secret: text("secret").notNull(), // For signature validation
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
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" }), // Optional: project-specific key
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