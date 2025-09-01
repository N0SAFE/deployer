import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  jsonb,
  pgEnum,
  integer,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { projects, services } from "./deployment";

// Environment types enum
export const environmentTypeEnum = pgEnum('environment_type', [
  'production',
  'staging', 
  'preview',
  'development'
]);

// Environment status enum
export const environmentStatusEnum = pgEnum('environment_status', [
  'healthy',
  'updating',
  'error',
  'pending',
  'inactive'
]);

// Variable resolution status enum
export const variableResolutionStatusEnum = pgEnum('variable_resolution_status', [
  'pending',
  'resolved',
  'failed'
]);

// Environment templates - reusable environment configurations
export const environmentTemplates = pgTable("environment_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  type: environmentTypeEnum("type").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  
  // Configuration templates
  defaultVariables: jsonb("default_variables").$type<Array<{
    key: string;
    value: string;
    isSecret?: boolean;
    description?: string;
  }>>().default([]),
  
  variableDefinitions: jsonb("variable_definitions").$type<Array<{
    key: string;
    description?: string;
    required?: boolean;
    defaultValue?: string;
    validation?: Array<{
      type: 'regex' | 'url' | 'email' | 'number' | 'boolean' | 'enum';
      value: string;
      message?: string;
    }>;
    category?: string;
  }>>().default([]),
  
  deploymentSettings: jsonb("deployment_settings").$type<{
    autoDeployEnabled?: boolean;
    deploymentStrategy?: string;
    healthCheckEnabled?: boolean;
    rollbackEnabled?: boolean;
    maxInstances?: number;
    resourceLimits?: {
      memory?: string;
      cpu?: string;
      storage?: string;
    };
  }>(),
  
  securitySettings: jsonb("security_settings").$type<{
    requireApproval?: boolean;
    allowedIPs?: string[];
    sslRequired?: boolean;
    corsOrigins?: string[];
    rateLimit?: number;
  }>(),
  
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// Environments - actual environment instances
export const environments = pgTable("environments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(), // URL-safe identifier
  description: text("description"),
  type: environmentTypeEnum("type").notNull(),
  status: environmentStatusEnum("status").default("pending").notNull(),
  
  // Optional template association
  templateId: uuid("template_id")
    .references(() => environmentTemplates.id, { onDelete: "set null" }),
  
  // Project association - environments can be project-specific or global
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" }),
  
  // Environment configuration
  domainConfig: jsonb("domain_config").$type<{
    baseDomain?: string;
    subdomain?: string;
    customDomain?: string;
    sslEnabled?: boolean;
    sslCertPath?: string;
  }>(),
  
  networkConfig: jsonb("network_config").$type<{
    allowedIPs?: string[];
    corsOrigins?: string[];
    rateLimit?: number;
    proxyTimeout?: number;
  }>(),
  
  deploymentConfig: jsonb("deployment_config").$type<{
    autoDeployEnabled?: boolean;
    deploymentStrategy?: 'rolling' | 'blue-green' | 'canary' | 'recreate';
    healthCheckEnabled?: boolean;
    rollbackEnabled?: boolean;
    maxInstances?: number;
    deployTimeoutMinutes?: number;
  }>(),
  
  resourceLimits: jsonb("resource_limits").$type<{
    memory?: string;
    cpu?: string;
    storage?: string;
    maxServices?: number;
  }>(),
  
  // Preview-specific settings
  previewSettings: jsonb("preview_settings").$type<{
    autoCleanupEnabled?: boolean;
    cleanupAfterDays?: number;
    sourceType?: 'branch' | 'pr' | 'commit';
    sourceBranch?: string;
    sourcePR?: number;
    sourceCommit?: string;
    expiresAt?: string;
  }>(),
  
  // Metadata
  metadata: jsonb("metadata").$type<{
    lastHealthCheck?: string;
    serviceCount?: number;
    deploymentCount?: number;
    lastDeployment?: string;
    accessCount?: number;
    tags?: string[];
  }>(),
  
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// Environment variables - both static and dynamic
export const environmentVariables = pgTable("environment_variables", {
  id: uuid("id").primaryKey().defaultRandom(),
  environmentId: uuid("environment_id")
    .notNull()
    .references(() => environments.id, { onDelete: "cascade" }),
  
  key: text("key").notNull(),
  value: text("value").notNull(),
  isSecret: boolean("is_secret").default(false).notNull(),
  description: text("description"),
  category: text("category"), // for grouping in UI
  
  // Dynamic variable support
  isDynamic: boolean("is_dynamic").default(false).notNull(),
  template: text("template"), // Template with ${} placeholders for dynamic variables
  resolutionStatus: variableResolutionStatusEnum("resolution_status").default("resolved"),
  resolvedValue: text("resolved_value"), // Resolved value for dynamic variables
  resolutionError: text("resolution_error"), // Error message if resolution fails
  lastResolved: timestamp("last_resolved"),
  
  // Variable references for dependency tracking
  references: jsonb("references").$type<Array<{
    type: 'project' | 'service' | 'environment' | 'database';
    id: string;
    property: string;
    path?: string;
  }>>().default([]),
  
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// Environment services - tracks which services are deployed in each environment
export const environmentServices = pgTable("environment_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  environmentId: uuid("environment_id")
    .notNull()
    .references(() => environments.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id")
    .notNull()
    .references(() => services.id, { onDelete: "cascade" }),
  
  // Environment-specific service configuration
  serviceConfig: jsonb("service_config").$type<{
    branch?: string;
    buildCommand?: string;
    startCommand?: string;
    environmentVariables?: Record<string, string>;
    resourceLimits?: {
      memory?: string;
      cpu?: string;
      storage?: string;
    };
    healthCheckPath?: string;
    port?: number;
    replicas?: number;
  }>(),
  
  // Deployment status in this environment
  isDeployed: boolean("is_deployed").default(false).notNull(),
  lastDeploymentId: uuid("last_deployment_id"), // Reference to deployments table
  deploymentStatus: text("deployment_status").default("pending"), // pending, success, failed
  healthStatus: text("health_status").default("unknown"), // healthy, unhealthy, unknown
  lastHealthCheck: timestamp("last_health_check"),
  
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// Variable templates - reusable variable configurations
export const variableTemplates = pgTable("variable_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  
  // Template content
  variables: jsonb("variables").$type<Array<{
    key: string;
    template: string;
    description?: string;
    category?: string;
    required?: boolean;
    defaultValue?: string;
    validation?: Array<{
      type: 'regex' | 'url' | 'email' | 'number' | 'boolean' | 'enum';
      value: string;
      message?: string;
    }>;
  }>>().default([]),
  
  // Usage metadata
  isSystem: boolean("is_system").default(false).notNull(), // System vs user-created
  usageCount: integer("usage_count").default(0).notNull(),
  lastUsed: timestamp("last_used"),
  
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// Environment access logs - track who accessed environments and when
export const environmentAccessLogs = pgTable("environment_access_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  environmentId: uuid("environment_id")
    .notNull()
    .references(() => environments.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .references(() => user.id, { onDelete: "set null" }),
  
  action: text("action").notNull(), // view, deploy, rollback, delete, etc.
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  
  metadata: jsonb("metadata").$type<{
    details?: string;
    serviceId?: string;
    duration?: number;
    success?: boolean;
  }>(),
  
  timestamp: timestamp("timestamp")
    .$defaultFn(() => new Date())
    .notNull(),
});

// Environment promotions - track environment-to-environment promotions
export const environmentPromotions = pgTable("environment_promotions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceEnvironmentId: uuid("source_environment_id")
    .notNull()
    .references(() => environments.id, { onDelete: "cascade" }),
  targetEnvironmentId: uuid("target_environment_id")
    .notNull()
    .references(() => environments.id, { onDelete: "cascade" }),
  
  serviceId: uuid("service_id")
    .references(() => services.id, { onDelete: "cascade" }), // Optional: specific service promotion
  
  status: text("status").default("pending").notNull(), // pending, success, failed, cancelled
  promotedBy: text("promoted_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  
  // Promotion details
  sourceDeploymentId: uuid("source_deployment_id"), // Source deployment being promoted
  targetDeploymentId: uuid("target_deployment_id"), // Resulting deployment in target
  
  metadata: jsonb("metadata").$type<{
    reason?: string;
    approvedBy?: string;
    approvalRequired?: boolean;
    rollbackPlan?: string;
    duration?: number;
    errorMessage?: string;
  }>(),
  
  startedAt: timestamp("started_at")
    .$defaultFn(() => new Date())
    .notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});