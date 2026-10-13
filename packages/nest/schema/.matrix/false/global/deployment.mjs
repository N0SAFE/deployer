// packages/nest/schema/src/global/deployment.ts
import { pgTable as pgTable3, text as text3, timestamp as timestamp3, boolean as boolean3, integer as integer3, uuid as uuid2, jsonb as jsonb2, pgEnum as pgEnum2 } from "drizzle-orm/pg-core";
import { relations as relations2 } from "drizzle-orm";

// packages/nest/schema/src/global/auth.ts
import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";
var user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date).notNull(),
  role: text("role").default("user").notNull(),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false)
});
var session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by")
}, (table) => [index("session_userId_idx").on(table.userId)]);
var account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date).notNull()
}, (table) => [index("account_userId_idx").on(table.userId)]);
var verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date).notNull()
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);
var platformInvite = pgTable("platform_invite", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  invitedUserId: text("invited_user_id").notNull().references(() => user.id, { onDelete: "cascade" })
});
var userVapidKeys = pgTable("user_vapid_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => user.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  subject: text("subject"),
  createdAt: timestamp("created_at").notNull()
});
var pushSubscription = pgTable("push_subscription", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  deviceName: text("device_name"),
  userAgent: text("user_agent"),
  isActive: boolean("is_active").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  lastUsedAt: timestamp("last_used_at")
});
var apikey = pgTable("apikey", {
  id: text("id").primaryKey(),
  configId: text("config_id").default("default").notNull(),
  name: text("name"),
  start: text("start"),
  referenceId: text("reference_id").notNull(),
  prefix: text("prefix"),
  key: text("key").notNull(),
  refillInterval: integer("refill_interval"),
  refillAmount: integer("refill_amount"),
  lastRefillAt: timestamp("last_refill_at"),
  enabled: boolean("enabled").default(true),
  rateLimitEnabled: boolean("rate_limit_enabled").default(true),
  rateLimitTimeWindow: integer("rate_limit_time_window").default(3600000),
  rateLimitMax: integer("rate_limit_max").default(1000),
  requestCount: integer("request_count").default(0),
  remaining: integer("remaining"),
  lastRequest: timestamp("last_request"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  permissions: text("permissions"),
  metadata: text("metadata")
}, (table) => [
  index("apikey_configId_idx").on(table.configId),
  index("apikey_referenceId_idx").on(table.referenceId),
  index("apikey_key_idx").on(table.key)
]);
var passkey = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports"),
  createdAt: timestamp("created_at"),
  aaguid: text("aaguid")
}, (table) => [
  index("passkey_userId_idx").on(table.userId),
  index("passkey_credentialID_idx").on(table.credentialID)
]);
var twoFactor = pgTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  verified: boolean("verified").default(true),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: timestamp("locked_until")
}, (table) => [
  index("twoFactor_secret_idx").on(table.secret),
  index("twoFactor_userId_idx").on(table.userId)
]);
var deviceCode = pgTable("device_code", {
  id: text("id").primaryKey(),
  deviceCode: text("device_code").notNull(),
  userCode: text("user_code").notNull(),
  userId: text("user_id"),
  expiresAt: timestamp("expires_at").notNull(),
  status: text("status").notNull(),
  lastPolledAt: timestamp("last_polled_at"),
  pollingInterval: integer("polling_interval"),
  clientId: text("client_id"),
  scope: text("scope")
}, (table) => [
  uniqueIndex("deviceCode_deviceCode_uidx").on(table.deviceCode),
  uniqueIndex("deviceCode_userCode_uidx").on(table.userCode)
]);
var userRelations = relations(user, ({ one, many }) => ({
  sessions: many(session),
  accounts: many(account),
  platformInvites: many(platformInvite),
  userVapidKeys: one(userVapidKeys),
  pushSubscriptions: many(pushSubscription),
  passkeys: many(passkey),
  twoFactors: many(twoFactor)
}));
var sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id]
  })
}));
var accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id]
  })
}));
var platformInviteRelations = relations(platformInvite, ({ one }) => ({
  user: one(user, {
    fields: [platformInvite.invitedUserId],
    references: [user.id]
  })
}));
var userVapidKeysRelations = relations(userVapidKeys, ({ one }) => ({
  user: one(user, {
    fields: [userVapidKeys.userId],
    references: [user.id]
  })
}));
var pushSubscriptionRelations = relations(pushSubscription, ({ one }) => ({
  user: one(user, {
    fields: [pushSubscription.userId],
    references: [user.id]
  })
}));

