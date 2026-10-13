import {
  user2
} from "./migrations-qcwa49zw.mjs";
import {
  zodEnumToPgEnumValues2
} from "./migrations-trk55dxz.mjs";

// packages/nest/schema/src/global/deployment.ts
import { pgTable as pgTable2, text as text2, timestamp as timestamp2, boolean as boolean2, integer as integer2, uuid as uuid2, jsonb as jsonb2, pgEnum as pgEnum2 } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// packages/nest/schema/src/global/environment.ts
import { pgTable, text, timestamp, boolean, uuid, jsonb, pgEnum, integer } from "drizzle-orm/pg-core";
import {
  envNameSchema,
  environmentKindSchema,
  environmentStatusSchema,
  variableResolutionStatusSchema
} from "@deployer/contracts-common";
var environmentKindEnum2 = pgEnum("environment_kind", [
  ...zodEnumToPgEnumValues2(environmentKindSchema)
]);
var environmentTypeEnum2 = pgEnum("environment_type", [
  ...zodEnumToPgEnumValues2(envNameSchema)
]);
var environmentStatusEnum2 = pgEnum("environment_status", [
  ...zodEnumToPgEnumValues2(environmentStatusSchema)
]);
var variableResolutionStatusEnum2 = pgEnum("variable_resolution_status", [
  ...zodEnumToPgEnumValues2(variableResolutionStatusSchema)
]);
var environmentTemplates2 = pgTable("environment_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  type: environmentTypeEnum2("type").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  defaultVariables: jsonb("default_variables").$type().default([]),
  variableDefinitions: jsonb("variable_definitions").$type().default([]),
  deploymentSettings: jsonb("deployment_settings").$type(),
  securitySettings: jsonb("security_settings").$type(),
  createdBy: text("created_by").notNull().references(() => user2.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
});
var environments2 = pgTable("environments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  type: environmentTypeEnum2("type").notNull(),
  kind: environmentKindEnum2("kind").default("stable").notNull(),
  rules: jsonb("rules").$type(),
  trigger: jsonb("trigger").$type(),
  status: environmentStatusEnum2("status").default("pending").notNull(),
  templateId: uuid("template_id").references(() => environmentTemplates2.id, { onDelete: "set null" }),
  projectId: uuid("project_id").notNull().references(() => projects2.id, { onDelete: "cascade" }),
  domainConfig: jsonb("domain_config").$type(),
  networkConfig: jsonb("network_config").$type(),
  deploymentConfig: jsonb("deployment_config").$type(),
  resourceLimits: jsonb("resource_limits").$type(),
  previewSettings: jsonb("preview_settings").$type(),
  metadata: jsonb("metadata").$type(),
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: text("created_by").notNull().references(() => user2.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
});
var serviceEnvironments2 = pgTable("service_environments", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceId: uuid("service_id").notNull().references(() => services2.id, { onDelete: "cascade" }),
  environmentId: uuid("environment_id").notNull().references(() => environments2.id, { onDelete: "cascade" }),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  overrides: jsonb("overrides").$type(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
});
var environmentVariables2 = pgTable("environment_variables", {
  id: uuid("id").primaryKey().defaultRandom(),
  environmentId: uuid("environment_id").notNull().references(() => environments2.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: text("value").notNull(),
  isSecret: boolean("is_secret").default(false).notNull(),
  description: text("description"),
  category: text("category"),
  isDynamic: boolean("is_dynamic").default(false).notNull(),
  template: text("template"),
  resolutionStatus: variableResolutionStatusEnum2("resolution_status").default("resolved"),
  resolvedValue: text("resolved_value"),
  resolutionError: text("resolution_error"),
  lastResolved: timestamp("last_resolved"),
  references: jsonb("references").$type().default([]),
  createdBy: text("created_by").notNull().references(() => user2.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
});
var environmentServices2 = pgTable("environment_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  environmentId: uuid("environment_id").notNull().references(() => environments2.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").notNull().references(() => services2.id, { onDelete: "cascade" }),
  serviceConfig: jsonb("service_config").$type(),
  isDeployed: boolean("is_deployed").default(false).notNull(),
  lastDeploymentId: uuid("last_deployment_id"),
  deploymentStatus: text("deployment_status").default("pending"),
  healthStatus: text("health_status").default("unknown"),
  lastHealthCheck: timestamp("last_health_check"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
});
var variableTemplates2 = pgTable("variable_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  variables: jsonb("variables").$type().default([]),
  isSystem: boolean("is_system").default(false).notNull(),
  usageCount: integer("usage_count").default(0).notNull(),
  lastUsed: timestamp("last_used"),
  createdBy: text("created_by").notNull().references(() => user2.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date).notNull()
});
var environmentAccessLogs2 = pgTable("environment_access_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  environmentId: uuid("environment_id").notNull().references(() => environments2.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => user2.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata").$type(),
  timestamp: timestamp("timestamp").$defaultFn(() => new Date).notNull()
});
var environmentPromotions2 = pgTable("environment_promotions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceEnvironmentId: uuid("source_environment_id").notNull().references(() => environments2.id, { onDelete: "cascade" }),
  targetEnvironmentId: uuid("target_environment_id").notNull().references(() => environments2.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").references(() => services2.id, { onDelete: "cascade" }),
  status: text("status").default("pending").notNull(),
  promotedBy: text("promoted_by").notNull().references(() => user2.id, { onDelete: "cascade" }),
  sourceDeploymentId: uuid("source_deployment_id"),
  targetDeploymentId: uuid("target_deployment_id"),
  metadata: jsonb("metadata").$type(),
  startedAt: timestamp("started_at").$defaultFn(() => new Date).notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date).notNull()
});

