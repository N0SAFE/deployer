// packages/nest/schema/src/global/traefik/index.ts
import { relations as relations3 } from "drizzle-orm";
import { pgTable as pgTable4, text as text4, boolean as boolean4, timestamp as timestamp4, jsonb as jsonb3, integer as integer4, uuid as uuid3, json, index as index2, uniqueIndex as uniqueIndex2 } from "drizzle-orm/pg-core";
import z from "zod/v4";

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

// packages/nest/schema/src/global/traefik/index.ts
var dnsStatusEnum = ["pending", "valid", "invalid", "error"];
var domainConfigs = pgTable4("domain_configs", {
  id: text4("id").primaryKey(),
  projectId: uuid3("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  domain: text4("domain").notNull(),
  subdomain: text4("subdomain"),
  fullDomain: text4("full_domain").notNull(),
  sslEnabled: boolean4("ssl_enabled").default(false),
  sslProvider: text4("ssl_provider"),
  certificatePath: text4("certificate_path"),
  middleware: jsonb3("middleware"),
  dnsStatus: text4("dns_status", { enum: dnsStatusEnum }).default("pending"),
  dnsRecords: jsonb3("dns_records"),
  dnsLastChecked: timestamp4("dns_last_checked"),
  dnsErrorMessage: text4("dns_error_message"),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp4("created_at").defaultNow().notNull(),
  updatedAt: timestamp4("updated_at").defaultNow().notNull()
});
var routeConfigs = pgTable4("route_configs", {
  id: text4("id").primaryKey(),
  domainConfigId: text4("domain_config_id").references(() => domainConfigs.id, { onDelete: "cascade" }).notNull(),
  deploymentId: uuid3("deployment_id").references(() => deployments.id, { onDelete: "cascade" }),
  routeName: text4("route_name").notNull(),
  serviceName: text4("service_name").notNull(),
  containerName: text4("container_name"),
  targetPort: integer4("target_port").notNull(),
  pathPrefix: text4("path_prefix"),
  priority: integer4("priority").default(1),
  middleware: jsonb3("middleware"),
  healthCheck: jsonb3("health_check"),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp4("created_at").defaultNow().notNull(),
  updatedAt: timestamp4("updated_at").defaultNow().notNull()
});
var traefikStaticConfigs = pgTable4("traefik_static_configs", {
  id: text4("id").primaryKey(),
  projectId: uuid3("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull().unique(),
  globalConfig: jsonb3("global_config"),
  apiConfig: jsonb3("api_config"),
  entryPointsConfig: jsonb3("entry_points_config"),
  providersConfig: jsonb3("providers_config"),
  logConfig: jsonb3("log_config"),
  accessLogConfig: jsonb3("access_log_config"),
  metricsConfig: jsonb3("metrics_config"),
  tracingConfig: jsonb3("tracing_config"),
  tlsConfig: jsonb3("tls_config"),
  certificateResolversConfig: jsonb3("certificate_resolvers_config"),
  experimentalConfig: jsonb3("experimental_config"),
  serversTransportConfig: jsonb3("servers_transport_config"),
  hostResolverConfig: jsonb3("host_resolver_config"),
  clusterConfig: jsonb3("cluster_config"),
  fullConfig: jsonb3("full_config"),
  configVersion: integer4("config_version").default(1),
  syncStatus: text4("sync_status").default("pending"),
  lastSyncedAt: timestamp4("last_synced_at"),
  syncErrorMessage: text4("sync_error_message"),
  isValid: boolean4("is_valid").default(true),
  validationErrors: jsonb3("validation_errors"),
  createdAt: timestamp4("created_at").defaultNow().notNull(),
  updatedAt: timestamp4("updated_at").defaultNow().notNull()
});
var traefikConfigs = pgTable4("traefik_configs", {
  id: text4("id").primaryKey(),
  configName: text4("config_name").notNull(),
  configContent: text4("config_content").notNull(),
  configType: text4("config_type").notNull(),
  storageType: text4("storage_type").notNull().default("project"),
  projectId: uuid3("project_id").references(() => projects.id, { onDelete: "cascade" }),
  requiresFile: boolean4("requires_file").default(true),
  syncStatus: text4("sync_status").default("pending"),
  lastSyncedAt: timestamp4("last_synced_at"),
  syncErrorMessage: text4("sync_error_message"),
  fileChecksum: text4("file_checksum"),
  configVersion: integer4("config_version").default(1),
  metadata: jsonb3("metadata"),
  description: text4("description"),
  tags: jsonb3("tags"),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp4("created_at").defaultNow().notNull(),
  updatedAt: timestamp4("updated_at").defaultNow().notNull()
});
var serviceConfigReferences = pgTable4("service_config_references", {
  id: text4("id").primaryKey(),
  serviceId: uuid3("service_id").references(() => services.id, { onDelete: "cascade" }).notNull(),
  traefikConfigId: text4("traefik_config_id").references(() => traefikConfigs.id, { onDelete: "cascade" }).notNull(),
  referenceType: text4("reference_type").notNull(),
  priority: integer4("priority").default(0),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp4("created_at").defaultNow().notNull(),
  updatedAt: timestamp4("updated_at").defaultNow().notNull()
});
var traefikMiddleware = pgTable4("traefik_middleware", {
  id: uuid3("id").primaryKey().defaultRandom(),
  projectId: uuid3("project_id").references(() => projects.id, { onDelete: "cascade" }),
  middlewareName: text4("middleware_name").notNull(),
  middlewareType: text4("middleware_type").notNull(),
  configuration: jsonb3("configuration").notNull(),
  isGlobal: boolean4("is_global").default(false),
  priority: integer4("priority").default(0),
  isActive: boolean4("is_active").default(true),
  filePath: text4("file_path"),
  createdAt: timestamp4("created_at").defaultNow().notNull(),
  updatedAt: timestamp4("updated_at").defaultNow().notNull()
});
var traefikPlugins = pgTable4("traefik_plugins", {
  id: uuid3("id").primaryKey().defaultRandom(),
  projectId: uuid3("project_id").references(() => projects.id, { onDelete: "cascade" }),
  pluginName: text4("plugin_name").notNull(),
  pluginVersion: text4("plugin_version").notNull(),
  pluginSource: text4("plugin_source").notNull(),
  configuration: jsonb3("configuration"),
  isEnabled: boolean4("is_enabled").default(true),
  filePath: text4("file_path"),
  createdAt: timestamp4("created_at").defaultNow().notNull(),
  updatedAt: timestamp4("updated_at").defaultNow().notNull()
});
var traefikStaticFiles = pgTable4("traefik_static_files", {
  id: uuid3("id").primaryKey().defaultRandom(),
  projectId: uuid3("project_id").references(() => projects.id, { onDelete: "cascade" }),
  fileName: text4("file_name").notNull(),
  fileContent: text4("file_content").notNull(),
  mimeType: text4("mime_type").default("text/plain"),
  fileSize: integer4("file_size"),
  relativePath: text4("relative_path").notNull(),
  isPublic: boolean4("is_public").default(true),
  createdAt: timestamp4("created_at").defaultNow().notNull(),
  updatedAt: timestamp4("updated_at").defaultNow().notNull()
});
var traefikBackups = pgTable4("traefik_backups", {
  id: uuid3("id").primaryKey().defaultRandom(),
  projectId: uuid3("project_id").references(() => projects.id, { onDelete: "cascade" }),
  backupName: text4("backup_name").notNull(),
  backupType: text4("backup_type").notNull(),
  originalPath: text4("original_path").notNull(),
  backupContent: text4("backup_content").notNull(),
  compressionType: text4("compression_type"),
  backupSize: integer4("backup_size"),
  metadata: jsonb3("metadata"),
  createdAt: timestamp4("created_at").defaultNow().notNull(),
  expiresAt: timestamp4("expires_at")
});
var configFiles = pgTable4("config_files", {
  id: text4("id").primaryKey(),
  traefikConfigId: text4("traefik_config_id").references(() => traefikConfigs.id, { onDelete: "cascade" }).notNull(),
  filePath: text4("file_path").notNull(),
  fileSize: integer4("file_size"),
  checksum: text4("checksum"),
  permissions: text4("permissions").default("644"),
  owner: text4("owner").default("traefik"),
  exists: boolean4("exists").default(false),
  isWritable: boolean4("is_writable").default(true),
  lastWriteAttempt: timestamp4("last_write_attempt"),
  writeErrorMessage: text4("write_error_message"),
  containerPath: text4("container_path"),
  mountPoint: text4("mount_point"),
  createdAt: timestamp4("created_at").defaultNow().notNull(),
  updatedAt: timestamp4("updated_at").defaultNow().notNull()
});
var traefikStaticConfigSchema = z.object({
  id: z.string(),
  projectId: z.uuid(),
  globalConfig: z.record(z.string(), z.unknown()).nullable(),
  apiConfig: z.record(z.string(), z.unknown()).nullable(),
  entryPointsConfig: z.record(z.string(), z.unknown()).nullable(),
  providersConfig: z.record(z.string(), z.unknown()).nullable(),
  logConfig: z.record(z.string(), z.unknown()).nullable(),
  accessLogConfig: z.record(z.string(), z.unknown()).nullable(),
  metricsConfig: z.record(z.string(), z.unknown()).nullable(),
  tracingConfig: z.record(z.string(), z.unknown()).nullable(),
  tlsConfig: z.record(z.string(), z.unknown()).nullable(),
  certificateResolversConfig: z.record(z.string(), z.unknown()).nullable(),
  experimentalConfig: z.record(z.string(), z.unknown()).nullable(),
  serversTransportConfig: z.record(z.string(), z.unknown()).nullable(),
  hostResolverConfig: z.record(z.string(), z.unknown()).nullable(),
  clusterConfig: z.record(z.string(), z.unknown()).nullable(),
  fullConfig: z.record(z.string(), z.unknown()).nullable(),
  configVersion: z.number().nullable(),
  syncStatus: z.string().nullable(),
  lastSyncedAt: z.date().nullable(),
  syncErrorMessage: z.string().nullable(),
  isValid: z.boolean().nullable(),
  validationErrors: z.array(z.record(z.string(), z.unknown())).nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var createTraefikStaticConfigSchema = traefikStaticConfigSchema.omit({
  createdAt: true,
  updatedAt: true
}).partial({ id: true });
var domainConfigSchema = z.object({
  id: z.string(),
  projectId: z.uuid(),
  domain: z.string(),
  subdomain: z.string().nullable(),
  fullDomain: z.string(),
  sslEnabled: z.boolean().nullable(),
  sslProvider: z.string().nullable(),
  certificatePath: z.string().nullable(),
  middleware: z.record(z.string(), z.unknown()).nullable(),
  dnsStatus: z.enum(["pending", "valid", "invalid", "error"]).nullable(),
  dnsRecords: z.array(z.record(z.string(), z.unknown())).nullable(),
  dnsLastChecked: z.date().nullable(),
  dnsErrorMessage: z.string().nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var createDomainConfigSchema = domainConfigSchema.omit({
  createdAt: true,
  updatedAt: true
}).partial({ id: true });
var routeConfigSchema = z.object({
  id: z.string(),
  domainConfigId: z.string(),
  deploymentId: z.uuid().nullable(),
  routeName: z.string(),
  serviceName: z.string(),
  containerName: z.string().nullable(),
  targetPort: z.number(),
  pathPrefix: z.string().nullable(),
  priority: z.number().nullable(),
  middleware: z.record(z.string(), z.unknown()).nullable(),
  healthCheck: z.record(z.string(), z.unknown()).nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var createRouteConfigSchema = routeConfigSchema.omit({
  createdAt: true,
  updatedAt: true
}).partial({ id: true });
var traefikConfigSchema = z.object({
  id: z.string(),
  configName: z.string(),
  configContent: z.string(),
  configType: z.string(),
  storageType: z.enum(["project", "standalone"]),
  projectId: z.uuid().nullable(),
  requiresFile: z.boolean().nullable(),
  syncStatus: z.string().nullable(),
  lastSyncedAt: z.date().nullable(),
  syncErrorMessage: z.string().nullable(),
  fileChecksum: z.string().nullable(),
  configVersion: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  description: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var serviceConfigReferenceSchema = z.object({
  id: z.string(),
  serviceId: z.uuid(),
  traefikConfigId: z.string(),
  referenceType: z.string(),
  priority: z.number().nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var createTraefikConfigSchema = traefikConfigSchema.omit({
  createdAt: true,
  updatedAt: true
}).partial({ id: true });
var createServiceConfigReferenceSchema = serviceConfigReferenceSchema.omit({
  createdAt: true,
  updatedAt: true
}).partial({ id: true });
var configFileSchema = z.object({
  id: z.string(),
  traefikConfigId: z.string(),
  filePath: z.string(),
  fileSize: z.number().nullable(),
  checksum: z.string().nullable(),
  permissions: z.string().nullable(),
  owner: z.string().nullable(),
  exists: z.boolean().nullable(),
  isWritable: z.boolean().nullable(),
  lastWriteAttempt: z.date().nullable(),
  writeErrorMessage: z.string().nullable(),
  containerPath: z.string().nullable(),
  mountPoint: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var createConfigFileSchema = configFileSchema.omit({
  createdAt: true,
  updatedAt: true
});
var traefikSslCertificateSchema = z.object({
  id: z.string(),
  configId: z.uuid(),
  domain: z.string(),
  subjectAltNames: z.array(z.string()).nullable(),
  issuer: z.string().nullable(),
  serialNumber: z.string().nullable(),
  fingerprint: z.string().nullable(),
  notBefore: z.date().nullable(),
  notAfter: z.date().nullable(),
  certificateData: z.string().nullable(),
  privateKeyData: z.string().nullable(),
  autoRenew: z.boolean().nullable(),
  renewalThreshold: z.number().nullable(),
  lastRenewal: z.date().nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var traefikMiddlewareSchema = z.object({
  id: z.string(),
  projectId: z.uuid().nullable(),
  middlewareName: z.string(),
  middlewareType: z.string(),
  configuration: z.record(z.string(), z.unknown()),
  isGlobal: z.boolean().nullable(),
  priority: z.number().nullable(),
  isActive: z.boolean().nullable(),
  filePath: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var traefikPluginSchema = z.object({
  id: z.string(),
  projectId: z.uuid().nullable(),
  pluginName: z.string(),
  pluginVersion: z.string(),
  pluginSource: z.string(),
  configuration: z.record(z.string(), z.unknown()).nullable(),
  isEnabled: z.boolean().nullable(),
  filePath: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var traefikStaticFileSchema = z.object({
  id: z.string(),
  projectId: z.uuid().nullable(),
  fileName: z.string(),
  fileContent: z.string(),
  mimeType: z.string().nullable(),
  fileSize: z.number().nullable(),
  relativePath: z.string(),
  isPublic: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var traefikBackupSchema = z.object({
  id: z.string(),
  projectId: z.uuid().nullable(),
  backupName: z.string(),
  backupType: z.string(),
  originalPath: z.string(),
  backupContent: z.string(),
  compressionType: z.string().nullable(),
  backupSize: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  expiresAt: z.date().nullable()
});
var createTraefikSslCertificateSchema = traefikSslCertificateSchema.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
var createTraefikMiddlewareSchema = traefikMiddlewareSchema.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
var createTraefikPluginSchema = traefikPluginSchema.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
var createTraefikStaticFileSchema = traefikStaticFileSchema.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
var createTraefikBackupSchema = traefikBackupSchema.omit({ createdAt: true, expiresAt: true }).partial({ id: true });
var domainConfigsRelations = relations3(domainConfigs, ({ one, many }) => ({
  project: one(projects, {
    fields: [domainConfigs.projectId],
    references: [projects.id]
  }),
  routes: many(routeConfigs)
}));
var routeConfigsRelations = relations3(routeConfigs, ({ one }) => ({
  domainConfig: one(domainConfigs, {
    fields: [routeConfigs.domainConfigId],
    references: [domainConfigs.id]
  }),
  deployment: one(deployments, {
    fields: [routeConfigs.deploymentId],
    references: [deployments.id]
  })
}));
var traefikStaticConfigsRelations = relations3(traefikStaticConfigs, ({ one }) => ({
  project: one(projects, {
    fields: [traefikStaticConfigs.projectId],
    references: [projects.id]
  })
}));
var traefikConfigsRelations = relations3(traefikConfigs, ({ one, many }) => ({
  project: one(projects, {
    fields: [traefikConfigs.projectId],
    references: [projects.id]
  }),
  serviceReferences: many(serviceConfigReferences),
  configFiles: many(configFiles)
}));
var serviceConfigReferencesRelations = relations3(serviceConfigReferences, ({ one }) => ({
  service: one(services, {
    fields: [serviceConfigReferences.serviceId],
    references: [services.id]
  }),
  traefikConfig: one(traefikConfigs, {
    fields: [serviceConfigReferences.traefikConfigId],
    references: [traefikConfigs.id]
  })
}));
var configFilesRelations = relations3(configFiles, ({ one }) => ({
  traefikConfig: one(traefikConfigs, {
    fields: [configFiles.traefikConfigId],
    references: [traefikConfigs.id]
  })
}));
var traefikMiddlewareRelations = relations3(traefikMiddleware, ({ one }) => ({
  project: one(projects, {
    fields: [traefikMiddleware.projectId],
    references: [projects.id]
  })
}));
var traefikPluginsRelations = relations3(traefikPlugins, ({ one }) => ({
  project: one(projects, {
    fields: [traefikPlugins.projectId],
    references: [projects.id]
  })
}));
var traefikStaticFilesRelations = relations3(traefikStaticFiles, ({ one }) => ({
  project: one(projects, {
    fields: [traefikStaticFiles.projectId],
    references: [projects.id]
  })
}));
var traefikBackupsRelations = relations3(traefikBackups, ({ one }) => ({
  project: one(projects, {
    fields: [traefikBackups.projectId],
    references: [projects.id]
  })
}));
var providerTraefikTemplates = pgTable4("provider_traefik_templates", {
  id: text4("id").primaryKey(),
  providerType: text4("provider_type").notNull().unique(),
  templateName: text4("template_name").notNull(),
  templateContent: text4("template_content").notNull(),
  description: text4("description"),
  variables: jsonb3("variables"),
  isDefault: boolean4("is_default").default(true),
  createdAt: timestamp4("created_at").defaultNow().notNull(),
  updatedAt: timestamp4("updated_at").defaultNow().notNull()
});
var serviceTraefikTemplates = pgTable4("service_traefik_templates", {
  id: text4("id").primaryKey(),
  serviceId: uuid3("service_id").references(() => services.id, { onDelete: "cascade" }).notNull(),
  templateContent: text4("template_content").notNull(),
  variables: jsonb3("variables"),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp4("created_at").defaultNow().notNull(),
  updatedAt: timestamp4("updated_at").defaultNow().notNull()
});
var providerTraefikTemplateSchema = z.object({
  id: z.string(),
  providerType: z.string(),
  templateName: z.string(),
  templateContent: z.string(),
  description: z.string().nullable(),
  variables: z.unknown().nullable(),
  isDefault: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var createProviderTraefikTemplateSchema = providerTraefikTemplateSchema.omit({
  createdAt: true,
  updatedAt: true
}).partial({ id: true });
var serviceTraefikTemplateSchema = z.object({
  id: z.string(),
  serviceId: z.uuid(),
  templateContent: z.string(),
  variables: z.unknown().nullable(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});
var createServiceTraefikTemplateSchema = serviceTraefikTemplateSchema.omit({
  createdAt: true,
  updatedAt: true
}).partial({ id: true });
var providerTraefikTemplatesRelations = relations3(providerTraefikTemplates, () => ({}));
var serviceTraefikTemplatesRelations = relations3(serviceTraefikTemplates, ({ one }) => ({
  service: one(services, {
    fields: [serviceTraefikTemplates.serviceId],
    references: [services.id]
  })
}));
var traefikServiceConfigs = pgTable4("traefik_service_configs", {
  id: uuid3("id").primaryKey().defaultRandom(),
  serviceId: uuid3("service_id").references(() => services.id, { onDelete: "cascade" }).notNull(),
  domain: text4("domain").notNull(),
  subdomain: text4("subdomain"),
  fullDomain: text4("full_domain").notNull(),
  sslEnabled: boolean4("ssl_enabled").default(false),
  sslProvider: text4("ssl_provider").$type(),
  pathPrefix: text4("path_prefix"),
  port: integer4("port").notNull(),
  middleware: json("middleware"),
  healthCheck: json("health_check").$type(),
  isActive: boolean4("is_active").default(true),
  configContent: text4("config_content"),
  lastSyncedAt: timestamp4("last_synced_at"),
  createdAt: timestamp4("created_at").defaultNow(),
  updatedAt: timestamp4("updated_at").defaultNow()
}, (table) => [
  {
    serviceIdIndex: index2("traefik_service_configs_service_id_idx").on(table.serviceId),
    domainIndex: index2("traefik_service_configs_domain_idx").on(table.domain),
    fullDomainIndex: index2("traefik_service_configs_full_domain_idx").on(table.fullDomain),
    uniqueServiceConfig: uniqueIndex2("traefik_service_configs_service_id_unique").on(table.serviceId)
  }
]);
var traefikDomainRoutes = pgTable4("traefik_domain_routes", {
  id: uuid3("id").primaryKey().defaultRandom(),
  configId: uuid3("config_id").references(() => traefikServiceConfigs.id, { onDelete: "cascade" }).notNull(),
  hostRule: text4("host_rule").notNull(),
  pathRule: text4("path_rule"),
  method: text4("method"),
  headers: json("headers"),
  priority: integer4("priority").default(1),
  entryPoint: text4("entry_point").default("web"),
  middleware: json("middleware"),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp4("created_at").defaultNow(),
  updatedAt: timestamp4("updated_at").defaultNow()
}, (table) => [
  {
    configIdIndex: index2("traefik_domain_routes_config_id_idx").on(table.configId),
    hostRuleIndex: index2("traefik_domain_routes_host_rule_idx").on(table.hostRule),
    priorityIndex: index2("traefik_domain_routes_priority_idx").on(table.priority)
  }
]);
var traefikServiceTargets = pgTable4("traefik_service_targets", {
  id: uuid3("id").primaryKey().defaultRandom(),
  configId: uuid3("config_id").references(() => traefikServiceConfigs.id, { onDelete: "cascade" }).notNull(),
  url: text4("url").notNull(),
  weight: integer4("weight").default(1),
  healthCheck: json("health_check").$type(),
  isActive: boolean4("is_active").default(true),
  lastHealthCheck: timestamp4("last_health_check"),
  healthStatus: text4("health_status").$type().default("unknown"),
  createdAt: timestamp4("created_at").defaultNow(),
  updatedAt: timestamp4("updated_at").defaultNow()
}, (table) => [
  {
    configIdIndex: index2("traefik_service_targets_config_id_idx").on(table.configId),
    urlIndex: index2("traefik_service_targets_url_idx").on(table.url),
    healthStatusIndex: index2("traefik_service_targets_health_status_idx").on(table.healthStatus)
  }
]);
var traefikSSLCertificates = pgTable4("traefik_ssl_certificates", {
  id: uuid3("id").primaryKey().defaultRandom(),
  configId: uuid3("config_id").references(() => traefikServiceConfigs.id, { onDelete: "cascade" }).notNull(),
  domain: text4("domain").notNull(),
  subjectAltNames: json("subject_alt_names").$type(),
  issuer: text4("issuer"),
  serialNumber: text4("serial_number"),
  fingerprint: text4("fingerprint"),
  notBefore: timestamp4("not_before"),
  notAfter: timestamp4("not_after"),
  certificateData: text4("certificate_data"),
  privateKeyData: text4("private_key_data"),
  autoRenew: boolean4("auto_renew").default(true),
  renewalThreshold: integer4("renewal_threshold").default(30),
  lastRenewal: timestamp4("last_renewal"),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp4("created_at").defaultNow(),
  updatedAt: timestamp4("updated_at").defaultNow()
}, (table) => [
  {
    configIdIndex: index2("traefik_ssl_certificates_config_id_idx").on(table.configId),
    domainIndex: index2("traefik_ssl_certificates_domain_idx").on(table.domain),
    expiryIndex: index2("traefik_ssl_certificates_expiry_idx").on(table.notAfter),
    uniqueDomainConfig: uniqueIndex2("traefik_ssl_certificates_domain_config_unique").on(table.configId, table.domain)
  }
]);
var traefikConfigFiles = pgTable4("traefik_config_files", {
  id: uuid3("id").primaryKey().defaultRandom(),
  configId: uuid3("config_id").references(() => traefikServiceConfigs.id, { onDelete: "cascade" }).notNull(),
  fileName: text4("file_name").notNull(),
  filePath: text4("file_path").notNull(),
  relativePath: text4("relative_path").notNull(),
  fileType: text4("file_type").$type().default("config"),
  contentType: text4("content_type"),
  size: integer4("size"),
  checksum: text4("checksum"),
  content: text4("content"),
  lastSynced: timestamp4("last_synced"),
  syncStatus: text4("sync_status").$type().default("pending"),
  syncError: text4("sync_error"),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp4("created_at").defaultNow(),
  updatedAt: timestamp4("updated_at").defaultNow()
}, (table) => [
  {
    configIdIndex: index2("traefik_config_files_config_id_idx").on(table.configId),
    filePathIndex: index2("traefik_config_files_file_path_idx").on(table.filePath),
    fileTypeIndex: index2("traefik_config_files_file_type_idx").on(table.fileType),
    syncStatusIndex: index2("traefik_config_files_sync_status_idx").on(table.syncStatus),
    uniqueConfigFile: uniqueIndex2("traefik_config_files_config_file_unique").on(table.configId, table.filePath)
  }
]);
var traefikMiddlewares = pgTable4("traefik_middlewares", {
  id: uuid3("id").primaryKey().defaultRandom(),
  name: text4("name").notNull(),
  type: text4("type").$type().notNull(),
  config: json("config").notNull(),
  description: text4("description"),
  isGlobal: boolean4("is_global").default(false),
  serviceId: uuid3("service_id").references(() => services.id),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp4("created_at").defaultNow(),
  updatedAt: timestamp4("updated_at").defaultNow()
}, (table) => [
  {
    nameIndex: index2("traefik_middlewares_name_idx").on(table.name),
    typeIndex: index2("traefik_middlewares_type_idx").on(table.type),
    serviceIdIndex: index2("traefik_middlewares_service_id_idx").on(table.serviceId),
    uniqueServiceMiddleware: uniqueIndex2("traefik_middlewares_service_name_unique").on(table.serviceId, table.name)
  }
]);
var traefikServiceConfigsRelations = relations3(traefikServiceConfigs, ({ one, many }) => ({
  service: one(services, {
    fields: [traefikServiceConfigs.serviceId],
    references: [services.id]
  }),
  domainRoutes: many(traefikDomainRoutes),
  serviceTargets: many(traefikServiceTargets),
  sslCertificates: many(traefikSSLCertificates),
  configFiles: many(traefikConfigFiles)
}));
var traefikDomainRoutesRelations = relations3(traefikDomainRoutes, ({ one }) => ({
  config: one(traefikServiceConfigs, {
    fields: [traefikDomainRoutes.configId],
    references: [traefikServiceConfigs.id]
  })
}));
var traefikServiceTargetsRelations = relations3(traefikServiceTargets, ({ one }) => ({
  config: one(traefikServiceConfigs, {
    fields: [traefikServiceTargets.configId],
    references: [traefikServiceConfigs.id]
  })
}));
var traefikSSLCertificatesRelations = relations3(traefikSSLCertificates, ({ one }) => ({
  config: one(traefikServiceConfigs, {
    fields: [traefikSSLCertificates.configId],
    references: [traefikServiceConfigs.id]
  })
}));
var traefikConfigFilesRelations = relations3(traefikConfigFiles, ({ one }) => ({
  config: one(traefikServiceConfigs, {
    fields: [traefikConfigFiles.configId],
    references: [traefikServiceConfigs.id]
  })
}));
var traefikMiddlewaresRelations = relations3(traefikMiddlewares, ({ one }) => ({
  service: one(services, {
    fields: [traefikMiddlewares.serviceId],
    references: [services.id]
  })
}));
export {
  configFileSchema,
  configFiles,
  configFilesRelations,
  createConfigFileSchema,
  createDomainConfigSchema,
  createProviderTraefikTemplateSchema,
  createRouteConfigSchema,
  createServiceConfigReferenceSchema,
  createServiceTraefikTemplateSchema,
  createTraefikBackupSchema,
  createTraefikConfigSchema,
  createTraefikMiddlewareSchema,
  createTraefikPluginSchema,
  createTraefikSslCertificateSchema,
  createTraefikStaticConfigSchema,
  createTraefikStaticFileSchema,
  domainConfigSchema,
  domainConfigs,
  domainConfigsRelations,
  providerTraefikTemplateSchema,
  providerTraefikTemplates,
  providerTraefikTemplatesRelations,
  routeConfigSchema,
  routeConfigs,
  routeConfigsRelations,
  serviceConfigReferenceSchema,
  serviceConfigReferences,
  serviceConfigReferencesRelations,
  serviceTraefikTemplateSchema,
  serviceTraefikTemplates,
  serviceTraefikTemplatesRelations,
  traefikBackupSchema,
  traefikBackups,
  traefikBackupsRelations,
  traefikConfigFiles,
  traefikConfigFilesRelations,
  traefikConfigSchema,
  traefikConfigs,
  traefikConfigsRelations,
  traefikDomainRoutes,
  traefikDomainRoutesRelations,
  traefikMiddleware,
  traefikMiddlewareRelations,
  traefikMiddlewareSchema,
  traefikMiddlewares,
  traefikMiddlewaresRelations,
  traefikPluginSchema,
  traefikPlugins,
  traefikPluginsRelations,
  traefikSSLCertificates,
  traefikSSLCertificatesRelations,
  traefikServiceConfigs,
  traefikServiceConfigsRelations,
  traefikServiceTargets,
  traefikServiceTargetsRelations,
  traefikSslCertificateSchema,
  traefikStaticConfigSchema,
  traefikStaticConfigs,
  traefikStaticConfigsRelations,
  traefikStaticFileSchema,
  traefikStaticFiles,
  traefikStaticFilesRelations
};