// packages/nest/schema/src/global/environment.ts
import { pgTable as pgTable2, text as text2, timestamp as timestamp2, boolean as boolean2, uuid, jsonb, pgEnum, integer as integer2 } from "drizzle-orm/pg-core";
import {
  envNameSchema,
  environmentKindSchema,
  environmentStatusSchema,
  variableResolutionStatusSchema
} from "@deployer/contracts-common";

// packages/nest/schema/src/global/utils/zod-enum.ts
import { AppError } from "@deployer/errors";
function zodEnumToPgEnumValues(schema) {
  const values = [...schema.options];
  if (values.length === 0) {
    throw new AppError("zodEnumToPgEnumValues requires at least one enum value", "INTERNAL_ERROR");
  }
  return values;
}

// packages/nest/schema/src/global/environment.ts
var environmentKindEnum = pgEnum("environment_kind", [
  ...zodEnumToPgEnumValues(environmentKindSchema)
]);
var environmentTypeEnum = pgEnum("environment_type", [
  ...zodEnumToPgEnumValues(envNameSchema)
]);
var environmentStatusEnum = pgEnum("environment_status", [
  ...zodEnumToPgEnumValues(environmentStatusSchema)
]);
var variableResolutionStatusEnum = pgEnum("variable_resolution_status", [
  ...zodEnumToPgEnumValues(variableResolutionStatusSchema)
]);
var environmentTemplates = pgTable2("environment_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text2("name").notNull(),
  description: text2("description"),
  type: environmentTypeEnum("type").notNull(),
  isDefault: boolean2("is_default").default(false).notNull(),
  defaultVariables: jsonb("default_variables").$type().default([]),
  variableDefinitions: jsonb("variable_definitions").$type().default([]),
  deploymentSettings: jsonb("deployment_settings").$type(),
  securitySettings: jsonb("security_settings").$type(),
  createdBy: text2("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var environments = pgTable2("environments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text2("name").notNull(),
  slug: text2("slug").notNull(),
  description: text2("description"),
  type: environmentTypeEnum("type").notNull(),
  kind: environmentKindEnum("kind").default("stable").notNull(),
  rules: jsonb("rules").$type(),
  trigger: jsonb("trigger").$type(),
  status: environmentStatusEnum("status").default("pending").notNull(),
  templateId: uuid("template_id").references(() => environmentTemplates.id, { onDelete: "set null" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  domainConfig: jsonb("domain_config").$type(),
  networkConfig: jsonb("network_config").$type(),
  deploymentConfig: jsonb("deployment_config").$type(),
  resourceLimits: jsonb("resource_limits").$type(),
  previewSettings: jsonb("preview_settings").$type(),
  metadata: jsonb("metadata").$type(),
  isActive: boolean2("is_active").default(true).notNull(),
  createdBy: text2("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var serviceEnvironments = pgTable2("service_environments", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  environmentId: uuid("environment_id").notNull().references(() => environments.id, { onDelete: "cascade" }),
  isEnabled: boolean2("is_enabled").default(true).notNull(),
  overrides: jsonb("overrides").$type(),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var environmentVariables = pgTable2("environment_variables", {
  id: uuid("id").primaryKey().defaultRandom(),
  environmentId: uuid("environment_id").notNull().references(() => environments.id, { onDelete: "cascade" }),
  key: text2("key").notNull(),
  value: text2("value").notNull(),
  isSecret: boolean2("is_secret").default(false).notNull(),
  description: text2("description"),
  category: text2("category"),
  isDynamic: boolean2("is_dynamic").default(false).notNull(),
  template: text2("template"),
  resolutionStatus: variableResolutionStatusEnum("resolution_status").default("resolved"),
  resolvedValue: text2("resolved_value"),
  resolutionError: text2("resolution_error"),
  lastResolved: timestamp2("last_resolved"),
  references: jsonb("references").$type().default([]),
  createdBy: text2("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var environmentServices = pgTable2("environment_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  environmentId: uuid("environment_id").notNull().references(() => environments.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  serviceConfig: jsonb("service_config").$type(),
  isDeployed: boolean2("is_deployed").default(false).notNull(),
  lastDeploymentId: uuid("last_deployment_id"),
  deploymentStatus: text2("deployment_status").default("pending"),
  healthStatus: text2("health_status").default("unknown"),
  lastHealthCheck: timestamp2("last_health_check"),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var variableTemplates = pgTable2("variable_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text2("name").notNull(),
  description: text2("description"),
  variables: jsonb("variables").$type().default([]),
  isSystem: boolean2("is_system").default(false).notNull(),
  usageCount: integer2("usage_count").default(0).notNull(),
  lastUsed: timestamp2("last_used"),
  createdBy: text2("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp2("updated_at").$defaultFn(() => new Date).notNull()
});
var environmentAccessLogs = pgTable2("environment_access_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  environmentId: uuid("environment_id").notNull().references(() => environments.id, { onDelete: "cascade" }),
  userId: text2("user_id").references(() => user.id, { onDelete: "set null" }),
  action: text2("action").notNull(),
  ipAddress: text2("ip_address"),
  userAgent: text2("user_agent"),
  metadata: jsonb("metadata").$type(),
  timestamp: timestamp2("timestamp").$defaultFn(() => new Date).notNull()
});
var environmentPromotions = pgTable2("environment_promotions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceEnvironmentId: uuid("source_environment_id").notNull().references(() => environments.id, { onDelete: "cascade" }),
  targetEnvironmentId: uuid("target_environment_id").notNull().references(() => environments.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").references(() => services.id, { onDelete: "cascade" }),
  status: text2("status").default("pending").notNull(),
  promotedBy: text2("promoted_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  sourceDeploymentId: uuid("source_deployment_id"),
  targetDeploymentId: uuid("target_deployment_id"),
  metadata: jsonb("metadata").$type(),
  startedAt: timestamp2("started_at").$defaultFn(() => new Date).notNull(),
  completedAt: timestamp2("completed_at"),
  createdAt: timestamp2("created_at").$defaultFn(() => new Date).notNull()
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
var projectRoleEnum = pgEnum2("project_role", [...PROJECT_ROLES]);
var deploymentStatusEnum = pgEnum2("deployment_status", [...zodEnumToPgEnumValues(deploymentStatusSchema)]);
var deploymentPhaseEnum = pgEnum2("deployment_phase", [...zodEnumToPgEnumValues(deploymentPhaseSchema)]);
var deploymentEnvironmentEnum = pgEnum2("deployment_environment", [...zodEnumToPgEnumValues(deploymentEnvironmentSchema)]);
var sourceTypeEnum = pgEnum2("source_type", [...zodEnumToPgEnumValues(sourceTypeSchema)]);
var logLevelEnum = pgEnum2("log_level", [...zodEnumToPgEnumValues(logLevelSchema)]);
var serviceTypeEnum = pgEnum2("service_type", [...zodEnumToPgEnumValues(serviceTypeSchema)]);
var serviceProviderTypeEnum = pgEnum2("service_provider_type", [...zodEnumToPgEnumValues(serviceProviderTypeSchema)]);
var serviceRunnerTypeEnum = pgEnum2("service_runner_type", [...zodEnumToPgEnumValues(serviceRunnerTypeSchema)]);
var projects = pgTable3("projects", {
  id: uuid2("id").primaryKey().defaultRandom(),
  name: text3("name").notNull(),
  description: text3("description"),
  baseDomain: text3("base_domain"),
  network: jsonb2("network").$type(),
  ownerId: text3("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  settings: jsonb2("settings").$type(),
  metadata: jsonb2("metadata").$type(),
  createdAt: timestamp3("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp3("updated_at").$defaultFn(() => new Date).notNull()
});
var services = pgTable3("services", {
  id: uuid2("id").primaryKey().defaultRandom(),
  projectId: uuid2("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text3("name").notNull(),
  description: text3("description"),
  type: serviceTypeEnum("type").notNull(),
  providerId: serviceProviderTypeEnum("provider_id").notNull(),
  providerConfig: jsonb2("provider_config").$type(),
  builderId: serviceRunnerTypeEnum("builder_id").notNull(),
  builderConfig: jsonb2("builder_config").$type(),
  port: integer3("port"),
  environmentVariables: jsonb2("environment_variables").$type(),
  resourceLimits: jsonb2("resource_limits").$type(),
  healthCheckPath: text3("health_check_path").default("/health"),
  healthCheckInterval: integer3("health_check_interval").default(30),
  healthCheckTimeout: integer3("health_check_timeout").default(10),
  healthCheckRetries: integer3("health_check_retries").default(3),
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
  isActive: boolean3("is_active").default(true).notNull(),
  metadata: jsonb2("metadata").$type(),
  parentId: uuid2("parent_id").references(() => services.id, { onDelete: "cascade" }),
  parentPath: text3("parent_path"),
  depth: integer3("depth").default(0).notNull(),
  createdAt: timestamp3("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp3("updated_at").$defaultFn(() => new Date).notNull()
});
var serviceDependencies = pgTable3("service_dependencies", {
  id: uuid2("id").primaryKey().defaultRandom(),
  serviceId: uuid2("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  dependsOnServiceId: uuid2("depends_on_service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  isRequired: boolean3("is_required").default(true).notNull(),
  createdAt: timestamp3("created_at").$defaultFn(() => new Date).notNull()
});
var deployments = pgTable3("deployments", {
  id: uuid2("id").primaryKey().defaultRandom(),
  serviceId: uuid2("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  triggeredBy: text3("triggered_by").references(() => user.id, { onDelete: "set null" }),
  status: deploymentStatusEnum("status").default("pending").notNull(),
  environment: deploymentEnvironmentEnum("environment").default("production").notNull(),
  environmentId: uuid2("environment_id").references(() => environments.id, { onDelete: "set null" }),
  sourceType: sourceTypeEnum("source_type").notNull(),
  sourceConfig: jsonb2("source_config").$type(),
  buildStartedAt: timestamp3("build_started_at"),
  buildCompletedAt: timestamp3("build_completed_at"),
  deployStartedAt: timestamp3("deploy_started_at"),
  deployCompletedAt: timestamp3("deploy_completed_at"),
  containerName: text3("container_name"),
  containerImage: text3("container_image"),
  domainUrl: text3("domain_url"),
  healthCheckUrl: text3("health_check_url"),
  errorMessage: text3("error_message"),
  phase: deploymentPhaseEnum("phase").default("queued"),
  phaseProgress: integer3("phase_progress").default(0),
  phaseMetadata: jsonb2("phase_metadata").$type(),
  phaseUpdatedAt: timestamp3("phase_updated_at").$defaultFn(() => new Date),
  metadata: jsonb2("metadata").$type(),
  createdAt: timestamp3("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp3("updated_at").$defaultFn(() => new Date).notNull()
});
var previewEnvironments = pgTable3("preview_environments", {
  id: uuid2("id").primaryKey().defaultRandom(),
  deploymentId: uuid2("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  subdomain: text3("subdomain").notNull().unique(),
  fullDomain: text3("full_domain").notNull(),
  sslEnabled: boolean3("ssl_enabled").default(true).notNull(),
  sslCertificatePath: text3("ssl_certificate_path"),
  expiresAt: timestamp3("expires_at"),
  isActive: boolean3("is_active").default(true).notNull(),
  webhookTriggered: boolean3("webhook_triggered").default(false).notNull(),
  environmentVariables: jsonb2("environment_variables").$type(),
  metadata: jsonb2("metadata").$type(),
  createdAt: timestamp3("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp3("updated_at").$defaultFn(() => new Date).notNull()
});
var deploymentLogs = pgTable3("deployment_logs", {
  id: uuid2("id").primaryKey().defaultRandom(),
  deploymentId: uuid2("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  level: logLevelEnum("level").default("info").notNull(),
  message: text3("message").notNull(),
  phase: text3("phase"),
  step: text3("step"),
  service: text3("service"),
  stage: text3("stage"),
  metadata: jsonb2("metadata").$type(),
  timestamp: timestamp3("timestamp").$defaultFn(() => new Date).notNull()
});
var deploymentStreams = pgTable3("deployment_streams", {
  id: uuid2("id").primaryKey().defaultRandom(),
  coreStreamId: uuid2("core_stream_id"),
  name: text3("name").notNull(),
  description: text3("description"),
  isActive: boolean3("is_active").default(true).notNull(),
  deploymentId: uuid2("deployment_id").references(() => deployments.id, { onDelete: "cascade" }),
  serviceId: uuid2("service_id").references(() => services.id, { onDelete: "cascade" }),
  projectId: uuid2("project_id").references(() => projects.id, { onDelete: "cascade" }),
  statusFilter: deploymentStatusEnum("status_filter"),
  environmentFilter: deploymentEnvironmentEnum("environment_filter"),
  eventTypes: jsonb2("event_types").$type(),
  replayDefault: boolean3("replay_default").default(true).notNull(),
  replayLimitDefault: integer3("replay_limit_default").default(100).notNull(),
  createdBy: text3("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp3("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp3("updated_at").$defaultFn(() => new Date).notNull()
});
var projectCollaborators = pgTable3("project_collaborators", {
  id: uuid2("id").primaryKey().defaultRandom(),
  projectId: uuid2("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text3("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: projectRoleEnum("role").default("viewer").notNull(),
  permissions: jsonb2("permissions").$type(),
  invitedBy: text3("invited_by").references(() => user.id, { onDelete: "set null" }),
  invitedAt: timestamp3("invited_at").$defaultFn(() => new Date).notNull(),
  acceptedAt: timestamp3("accepted_at"),
  createdAt: timestamp3("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp3("updated_at").$defaultFn(() => new Date).notNull()
});
var webhooks = pgTable3("webhooks", {
  id: uuid2("id").primaryKey().defaultRandom(),
  projectId: uuid2("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  serviceId: uuid2("service_id").references(() => services.id, { onDelete: "cascade" }),
  sourceType: sourceTypeEnum("source_type").notNull(),
  webhookUrl: text3("webhook_url").notNull(),
  externalWebhookId: text3("external_webhook_id"),
  secret: encryptedText("secret").notNull(),
  isActive: boolean3("is_active").default(true).notNull(),
  lastTriggered: timestamp3("last_triggered"),
  triggerCount: integer3("trigger_count").default(0).notNull(),
  settings: jsonb2("settings").$type(),
  createdAt: timestamp3("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp3("updated_at").$defaultFn(() => new Date).notNull()
});
var apiKeys = pgTable3("api_keys", {
  id: uuid2("id").primaryKey().defaultRandom(),
  userId: text3("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  projectId: uuid2("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text3("name").notNull(),
  keyHash: text3("key_hash").notNull().unique(),
  keyPreview: text3("key_preview").notNull(),
  scopes: jsonb2("scopes").$type(),
  lastUsed: timestamp3("last_used"),
  expiresAt: timestamp3("expires_at"),
  isActive: boolean3("is_active").default(true).notNull(),
  createdAt: timestamp3("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp3("updated_at").$defaultFn(() => new Date).notNull()
});
var rollbackStatusEnum = pgEnum2("rollback_status", [...zodEnumToPgEnumValues(rollbackStatusSchema)]);
var deploymentRollbacks = pgTable3("deployment_rollbacks", {
  id: uuid2("id").primaryKey().defaultRandom(),
  fromDeploymentId: uuid2("from_deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  toDeploymentId: uuid2("to_deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  triggeredBy: text3("triggered_by").references(() => user.id, { onDelete: "set null" }),
  status: rollbackStatusEnum("status").default("pending").notNull(),
  reason: text3("reason"),
  startedAt: timestamp3("started_at"),
  completedAt: timestamp3("completed_at"),
  failedAt: timestamp3("failed_at"),
  errorMessage: text3("error_message"),
  metadata: jsonb2("metadata").$type(),
  createdAt: timestamp3("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp3("updated_at").$defaultFn(() => new Date).notNull()
});
var githubInstallations = pgTable3("github_installations", {
  id: uuid2("id").primaryKey().defaultRandom(),
  userId: text3("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  installationId: integer3("installation_id").notNull().unique(),
  accountLogin: text3("account_login").notNull(),
  accountType: text3("account_type").notNull(),
  accountAvatarUrl: text3("account_avatar_url"),
  repositoriesCount: integer3("repositories_count").default(0),
  appId: text3("app_id"),
  privateKey: encryptedText("private_key"),
  clientId: text3("client_id"),
  clientSecret: encryptedText("client_secret"),
  webhookSecret: encryptedText("webhook_secret"),
  permissions: jsonb2("permissions").$type(),
  accessTokenUrl: text3("access_token_url"),
  htmlUrl: text3("html_url"),
  isActive: boolean3("is_active").default(true).notNull(),
  lastSyncedAt: timestamp3("last_synced_at"),
  metadata: jsonb2("metadata").$type(),
  createdAt: timestamp3("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp3("updated_at").$defaultFn(() => new Date).notNull()
});
var githubRepositories = pgTable3("github_repositories", {
  id: uuid2("id").primaryKey().defaultRandom(),
  installationId: uuid2("installation_id").notNull().references(() => githubInstallations.id, { onDelete: "cascade" }),
  repositoryId: integer3("repository_id").notNull().unique(),
  name: text3("name").notNull(),
  fullName: text3("full_name").notNull(),
  private: boolean3("private").notNull(),
  htmlUrl: text3("html_url").notNull(),
  description: text3("description"),
  defaultBranch: text3("default_branch").notNull(),
  language: text3("language"),
  forksCount: integer3("forks_count").default(0),
  stargazersCount: integer3("stargazers_count").default(0),
  isActive: boolean3("is_active").default(true).notNull(),
  lastSyncedAt: timestamp3("last_synced_at"),
  createdAt: timestamp3("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp3("updated_at").$defaultFn(() => new Date).notNull()
});
var deploymentRuleTriggerEnum = pgEnum2("deployment_rule_trigger", [
  "push",
  "pull_request",
  "tag",
  "release",
  "manual"
]);
var deploymentRules = pgTable3("deployment_rules", {
  id: uuid2("id").primaryKey().defaultRandom(),
  serviceId: uuid2("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  name: text3("name").notNull(),
  trigger: deploymentRuleTriggerEnum("trigger").notNull(),
  isEnabled: boolean3("is_enabled").default(true).notNull(),
  priority: integer3("priority").default(0).notNull(),
  branchPattern: text3("branch_pattern"),
  excludeBranchPattern: text3("exclude_branch_pattern"),
  tagPattern: text3("tag_pattern"),
  prLabels: jsonb2("pr_labels").$type(),
  prTargetBranches: jsonb2("pr_target_branches").$type(),
  requireApproval: boolean3("require_approval").default(false),
  minApprovals: integer3("min_approvals").default(1),
  environment: deploymentEnvironmentEnum("environment").notNull(),
  autoMergeOnSuccess: boolean3("auto_merge_on_success").default(false),
  autoDeleteOnMerge: boolean3("auto_delete_on_merge").default(true),
  environmentVariables: jsonb2("environment_variables").$type(),
  builderConfigOverride: jsonb2("builder_config_override").$type(),
  metadata: jsonb2("metadata").$type(),
  createdAt: timestamp3("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp3("updated_at").$defaultFn(() => new Date).notNull()
});
var projectsRelations = relations2(projects, ({ one, many }) => ({
  owner: one(user, {
    fields: [projects.ownerId],
    references: [user.id]
  }),
  services: many(services),
  collaborators: many(projectCollaborators),
  webhooks: many(webhooks),
  apiKeys: many(apiKeys)
}));
var servicesRelations = relations2(services, ({ one, many }) => ({
  project: one(projects, {
    fields: [services.projectId],
    references: [projects.id]
  }),
  parent: one(services, {
    fields: [services.parentId],
    references: [services.id],
    relationName: "serviceChildren"
  }),
  children: many(services, {
    relationName: "serviceChildren"
  }),
  deployments: many(deployments),
  dependencies: many(serviceDependencies, {
    relationName: "serviceDependencies"
  }),
  dependents: many(serviceDependencies, {
    relationName: "serviceDependents"
  }),
  webhooks: many(webhooks),
  deploymentRules: many(deploymentRules)
}));
var serviceDependenciesRelations = relations2(serviceDependencies, ({ one }) => ({
  service: one(services, {
    fields: [serviceDependencies.serviceId],
    references: [services.id],
    relationName: "serviceDependencies"
  }),
  dependsOnService: one(services, {
    fields: [serviceDependencies.dependsOnServiceId],
    references: [services.id],
    relationName: "serviceDependents"
  })
}));
var deploymentsRelations = relations2(deployments, ({ one, many }) => ({
  service: one(services, {
    fields: [deployments.serviceId],
    references: [services.id]
  }),
  triggeredByUser: one(user, {
    fields: [deployments.triggeredBy],
    references: [user.id]
  }),
  previewEnvironments: many(previewEnvironments),
  logs: many(deploymentLogs)
}));
var previewEnvironmentsRelations = relations2(previewEnvironments, ({ one }) => ({
  deployment: one(deployments, {
    fields: [previewEnvironments.deploymentId],
    references: [deployments.id]
  })
}));
var deploymentLogsRelations = relations2(deploymentLogs, ({ one }) => ({
  deployment: one(deployments, {
    fields: [deploymentLogs.deploymentId],
    references: [deployments.id]
  })
}));
var deploymentStreamsRelations = relations2(deploymentStreams, ({ one }) => ({
  deployment: one(deployments, {
    fields: [deploymentStreams.deploymentId],
    references: [deployments.id]
  }),
  service: one(services, {
    fields: [deploymentStreams.serviceId],
    references: [services.id]
  }),
  project: one(projects, {
    fields: [deploymentStreams.projectId],
    references: [projects.id]
  }),
  createdByUser: one(user, {
    fields: [deploymentStreams.createdBy],
    references: [user.id]
  })
}));
var projectCollaboratorsRelations = relations2(projectCollaborators, ({ one }) => ({
  project: one(projects, {
    fields: [projectCollaborators.projectId],
    references: [projects.id]
  }),
  user: one(user, {
    fields: [projectCollaborators.userId],
    references: [user.id]
  }),
  invitedByUser: one(user, {
    fields: [projectCollaborators.invitedBy],
    references: [user.id]
  })
}));
var webhooksRelations = relations2(webhooks, ({ one }) => ({
  project: one(projects, {
    fields: [webhooks.projectId],
    references: [projects.id]
  }),
  service: one(services, {
    fields: [webhooks.serviceId],
    references: [services.id]
  })
}));
var apiKeysRelations = relations2(apiKeys, ({ one }) => ({
  user: one(user, {
    fields: [apiKeys.userId],
    references: [user.id]
  }),
  project: one(projects, {
    fields: [apiKeys.projectId],
    references: [projects.id]
  })
}));
var deploymentRollbacksRelations = relations2(deploymentRollbacks, ({ one }) => ({
  fromDeployment: one(deployments, {
    fields: [deploymentRollbacks.fromDeploymentId],
    references: [deployments.id]
  }),
  toDeployment: one(deployments, {
    fields: [deploymentRollbacks.toDeploymentId],
    references: [deployments.id]
  }),
  triggeredByUser: one(user, {
    fields: [deploymentRollbacks.triggeredBy],
    references: [user.id]
  })
}));
var githubInstallationsRelations = relations2(githubInstallations, ({ one, many }) => ({
  user: one(user, {
    fields: [githubInstallations.userId],
    references: [user.id]
  }),
  repositories: many(githubRepositories)
}));
var githubRepositoriesRelations = relations2(githubRepositories, ({ one }) => ({
  installation: one(githubInstallations, {
    fields: [githubRepositories.installationId],
    references: [githubInstallations.id]
  })
}));
var deploymentRulesRelations = relations2(deploymentRules, ({ one }) => ({
  service: one(services, {
    fields: [deploymentRules.serviceId],
    references: [services.id]
  })
}));
export {
  apiKeys,
  apiKeysRelations,
  deploymentEnvironmentEnum,
  deploymentLogs,
  deploymentLogsRelations,
  deploymentPhaseEnum,
  deploymentRollbacks,
  deploymentRollbacksRelations,
  deploymentRuleTriggerEnum,
  deploymentRules,
  deploymentRulesRelations,
  deploymentStatusEnum,
  deploymentStreams,
  deploymentStreamsRelations,
  deployments,
  deploymentsRelations,
  githubInstallations,
  githubInstallationsRelations,
  githubRepositories,
  githubRepositoriesRelations,
  logLevelEnum,
  previewEnvironments,
  previewEnvironmentsRelations,
  projectCollaborators,
  projectCollaboratorsRelations,
  projectRoleEnum,
  projects,
  projectsRelations,
  rollbackStatusEnum,
  serviceDependencies,
  serviceDependenciesRelations,
  serviceProviderTypeEnum,
  serviceRunnerTypeEnum,
  serviceTypeEnum,
  services,
  servicesRelations,
  sourceTypeEnum,
  webhooks,
  webhooksRelations
};