// packages/nest/schema/src/global/deployment.ts
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
  sourceTypeSchema
} from "@deployer/contracts-common";
import { PROJECT_ROLES } from "@deployer/auth";
var projectRoleEnum2 = pgEnum2("project_role", [...PROJECT_ROLES]);
var deploymentStatusEnum2 = pgEnum2("deployment_status", [...zodEnumToPgEnumValues2(deploymentStatusSchema)]);
var deploymentPhaseEnum2 = pgEnum2("deployment_phase", [...zodEnumToPgEnumValues2(deploymentPhaseSchema)]);
var deploymentEnvironmentEnum2 = pgEnum2("deployment_environment", [...zodEnumToPgEnumValues2(deploymentEnvironmentSchema)]);
var sourceTypeEnum2 = pgEnum2("source_type", [...zodEnumToPgEnumValues2(sourceTypeSchema)]);
var logLevelEnum2 = pgEnum2("log_level", [...zodEnumToPgEnumValues2(logLevelSchema)]);
var serviceTypeEnum2 = pgEnum2("service_type", [...zodEnumToPgEnumValues2(serviceTypeSchema)]);
var serviceProviderTypeEnum2 = pgEnum2("service_provider_type", [...zodEnumToPgEnumValues2(serviceProviderTypeSchema)]);
var serviceRunnerTypeEnum2 = pgEnum2("service_runner_type", [...zodEnumToPgEnumValues2(serviceRunnerTypeSchema)]);
var projects2 = pgTable2("projects", {
  id: uuid2("id").primaryKey().defaultRandom(),
  name: text2("name").notNull(),
  description: text2("description"),
  baseDomain: text2("base_domain"),
  network: jsonb2("network").$type(),
  ownerId: text2("owner_id").notNull().references(() => user2.id, { onDelete: "cascade" }),
  settings: jsonb2("settings").$type(),
  metadata: jsonb2("metadata").$type(),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var services2 = pgTable2("services", {
  id: uuid2("id").primaryKey().defaultRandom(),
  projectId: uuid2("project_id").notNull().references(() => projects2.id, { onDelete: "cascade" }),
  name: text2("name").notNull(),
  description: text2("description"),
  type: serviceTypeEnum2("type").notNull(),
  providerId: serviceProviderTypeEnum2("provider_id").notNull(),
  providerConfig: jsonb2("provider_config").$type(),
  builderId: serviceRunnerTypeEnum2("builder_id").notNull(),
  builderConfig: jsonb2("builder_config").$type(),
  port: integer2("port"),
  environmentVariables: jsonb2("environment_variables").$type(),
  resourceLimits: jsonb2("resource_limits").$type(),
  healthCheckPath: text2("health_check_path").default("/health"),
  healthCheckInterval: integer2("health_check_interval").default(30),
  healthCheckTimeout: integer2("health_check_timeout").default(10),
  healthCheckRetries: integer2("health_check_retries").default(3),
  deploymentRetention: jsonb2("deployment_retention").$type().default({
    maxSuccessfulDeployments: 5,
    keepArtifacts: true,
    autoCleanup: true
  }),
  traefikConfig: traefikConfigBuilder("traefik_config"),
  customDomains: jsonb2("custom_domains").$type(),
  network: jsonb2("network").$type(),
  implementsContract: jsonb2("implements_contract").$type(),
  preview: jsonb2("preview").$type(),
  isActive: boolean2("is_active").default(true).notNull(),
  metadata: jsonb2("metadata").$type(),
  parentId: uuid2("parent_id").references(() => services2.id, { onDelete: "cascade" }),
  parentPath: text2("parent_path"),
  depth: integer2("depth").default(0).notNull(),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var serviceDependencies2 = pgTable2("service_dependencies", {
  id: uuid2("id").primaryKey().defaultRandom(),
  serviceId: uuid2("service_id").notNull().references(() => services2.id, { onDelete: "cascade" }),
  dependsOnServiceId: uuid2("depends_on_service_id").notNull().references(() => services2.id, { onDelete: "cascade" }),
  isRequired: boolean2("is_required").default(true).notNull(),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull()
});
var deployments2 = pgTable2("deployments", {
  id: uuid2("id").primaryKey().defaultRandom(),
  serviceId: uuid2("service_id").notNull().references(() => services2.id, { onDelete: "cascade" }),
  triggeredBy: text2("triggered_by").references(() => user2.id, { onDelete: "set null" }),
  status: deploymentStatusEnum2("status").default("pending").notNull(),
  environment: deploymentEnvironmentEnum2("environment").default("production").notNull(),
  environmentId: uuid2("environment_id").references(() => environments2.id, { onDelete: "set null" }),
  sourceType: sourceTypeEnum2("source_type").notNull(),
  sourceConfig: jsonb2("source_config").$type(),
  buildStartedAt: timestamp2("build_started_at"),
  buildCompletedAt: timestamp2("build_completed_at"),
  deployStartedAt: timestamp2("deploy_started_at"),
  deployCompletedAt: timestamp2("deploy_completed_at"),
  containerName: text2("container_name"),
  containerImage: text2("container_image"),
  domainUrl: text2("domain_url"),
  healthCheckUrl: text2("health_check_url"),
  errorMessage: text2("error_message"),
  phase: deploymentPhaseEnum2("phase").default("queued"),
  phaseProgress: integer2("phase_progress").default(0),
  phaseMetadata: jsonb2("phase_metadata").$type(),
  phaseUpdatedAt: timestamp2("phase_updated_at").$defaultFn(() => new Date),
  metadata: jsonb2("metadata").$type(),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var previewEnvironments2 = pgTable2("preview_environments", {
  id: uuid2("id").primaryKey().defaultRandom(),
  deploymentId: uuid2("deployment_id").notNull().references(() => deployments2.id, { onDelete: "cascade" }),
  subdomain: text2("subdomain").notNull().unique(),
  fullDomain: text2("full_domain").notNull(),
  sslEnabled: boolean2("ssl_enabled").default(true).notNull(),
  sslCertificatePath: text2("ssl_certificate_path"),
  expiresAt: timestamp2("expires_at"),
  isActive: boolean2("is_active").default(true).notNull(),
  webhookTriggered: boolean2("webhook_triggered").default(false).notNull(),
  environmentVariables: jsonb2("environment_variables").$type(),
  metadata: jsonb2("metadata").$type(),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var deploymentLogs2 = pgTable2("deployment_logs", {
  id: uuid2("id").primaryKey().defaultRandom(),
  deploymentId: uuid2("deployment_id").notNull().references(() => deployments2.id, { onDelete: "cascade" }),
  level: logLevelEnum2("level").default("info").notNull(),
  message: text2("message").notNull(),
  phase: text2("phase"),
  step: text2("step"),
  service: text2("service"),
  stage: text2("stage"),
  metadata: jsonb2("metadata").$type(),
  timestamp: timestamp2("timestamp").$defaultFn(() => new Date).notNull()
});
var deploymentStreams2 = pgTable2("deployment_streams", {
  id: uuid2("id").primaryKey().defaultRandom(),
  coreStreamId: uuid2("core_stream_id"),
  name: text2("name").notNull(),
  description: text2("description"),
  isActive: boolean2("is_active").default(true).notNull(),
  deploymentId: uuid2("deployment_id").references(() => deployments2.id, { onDelete: "cascade" }),
  serviceId: uuid2("service_id").references(() => services2.id, { onDelete: "cascade" }),
  projectId: uuid2("project_id").references(() => projects2.id, { onDelete: "cascade" }),
  statusFilter: deploymentStatusEnum2("status_filter"),
  environmentFilter: deploymentEnvironmentEnum2("environment_filter"),
  eventTypes: jsonb2("event_types").$type(),
  replayDefault: boolean2("replay_default").default(true).notNull(),
  replayLimitDefault: integer2("replay_limit_default").default(100).notNull(),
  createdBy: text2("created_by").references(() => user2.id, { onDelete: "set null" }),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var projectCollaborators2 = pgTable2("project_collaborators", {
  id: uuid2("id").primaryKey().defaultRandom(),
  projectId: uuid2("project_id").notNull().references(() => projects2.id, { onDelete: "cascade" }),
  userId: text2("user_id").notNull().references(() => user2.id, { onDelete: "cascade" }),
  role: projectRoleEnum2("role").default("viewer").notNull(),
  permissions: jsonb2("permissions").$type(),
  invitedBy: text2("invited_by").references(() => user2.id, { onDelete: "set null" }),
  invitedAt: timestamp2("invited_at").$defaultFn(() => new Date).notNull(),
  acceptedAt: timestamp2("accepted_at"),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var webhooks2 = pgTable2("webhooks", {
  id: uuid2("id").primaryKey().defaultRandom(),
  projectId: uuid2("project_id").notNull().references(() => projects2.id, { onDelete: "cascade" }),
  serviceId: uuid2("service_id").references(() => services2.id, { onDelete: "cascade" }),
  sourceType: sourceTypeEnum2("source_type").notNull(),
  webhookUrl: text2("webhook_url").notNull(),
  externalWebhookId: text2("external_webhook_id"),
  secret: encryptedText("secret").notNull(),
  isActive: boolean2("is_active").default(true).notNull(),
  lastTriggered: timestamp2("last_triggered"),
  triggerCount: integer2("trigger_count").default(0).notNull(),
  settings: jsonb2("settings").$type(),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var apiKeys2 = pgTable2("api_keys", {
  id: uuid2("id").primaryKey().defaultRandom(),
  userId: text2("user_id").notNull().references(() => user2.id, { onDelete: "cascade" }),
  projectId: uuid2("project_id").references(() => projects2.id, { onDelete: "cascade" }),
  name: text2("name").notNull(),
  keyHash: text2("key_hash").notNull().unique(),
  keyPreview: text2("key_preview").notNull(),
  scopes: jsonb2("scopes").$type(),
  lastUsed: timestamp2("last_used"),
  expiresAt: timestamp2("expires_at"),
  isActive: boolean2("is_active").default(true).notNull(),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var rollbackStatusEnum2 = pgEnum2("rollback_status", [...zodEnumToPgEnumValues2(rollbackStatusSchema)]);
var deploymentRollbacks2 = pgTable2("deployment_rollbacks", {
  id: uuid2("id").primaryKey().defaultRandom(),
  fromDeploymentId: uuid2("from_deployment_id").notNull().references(() => deployments2.id, { onDelete: "cascade" }),
  toDeploymentId: uuid2("to_deployment_id").notNull().references(() => deployments2.id, { onDelete: "cascade" }),
  triggeredBy: text2("triggered_by").references(() => user2.id, { onDelete: "set null" }),
  status: rollbackStatusEnum2("status").default("pending").notNull(),
  reason: text2("reason"),
  startedAt: timestamp2("started_at"),
  completedAt: timestamp2("completed_at"),
  failedAt: timestamp2("failed_at"),
  errorMessage: text2("error_message"),
  metadata: jsonb2("metadata").$type(),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var githubInstallations2 = pgTable2("github_installations", {
  id: uuid2("id").primaryKey().defaultRandom(),
  userId: text2("user_id").notNull().references(() => user2.id, { onDelete: "cascade" }),
  installationId: integer2("installation_id").notNull().unique(),
  accountLogin: text2("account_login").notNull(),
  accountType: text2("account_type").notNull(),
  accountAvatarUrl: text2("account_avatar_url"),
  repositoriesCount: integer2("repositories_count").default(0),
  appId: text2("app_id"),
  privateKey: encryptedText("private_key"),
  clientId: text2("client_id"),
  clientSecret: encryptedText("client_secret"),
  webhookSecret: encryptedText("webhook_secret"),
  permissions: jsonb2("permissions").$type(),
  accessTokenUrl: text2("access_token_url"),
  htmlUrl: text2("html_url"),
  isActive: boolean2("is_active").default(true).notNull(),
  lastSyncedAt: timestamp2("last_synced_at"),
  metadata: jsonb2("metadata").$type(),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var githubRepositories2 = pgTable2("github_repositories", {
  id: uuid2("id").primaryKey().defaultRandom(),
  installationId: uuid2("installation_id").notNull().references(() => githubInstallations2.id, { onDelete: "cascade" }),
  repositoryId: integer2("repository_id").notNull().unique(),
  name: text2("name").notNull(),
  fullName: text2("full_name").notNull(),
  private: boolean2("private").notNull(),
  htmlUrl: text2("html_url").notNull(),
  description: text2("description"),
  defaultBranch: text2("default_branch").notNull(),
  language: text2("language"),
  forksCount: integer2("forks_count").default(0),
  stargazersCount: integer2("stargazers_count").default(0),
  isActive: boolean2("is_active").default(true).notNull(),
  lastSyncedAt: timestamp2("last_synced_at"),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var deploymentRuleTriggerEnum2 = pgEnum2("deployment_rule_trigger", [
  "push",
  "pull_request",
  "tag",
  "release",
  "manual"
]);
var deploymentRules2 = pgTable2("deployment_rules", {
  id: uuid2("id").primaryKey().defaultRandom(),
  serviceId: uuid2("service_id").notNull().references(() => services2.id, { onDelete: "cascade" }),
  name: text2("name").notNull(),
  trigger: deploymentRuleTriggerEnum2("trigger").notNull(),
  isEnabled: boolean2("is_enabled").default(true).notNull(),
  priority: integer2("priority").default(0).notNull(),
  branchPattern: text2("branch_pattern"),
  excludeBranchPattern: text2("exclude_branch_pattern"),
  tagPattern: text2("tag_pattern"),
  prLabels: jsonb2("pr_labels").$type(),
  prTargetBranches: jsonb2("pr_target_branches").$type(),
  requireApproval: boolean2("require_approval").default(false),
  minApprovals: integer2("min_approvals").default(1),
  environment: deploymentEnvironmentEnum2("environment").notNull(),
  autoMergeOnSuccess: boolean2("auto_merge_on_success").default(false),
  autoDeleteOnMerge: boolean2("auto_delete_on_merge").default(true),
  environmentVariables: jsonb2("environment_variables").$type(),
  builderConfigOverride: jsonb2("builder_config_override").$type(),
  metadata: jsonb2("metadata").$type(),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var projectsRelations2 = relations(projects2, ({ one, many }) => ({
  owner: one(user2, {
    fields: [projects2.ownerId],
    references: [user2.id]
  }),
  services: many(services2),
  collaborators: many(projectCollaborators2),
  webhooks: many(webhooks2),
  apiKeys: many(apiKeys2)
}));
var servicesRelations2 = relations(services2, ({ one, many }) => ({
  project: one(projects2, {
    fields: [services2.projectId],
    references: [projects2.id]
  }),
  parent: one(services2, {
    fields: [services2.parentId],
    references: [services2.id],
    relationName: "serviceChildren"
  }),
  children: many(services2, {
    relationName: "serviceChildren"
  }),
  deployments: many(deployments2),
  dependencies: many(serviceDependencies2, {
    relationName: "serviceDependencies"
  }),
  dependents: many(serviceDependencies2, {
    relationName: "serviceDependents"
  }),
  webhooks: many(webhooks2),
  deploymentRules: many(deploymentRules2)
}));
var serviceDependenciesRelations2 = relations(serviceDependencies2, ({ one }) => ({
  service: one(services2, {
    fields: [serviceDependencies2.serviceId],
    references: [services2.id],
    relationName: "serviceDependencies"
  }),
  dependsOnService: one(services2, {
    fields: [serviceDependencies2.dependsOnServiceId],
    references: [services2.id],
    relationName: "serviceDependents"
  })
}));
var deploymentsRelations2 = relations(deployments2, ({ one, many }) => ({
  service: one(services2, {
    fields: [deployments2.serviceId],
    references: [services2.id]
  }),
  triggeredByUser: one(user2, {
    fields: [deployments2.triggeredBy],
    references: [user2.id]
  }),
  previewEnvironments: many(previewEnvironments2),
  logs: many(deploymentLogs2)
}));
var previewEnvironmentsRelations2 = relations(previewEnvironments2, ({ one }) => ({
  deployment: one(deployments2, {
    fields: [previewEnvironments2.deploymentId],
    references: [deployments2.id]
  })
}));
var deploymentLogsRelations2 = relations(deploymentLogs2, ({ one }) => ({
  deployment: one(deployments2, {
    fields: [deploymentLogs2.deploymentId],
    references: [deployments2.id]
  })
}));
var deploymentStreamsRelations2 = relations(deploymentStreams2, ({ one }) => ({
  deployment: one(deployments2, {
    fields: [deploymentStreams2.deploymentId],
    references: [deployments2.id]
  }),
  service: one(services2, {
    fields: [deploymentStreams2.serviceId],
    references: [services2.id]
  }),
  project: one(projects2, {
    fields: [deploymentStreams2.projectId],
    references: [projects2.id]
  }),
  createdByUser: one(user2, {
    fields: [deploymentStreams2.createdBy],
    references: [user2.id]
  })
}));
var projectCollaboratorsRelations2 = relations(projectCollaborators2, ({ one }) => ({
  project: one(projects2, {
    fields: [projectCollaborators2.projectId],
    references: [projects2.id]
  }),
  user: one(user2, {
    fields: [projectCollaborators2.userId],
    references: [user2.id]
  }),
  invitedByUser: one(user2, {
    fields: [projectCollaborators2.invitedBy],
    references: [user2.id]
  })
}));
var webhooksRelations2 = relations(webhooks2, ({ one }) => ({
  project: one(projects2, {
    fields: [webhooks2.projectId],
    references: [projects2.id]
  }),
  service: one(services2, {
    fields: [webhooks2.serviceId],
    references: [services2.id]
  })
}));
var apiKeysRelations2 = relations(apiKeys2, ({ one }) => ({
  user: one(user2, {
    fields: [apiKeys2.userId],
    references: [user2.id]
  }),
  project: one(projects2, {
    fields: [apiKeys2.projectId],
    references: [projects2.id]
  })
}));
var deploymentRollbacksRelations2 = relations(deploymentRollbacks2, ({ one }) => ({
  fromDeployment: one(deployments2, {
    fields: [deploymentRollbacks2.fromDeploymentId],
    references: [deployments2.id]
  }),
  toDeployment: one(deployments2, {
    fields: [deploymentRollbacks2.toDeploymentId],
    references: [deployments2.id]
  }),
  triggeredByUser: one(user2, {
    fields: [deploymentRollbacks2.triggeredBy],
    references: [user2.id]
  })
}));
var githubInstallationsRelations2 = relations(githubInstallations2, ({ one, many }) => ({
  user: one(user2, {
    fields: [githubInstallations2.userId],
    references: [user2.id]
  }),
  repositories: many(githubRepositories2)
}));
var githubRepositoriesRelations2 = relations(githubRepositories2, ({ one }) => ({
  installation: one(githubInstallations2, {
    fields: [githubRepositories2.installationId],
    references: [githubInstallations2.id]
  })
}));
var deploymentRulesRelations2 = relations(deploymentRules2, ({ one }) => ({
  service: one(services2, {
    fields: [deploymentRules2.serviceId],
    references: [services2.id]
  })
}));

export { environmentKindEnum2, environmentTypeEnum2, environmentStatusEnum2, variableResolutionStatusEnum2, environmentTemplates2, environments2, serviceEnvironments2, environmentVariables2, environmentServices2, variableTemplates2, environmentAccessLogs2, environmentPromotions2, projectRoleEnum2, deploymentStatusEnum2, deploymentPhaseEnum2, deploymentEnvironmentEnum2, sourceTypeEnum2, logLevelEnum2, serviceTypeEnum2, serviceProviderTypeEnum2, serviceRunnerTypeEnum2, projects2, services2, serviceDependencies2, deployments2, previewEnvironments2, deploymentLogs2, deploymentStreams2, projectCollaborators2, webhooks2, apiKeys2, rollbackStatusEnum2, deploymentRollbacks2, githubInstallations2, githubRepositories2, deploymentRuleTriggerEnum2, deploymentRules2, projectsRelations2, servicesRelations2, serviceDependenciesRelations2, deploymentsRelations2, previewEnvironmentsRelations2, deploymentLogsRelations2, deploymentStreamsRelations2, projectCollaboratorsRelations2, webhooksRelations2, apiKeysRelations2, deploymentRollbacksRelations2, githubInstallationsRelations2, githubRepositoriesRelations2, deploymentRulesRelations2 };
