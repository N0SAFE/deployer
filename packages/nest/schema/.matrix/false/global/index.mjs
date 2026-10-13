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
// packages/nest/schema/src/global/permissions.ts
import {
  pgTable as pgTable2,
  text as text2,
  jsonb,
  timestamp as timestamp2,
  uniqueIndex as uniqueIndex2
} from "drizzle-orm/pg-core";
var roleRules = pgTable2("role_rules", {
  id: text2("id").primaryKey(),
  roleName: text2("role_name").notNull(),
  resourceRules: jsonb("resource_rules").$type().notNull().default([]),
  createdAt: timestamp2("created_at").notNull().defaultNow(),
  updatedAt: timestamp2("updated_at").notNull().defaultNow().$onUpdate(() => new Date)
}, (table) => [
  uniqueIndex2("role_rules_roleName_uidx").on(table.roleName)
]);
// packages/nest/schema/src/global/seed-version.ts
import { pgTable as pgTable3, text as text3, timestamp as timestamp3 } from "drizzle-orm/pg-core";
var seedVersion = pgTable3("seed_version", {
  version: text3("version").primaryKey(),
  appliedAt: timestamp3("applied_at").defaultNow().notNull()
});
// packages/nest/schema/src/global/traefik/index.ts
import { relations as relations3 } from "drizzle-orm";
import { pgTable as pgTable6, text as text6, boolean as boolean4, timestamp as timestamp6, jsonb as jsonb4, integer as integer4, uuid as uuid3, json, index as index2, uniqueIndex as uniqueIndex3 } from "drizzle-orm/pg-core";
import z from "zod/v4";

// packages/nest/schema/src/global/deployment.ts
import { pgTable as pgTable5, text as text5, timestamp as timestamp5, boolean as boolean3, integer as integer3, uuid as uuid2, jsonb as jsonb3, pgEnum as pgEnum2 } from "drizzle-orm/pg-core";
import { relations as relations2 } from "drizzle-orm";

// packages/nest/schema/src/global/environment.ts
import { pgTable as pgTable4, text as text4, timestamp as timestamp4, boolean as boolean2, uuid, jsonb as jsonb2, pgEnum, integer as integer2 } from "drizzle-orm/pg-core";
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
var environmentTemplates = pgTable4("environment_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text4("name").notNull(),
  description: text4("description"),
  type: environmentTypeEnum("type").notNull(),
  isDefault: boolean2("is_default").default(false).notNull(),
  defaultVariables: jsonb2("default_variables").$type().default([]),
  variableDefinitions: jsonb2("variable_definitions").$type().default([]),
  deploymentSettings: jsonb2("deployment_settings").$type(),
  securitySettings: jsonb2("security_settings").$type(),
  createdBy: text4("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp4("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp4("updated_at").$defaultFn(() => new Date).notNull()
});
var environments = pgTable4("environments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text4("name").notNull(),
  slug: text4("slug").notNull(),
  description: text4("description"),
  type: environmentTypeEnum("type").notNull(),
  kind: environmentKindEnum("kind").default("stable").notNull(),
  rules: jsonb2("rules").$type(),
  trigger: jsonb2("trigger").$type(),
  status: environmentStatusEnum("status").default("pending").notNull(),
  templateId: uuid("template_id").references(() => environmentTemplates.id, { onDelete: "set null" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  domainConfig: jsonb2("domain_config").$type(),
  networkConfig: jsonb2("network_config").$type(),
  deploymentConfig: jsonb2("deployment_config").$type(),
  resourceLimits: jsonb2("resource_limits").$type(),
  previewSettings: jsonb2("preview_settings").$type(),
  metadata: jsonb2("metadata").$type(),
  isActive: boolean2("is_active").default(true).notNull(),
  createdBy: text4("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp4("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp4("updated_at").$defaultFn(() => new Date).notNull()
});
var serviceEnvironments = pgTable4("service_environments", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  environmentId: uuid("environment_id").notNull().references(() => environments.id, { onDelete: "cascade" }),
  isEnabled: boolean2("is_enabled").default(true).notNull(),
  overrides: jsonb2("overrides").$type(),
  createdAt: timestamp4("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp4("updated_at").$defaultFn(() => new Date).notNull()
});
var environmentVariables = pgTable4("environment_variables", {
  id: uuid("id").primaryKey().defaultRandom(),
  environmentId: uuid("environment_id").notNull().references(() => environments.id, { onDelete: "cascade" }),
  key: text4("key").notNull(),
  value: text4("value").notNull(),
  isSecret: boolean2("is_secret").default(false).notNull(),
  description: text4("description"),
  category: text4("category"),
  isDynamic: boolean2("is_dynamic").default(false).notNull(),
  template: text4("template"),
  resolutionStatus: variableResolutionStatusEnum("resolution_status").default("resolved"),
  resolvedValue: text4("resolved_value"),
  resolutionError: text4("resolution_error"),
  lastResolved: timestamp4("last_resolved"),
  references: jsonb2("references").$type().default([]),
  createdBy: text4("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp4("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp4("updated_at").$defaultFn(() => new Date).notNull()
});
var environmentServices = pgTable4("environment_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  environmentId: uuid("environment_id").notNull().references(() => environments.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  serviceConfig: jsonb2("service_config").$type(),
  isDeployed: boolean2("is_deployed").default(false).notNull(),
  lastDeploymentId: uuid("last_deployment_id"),
  deploymentStatus: text4("deployment_status").default("pending"),
  healthStatus: text4("health_status").default("unknown"),
  lastHealthCheck: timestamp4("last_health_check"),
  createdAt: timestamp4("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp4("updated_at").$defaultFn(() => new Date).notNull()
});
var variableTemplates = pgTable4("variable_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text4("name").notNull(),
  description: text4("description"),
  variables: jsonb2("variables").$type().default([]),
  isSystem: boolean2("is_system").default(false).notNull(),
  usageCount: integer2("usage_count").default(0).notNull(),
  lastUsed: timestamp4("last_used"),
  createdBy: text4("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp4("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp4("updated_at").$defaultFn(() => new Date).notNull()
});
var environmentAccessLogs = pgTable4("environment_access_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  environmentId: uuid("environment_id").notNull().references(() => environments.id, { onDelete: "cascade" }),
  userId: text4("user_id").references(() => user.id, { onDelete: "set null" }),
  action: text4("action").notNull(),
  ipAddress: text4("ip_address"),
  userAgent: text4("user_agent"),
  metadata: jsonb2("metadata").$type(),
  timestamp: timestamp4("timestamp").$defaultFn(() => new Date).notNull()
});
var environmentPromotions = pgTable4("environment_promotions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceEnvironmentId: uuid("source_environment_id").notNull().references(() => environments.id, { onDelete: "cascade" }),
  targetEnvironmentId: uuid("target_environment_id").notNull().references(() => environments.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").references(() => services.id, { onDelete: "cascade" }),
  status: text4("status").default("pending").notNull(),
  promotedBy: text4("promoted_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  sourceDeploymentId: uuid("source_deployment_id"),
  targetDeploymentId: uuid("target_deployment_id"),
  metadata: jsonb2("metadata").$type(),
  startedAt: timestamp4("started_at").$defaultFn(() => new Date).notNull(),
  completedAt: timestamp4("completed_at"),
  createdAt: timestamp4("created_at").$defaultFn(() => new Date).notNull()
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
var projects = pgTable5("projects", {
  id: uuid2("id").primaryKey().defaultRandom(),
  name: text5("name").notNull(),
  description: text5("description"),
  baseDomain: text5("base_domain"),
  network: jsonb3("network").$type(),
  ownerId: text5("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  settings: jsonb3("settings").$type(),
  metadata: jsonb3("metadata").$type(),
  createdAt: timestamp5("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp5("updated_at").$defaultFn(() => new Date).notNull()
});
var services = pgTable5("services", {
  id: uuid2("id").primaryKey().defaultRandom(),
  projectId: uuid2("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text5("name").notNull(),
  description: text5("description"),
  type: serviceTypeEnum("type").notNull(),
  providerId: serviceProviderTypeEnum("provider_id").notNull(),
  providerConfig: jsonb3("provider_config").$type(),
  builderId: serviceRunnerTypeEnum("builder_id").notNull(),
  builderConfig: jsonb3("builder_config").$type(),
  port: integer3("port"),
  environmentVariables: jsonb3("environment_variables").$type(),
  resourceLimits: jsonb3("resource_limits").$type(),
  healthCheckPath: text5("health_check_path").default("/health"),
  healthCheckInterval: integer3("health_check_interval").default(30),
  healthCheckTimeout: integer3("health_check_timeout").default(10),
  healthCheckRetries: integer3("health_check_retries").default(3),
  deploymentRetention: jsonb3("deployment_retention").$type().default({
    maxSuccessfulDeployments: 5,
    keepArtifacts: true,
    autoCleanup: true
  }),
  traefikConfig: traefikConfigBuilder("traefik_config"),
  customDomains: jsonb3("custom_domains").$type(),
  network: jsonb3("network").$type(),
  implementsContract: jsonb3("implements_contract").$type(),
  preview: jsonb3("preview").$type(),
  isActive: boolean3("is_active").default(true).notNull(),
  metadata: jsonb3("metadata").$type(),
  parentId: uuid2("parent_id").references(() => services.id, { onDelete: "cascade" }),
  parentPath: text5("parent_path"),
  depth: integer3("depth").default(0).notNull(),
  createdAt: timestamp5("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp5("updated_at").$defaultFn(() => new Date).notNull()
});
var serviceDependencies = pgTable5("service_dependencies", {
  id: uuid2("id").primaryKey().defaultRandom(),
  serviceId: uuid2("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  dependsOnServiceId: uuid2("depends_on_service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  isRequired: boolean3("is_required").default(true).notNull(),
  createdAt: timestamp5("created_at").$defaultFn(() => new Date).notNull()
});
var deployments = pgTable5("deployments", {
  id: uuid2("id").primaryKey().defaultRandom(),
  serviceId: uuid2("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  triggeredBy: text5("triggered_by").references(() => user.id, { onDelete: "set null" }),
  status: deploymentStatusEnum("status").default("pending").notNull(),
  environment: deploymentEnvironmentEnum("environment").default("production").notNull(),
  environmentId: uuid2("environment_id").references(() => environments.id, { onDelete: "set null" }),
  sourceType: sourceTypeEnum("source_type").notNull(),
  sourceConfig: jsonb3("source_config").$type(),
  buildStartedAt: timestamp5("build_started_at"),
  buildCompletedAt: timestamp5("build_completed_at"),
  deployStartedAt: timestamp5("deploy_started_at"),
  deployCompletedAt: timestamp5("deploy_completed_at"),
  containerName: text5("container_name"),
  containerImage: text5("container_image"),
  domainUrl: text5("domain_url"),
  healthCheckUrl: text5("health_check_url"),
  errorMessage: text5("error_message"),
  phase: deploymentPhaseEnum("phase").default("queued"),
  phaseProgress: integer3("phase_progress").default(0),
  phaseMetadata: jsonb3("phase_metadata").$type(),
  phaseUpdatedAt: timestamp5("phase_updated_at").$defaultFn(() => new Date),
  metadata: jsonb3("metadata").$type(),
  createdAt: timestamp5("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp5("updated_at").$defaultFn(() => new Date).notNull()
});
var previewEnvironments = pgTable5("preview_environments", {
  id: uuid2("id").primaryKey().defaultRandom(),
  deploymentId: uuid2("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  subdomain: text5("subdomain").notNull().unique(),
  fullDomain: text5("full_domain").notNull(),
  sslEnabled: boolean3("ssl_enabled").default(true).notNull(),
  sslCertificatePath: text5("ssl_certificate_path"),
  expiresAt: timestamp5("expires_at"),
  isActive: boolean3("is_active").default(true).notNull(),
  webhookTriggered: boolean3("webhook_triggered").default(false).notNull(),
  environmentVariables: jsonb3("environment_variables").$type(),
  metadata: jsonb3("metadata").$type(),
  createdAt: timestamp5("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp5("updated_at").$defaultFn(() => new Date).notNull()
});
var deploymentLogs = pgTable5("deployment_logs", {
  id: uuid2("id").primaryKey().defaultRandom(),
  deploymentId: uuid2("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  level: logLevelEnum("level").default("info").notNull(),
  message: text5("message").notNull(),
  phase: text5("phase"),
  step: text5("step"),
  service: text5("service"),
  stage: text5("stage"),
  metadata: jsonb3("metadata").$type(),
  timestamp: timestamp5("timestamp").$defaultFn(() => new Date).notNull()
});
var deploymentStreams = pgTable5("deployment_streams", {
  id: uuid2("id").primaryKey().defaultRandom(),
  coreStreamId: uuid2("core_stream_id"),
  name: text5("name").notNull(),
  description: text5("description"),
  isActive: boolean3("is_active").default(true).notNull(),
  deploymentId: uuid2("deployment_id").references(() => deployments.id, { onDelete: "cascade" }),
  serviceId: uuid2("service_id").references(() => services.id, { onDelete: "cascade" }),
  projectId: uuid2("project_id").references(() => projects.id, { onDelete: "cascade" }),
  statusFilter: deploymentStatusEnum("status_filter"),
  environmentFilter: deploymentEnvironmentEnum("environment_filter"),
  eventTypes: jsonb3("event_types").$type(),
  replayDefault: boolean3("replay_default").default(true).notNull(),
  replayLimitDefault: integer3("replay_limit_default").default(100).notNull(),
  createdBy: text5("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp5("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp5("updated_at").$defaultFn(() => new Date).notNull()
});
var projectCollaborators = pgTable5("project_collaborators", {
  id: uuid2("id").primaryKey().defaultRandom(),
  projectId: uuid2("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text5("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: projectRoleEnum("role").default("viewer").notNull(),
  permissions: jsonb3("permissions").$type(),
  invitedBy: text5("invited_by").references(() => user.id, { onDelete: "set null" }),
  invitedAt: timestamp5("invited_at").$defaultFn(() => new Date).notNull(),
  acceptedAt: timestamp5("accepted_at"),
  createdAt: timestamp5("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp5("updated_at").$defaultFn(() => new Date).notNull()
});
var webhooks = pgTable5("webhooks", {
  id: uuid2("id").primaryKey().defaultRandom(),
  projectId: uuid2("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  serviceId: uuid2("service_id").references(() => services.id, { onDelete: "cascade" }),
  sourceType: sourceTypeEnum("source_type").notNull(),
  webhookUrl: text5("webhook_url").notNull(),
  externalWebhookId: text5("external_webhook_id"),
  secret: encryptedText("secret").notNull(),
  isActive: boolean3("is_active").default(true).notNull(),
  lastTriggered: timestamp5("last_triggered"),
  triggerCount: integer3("trigger_count").default(0).notNull(),
  settings: jsonb3("settings").$type(),
  createdAt: timestamp5("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp5("updated_at").$defaultFn(() => new Date).notNull()
});
var apiKeys = pgTable5("api_keys", {
  id: uuid2("id").primaryKey().defaultRandom(),
  userId: text5("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  projectId: uuid2("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text5("name").notNull(),
  keyHash: text5("key_hash").notNull().unique(),
  keyPreview: text5("key_preview").notNull(),
  scopes: jsonb3("scopes").$type(),
  lastUsed: timestamp5("last_used"),
  expiresAt: timestamp5("expires_at"),
  isActive: boolean3("is_active").default(true).notNull(),
  createdAt: timestamp5("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp5("updated_at").$defaultFn(() => new Date).notNull()
});
var rollbackStatusEnum = pgEnum2("rollback_status", [...zodEnumToPgEnumValues(rollbackStatusSchema)]);
var deploymentRollbacks = pgTable5("deployment_rollbacks", {
  id: uuid2("id").primaryKey().defaultRandom(),
  fromDeploymentId: uuid2("from_deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  toDeploymentId: uuid2("to_deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  triggeredBy: text5("triggered_by").references(() => user.id, { onDelete: "set null" }),
  status: rollbackStatusEnum("status").default("pending").notNull(),
  reason: text5("reason"),
  startedAt: timestamp5("started_at"),
  completedAt: timestamp5("completed_at"),
  failedAt: timestamp5("failed_at"),
  errorMessage: text5("error_message"),
  metadata: jsonb3("metadata").$type(),
  createdAt: timestamp5("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp5("updated_at").$defaultFn(() => new Date).notNull()
});
var githubInstallations = pgTable5("github_installations", {
  id: uuid2("id").primaryKey().defaultRandom(),
  userId: text5("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  installationId: integer3("installation_id").notNull().unique(),
  accountLogin: text5("account_login").notNull(),
  accountType: text5("account_type").notNull(),
  accountAvatarUrl: text5("account_avatar_url"),
  repositoriesCount: integer3("repositories_count").default(0),
  appId: text5("app_id"),
  privateKey: encryptedText("private_key"),
  clientId: text5("client_id"),
  clientSecret: encryptedText("client_secret"),
  webhookSecret: encryptedText("webhook_secret"),
  permissions: jsonb3("permissions").$type(),
  accessTokenUrl: text5("access_token_url"),
  htmlUrl: text5("html_url"),
  isActive: boolean3("is_active").default(true).notNull(),
  lastSyncedAt: timestamp5("last_synced_at"),
  metadata: jsonb3("metadata").$type(),
  createdAt: timestamp5("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp5("updated_at").$defaultFn(() => new Date).notNull()
});
var githubRepositories = pgTable5("github_repositories", {
  id: uuid2("id").primaryKey().defaultRandom(),
  installationId: uuid2("installation_id").notNull().references(() => githubInstallations.id, { onDelete: "cascade" }),
  repositoryId: integer3("repository_id").notNull().unique(),
  name: text5("name").notNull(),
  fullName: text5("full_name").notNull(),
  private: boolean3("private").notNull(),
  htmlUrl: text5("html_url").notNull(),
  description: text5("description"),
  defaultBranch: text5("default_branch").notNull(),
  language: text5("language"),
  forksCount: integer3("forks_count").default(0),
  stargazersCount: integer3("stargazers_count").default(0),
  isActive: boolean3("is_active").default(true).notNull(),
  lastSyncedAt: timestamp5("last_synced_at"),
  createdAt: timestamp5("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp5("updated_at").$defaultFn(() => new Date).notNull()
});
var deploymentRuleTriggerEnum = pgEnum2("deployment_rule_trigger", [
  "push",
  "pull_request",
  "tag",
  "release",
  "manual"
]);
var deploymentRules = pgTable5("deployment_rules", {
  id: uuid2("id").primaryKey().defaultRandom(),
  serviceId: uuid2("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  name: text5("name").notNull(),
  trigger: deploymentRuleTriggerEnum("trigger").notNull(),
  isEnabled: boolean3("is_enabled").default(true).notNull(),
  priority: integer3("priority").default(0).notNull(),
  branchPattern: text5("branch_pattern"),
  excludeBranchPattern: text5("exclude_branch_pattern"),
  tagPattern: text5("tag_pattern"),
  prLabels: jsonb3("pr_labels").$type(),
  prTargetBranches: jsonb3("pr_target_branches").$type(),
  requireApproval: boolean3("require_approval").default(false),
  minApprovals: integer3("min_approvals").default(1),
  environment: deploymentEnvironmentEnum("environment").notNull(),
  autoMergeOnSuccess: boolean3("auto_merge_on_success").default(false),
  autoDeleteOnMerge: boolean3("auto_delete_on_merge").default(true),
  environmentVariables: jsonb3("environment_variables").$type(),
  builderConfigOverride: jsonb3("builder_config_override").$type(),
  metadata: jsonb3("metadata").$type(),
  createdAt: timestamp5("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp5("updated_at").$defaultFn(() => new Date).notNull()
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
var domainConfigs = pgTable6("domain_configs", {
  id: text6("id").primaryKey(),
  projectId: uuid3("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  domain: text6("domain").notNull(),
  subdomain: text6("subdomain"),
  fullDomain: text6("full_domain").notNull(),
  sslEnabled: boolean4("ssl_enabled").default(false),
  sslProvider: text6("ssl_provider"),
  certificatePath: text6("certificate_path"),
  middleware: jsonb4("middleware"),
  dnsStatus: text6("dns_status", { enum: dnsStatusEnum }).default("pending"),
  dnsRecords: jsonb4("dns_records"),
  dnsLastChecked: timestamp6("dns_last_checked"),
  dnsErrorMessage: text6("dns_error_message"),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp6("created_at").defaultNow().notNull(),
  updatedAt: timestamp6("updated_at").defaultNow().notNull()
});
var routeConfigs = pgTable6("route_configs", {
  id: text6("id").primaryKey(),
  domainConfigId: text6("domain_config_id").references(() => domainConfigs.id, { onDelete: "cascade" }).notNull(),
  deploymentId: uuid3("deployment_id").references(() => deployments.id, { onDelete: "cascade" }),
  routeName: text6("route_name").notNull(),
  serviceName: text6("service_name").notNull(),
  containerName: text6("container_name"),
  targetPort: integer4("target_port").notNull(),
  pathPrefix: text6("path_prefix"),
  priority: integer4("priority").default(1),
  middleware: jsonb4("middleware"),
  healthCheck: jsonb4("health_check"),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp6("created_at").defaultNow().notNull(),
  updatedAt: timestamp6("updated_at").defaultNow().notNull()
});
var traefikStaticConfigs = pgTable6("traefik_static_configs", {
  id: text6("id").primaryKey(),
  projectId: uuid3("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull().unique(),
  globalConfig: jsonb4("global_config"),
  apiConfig: jsonb4("api_config"),
  entryPointsConfig: jsonb4("entry_points_config"),
  providersConfig: jsonb4("providers_config"),
  logConfig: jsonb4("log_config"),
  accessLogConfig: jsonb4("access_log_config"),
  metricsConfig: jsonb4("metrics_config"),
  tracingConfig: jsonb4("tracing_config"),
  tlsConfig: jsonb4("tls_config"),
  certificateResolversConfig: jsonb4("certificate_resolvers_config"),
  experimentalConfig: jsonb4("experimental_config"),
  serversTransportConfig: jsonb4("servers_transport_config"),
  hostResolverConfig: jsonb4("host_resolver_config"),
  clusterConfig: jsonb4("cluster_config"),
  fullConfig: jsonb4("full_config"),
  configVersion: integer4("config_version").default(1),
  syncStatus: text6("sync_status").default("pending"),
  lastSyncedAt: timestamp6("last_synced_at"),
  syncErrorMessage: text6("sync_error_message"),
  isValid: boolean4("is_valid").default(true),
  validationErrors: jsonb4("validation_errors"),
  createdAt: timestamp6("created_at").defaultNow().notNull(),
  updatedAt: timestamp6("updated_at").defaultNow().notNull()
});
var traefikConfigs = pgTable6("traefik_configs", {
  id: text6("id").primaryKey(),
  configName: text6("config_name").notNull(),
  configContent: text6("config_content").notNull(),
  configType: text6("config_type").notNull(),
  storageType: text6("storage_type").notNull().default("project"),
  projectId: uuid3("project_id").references(() => projects.id, { onDelete: "cascade" }),
  requiresFile: boolean4("requires_file").default(true),
  syncStatus: text6("sync_status").default("pending"),
  lastSyncedAt: timestamp6("last_synced_at"),
  syncErrorMessage: text6("sync_error_message"),
  fileChecksum: text6("file_checksum"),
  configVersion: integer4("config_version").default(1),
  metadata: jsonb4("metadata"),
  description: text6("description"),
  tags: jsonb4("tags"),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp6("created_at").defaultNow().notNull(),
  updatedAt: timestamp6("updated_at").defaultNow().notNull()
});
var serviceConfigReferences = pgTable6("service_config_references", {
  id: text6("id").primaryKey(),
  serviceId: uuid3("service_id").references(() => services.id, { onDelete: "cascade" }).notNull(),
  traefikConfigId: text6("traefik_config_id").references(() => traefikConfigs.id, { onDelete: "cascade" }).notNull(),
  referenceType: text6("reference_type").notNull(),
  priority: integer4("priority").default(0),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp6("created_at").defaultNow().notNull(),
  updatedAt: timestamp6("updated_at").defaultNow().notNull()
});
var traefikMiddleware = pgTable6("traefik_middleware", {
  id: uuid3("id").primaryKey().defaultRandom(),
  projectId: uuid3("project_id").references(() => projects.id, { onDelete: "cascade" }),
  middlewareName: text6("middleware_name").notNull(),
  middlewareType: text6("middleware_type").notNull(),
  configuration: jsonb4("configuration").notNull(),
  isGlobal: boolean4("is_global").default(false),
  priority: integer4("priority").default(0),
  isActive: boolean4("is_active").default(true),
  filePath: text6("file_path"),
  createdAt: timestamp6("created_at").defaultNow().notNull(),
  updatedAt: timestamp6("updated_at").defaultNow().notNull()
});
var traefikPlugins = pgTable6("traefik_plugins", {
  id: uuid3("id").primaryKey().defaultRandom(),
  projectId: uuid3("project_id").references(() => projects.id, { onDelete: "cascade" }),
  pluginName: text6("plugin_name").notNull(),
  pluginVersion: text6("plugin_version").notNull(),
  pluginSource: text6("plugin_source").notNull(),
  configuration: jsonb4("configuration"),
  isEnabled: boolean4("is_enabled").default(true),
  filePath: text6("file_path"),
  createdAt: timestamp6("created_at").defaultNow().notNull(),
  updatedAt: timestamp6("updated_at").defaultNow().notNull()
});
var traefikStaticFiles = pgTable6("traefik_static_files", {
  id: uuid3("id").primaryKey().defaultRandom(),
  projectId: uuid3("project_id").references(() => projects.id, { onDelete: "cascade" }),
  fileName: text6("file_name").notNull(),
  fileContent: text6("file_content").notNull(),
  mimeType: text6("mime_type").default("text/plain"),
  fileSize: integer4("file_size"),
  relativePath: text6("relative_path").notNull(),
  isPublic: boolean4("is_public").default(true),
  createdAt: timestamp6("created_at").defaultNow().notNull(),
  updatedAt: timestamp6("updated_at").defaultNow().notNull()
});
var traefikBackups = pgTable6("traefik_backups", {
  id: uuid3("id").primaryKey().defaultRandom(),
  projectId: uuid3("project_id").references(() => projects.id, { onDelete: "cascade" }),
  backupName: text6("backup_name").notNull(),
  backupType: text6("backup_type").notNull(),
  originalPath: text6("original_path").notNull(),
  backupContent: text6("backup_content").notNull(),
  compressionType: text6("compression_type"),
  backupSize: integer4("backup_size"),
  metadata: jsonb4("metadata"),
  createdAt: timestamp6("created_at").defaultNow().notNull(),
  expiresAt: timestamp6("expires_at")
});
var configFiles = pgTable6("config_files", {
  id: text6("id").primaryKey(),
  traefikConfigId: text6("traefik_config_id").references(() => traefikConfigs.id, { onDelete: "cascade" }).notNull(),
  filePath: text6("file_path").notNull(),
  fileSize: integer4("file_size"),
  checksum: text6("checksum"),
  permissions: text6("permissions").default("644"),
  owner: text6("owner").default("traefik"),
  exists: boolean4("exists").default(false),
  isWritable: boolean4("is_writable").default(true),
  lastWriteAttempt: timestamp6("last_write_attempt"),
  writeErrorMessage: text6("write_error_message"),
  containerPath: text6("container_path"),
  mountPoint: text6("mount_point"),
  createdAt: timestamp6("created_at").defaultNow().notNull(),
  updatedAt: timestamp6("updated_at").defaultNow().notNull()
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
var providerTraefikTemplates = pgTable6("provider_traefik_templates", {
  id: text6("id").primaryKey(),
  providerType: text6("provider_type").notNull().unique(),
  templateName: text6("template_name").notNull(),
  templateContent: text6("template_content").notNull(),
  description: text6("description"),
  variables: jsonb4("variables"),
  isDefault: boolean4("is_default").default(true),
  createdAt: timestamp6("created_at").defaultNow().notNull(),
  updatedAt: timestamp6("updated_at").defaultNow().notNull()
});
var serviceTraefikTemplates = pgTable6("service_traefik_templates", {
  id: text6("id").primaryKey(),
  serviceId: uuid3("service_id").references(() => services.id, { onDelete: "cascade" }).notNull(),
  templateContent: text6("template_content").notNull(),
  variables: jsonb4("variables"),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp6("created_at").defaultNow().notNull(),
  updatedAt: timestamp6("updated_at").defaultNow().notNull()
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
var traefikServiceConfigs = pgTable6("traefik_service_configs", {
  id: uuid3("id").primaryKey().defaultRandom(),
  serviceId: uuid3("service_id").references(() => services.id, { onDelete: "cascade" }).notNull(),
  domain: text6("domain").notNull(),
  subdomain: text6("subdomain"),
  fullDomain: text6("full_domain").notNull(),
  sslEnabled: boolean4("ssl_enabled").default(false),
  sslProvider: text6("ssl_provider").$type(),
  pathPrefix: text6("path_prefix"),
  port: integer4("port").notNull(),
  middleware: json("middleware"),
  healthCheck: json("health_check").$type(),
  isActive: boolean4("is_active").default(true),
  configContent: text6("config_content"),
  lastSyncedAt: timestamp6("last_synced_at"),
  createdAt: timestamp6("created_at").defaultNow(),
  updatedAt: timestamp6("updated_at").defaultNow()
}, (table) => [
  {
    serviceIdIndex: index2("traefik_service_configs_service_id_idx").on(table.serviceId),
    domainIndex: index2("traefik_service_configs_domain_idx").on(table.domain),
    fullDomainIndex: index2("traefik_service_configs_full_domain_idx").on(table.fullDomain),
    uniqueServiceConfig: uniqueIndex3("traefik_service_configs_service_id_unique").on(table.serviceId)
  }
]);
var traefikDomainRoutes = pgTable6("traefik_domain_routes", {
  id: uuid3("id").primaryKey().defaultRandom(),
  configId: uuid3("config_id").references(() => traefikServiceConfigs.id, { onDelete: "cascade" }).notNull(),
  hostRule: text6("host_rule").notNull(),
  pathRule: text6("path_rule"),
  method: text6("method"),
  headers: json("headers"),
  priority: integer4("priority").default(1),
  entryPoint: text6("entry_point").default("web"),
  middleware: json("middleware"),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp6("created_at").defaultNow(),
  updatedAt: timestamp6("updated_at").defaultNow()
}, (table) => [
  {
    configIdIndex: index2("traefik_domain_routes_config_id_idx").on(table.configId),
    hostRuleIndex: index2("traefik_domain_routes_host_rule_idx").on(table.hostRule),
    priorityIndex: index2("traefik_domain_routes_priority_idx").on(table.priority)
  }
]);
var traefikServiceTargets = pgTable6("traefik_service_targets", {
  id: uuid3("id").primaryKey().defaultRandom(),
  configId: uuid3("config_id").references(() => traefikServiceConfigs.id, { onDelete: "cascade" }).notNull(),
  url: text6("url").notNull(),
  weight: integer4("weight").default(1),
  healthCheck: json("health_check").$type(),
  isActive: boolean4("is_active").default(true),
  lastHealthCheck: timestamp6("last_health_check"),
  healthStatus: text6("health_status").$type().default("unknown"),
  createdAt: timestamp6("created_at").defaultNow(),
  updatedAt: timestamp6("updated_at").defaultNow()
}, (table) => [
  {
    configIdIndex: index2("traefik_service_targets_config_id_idx").on(table.configId),
    urlIndex: index2("traefik_service_targets_url_idx").on(table.url),
    healthStatusIndex: index2("traefik_service_targets_health_status_idx").on(table.healthStatus)
  }
]);
var traefikSSLCertificates = pgTable6("traefik_ssl_certificates", {
  id: uuid3("id").primaryKey().defaultRandom(),
  configId: uuid3("config_id").references(() => traefikServiceConfigs.id, { onDelete: "cascade" }).notNull(),
  domain: text6("domain").notNull(),
  subjectAltNames: json("subject_alt_names").$type(),
  issuer: text6("issuer"),
  serialNumber: text6("serial_number"),
  fingerprint: text6("fingerprint"),
  notBefore: timestamp6("not_before"),
  notAfter: timestamp6("not_after"),
  certificateData: text6("certificate_data"),
  privateKeyData: text6("private_key_data"),
  autoRenew: boolean4("auto_renew").default(true),
  renewalThreshold: integer4("renewal_threshold").default(30),
  lastRenewal: timestamp6("last_renewal"),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp6("created_at").defaultNow(),
  updatedAt: timestamp6("updated_at").defaultNow()
}, (table) => [
  {
    configIdIndex: index2("traefik_ssl_certificates_config_id_idx").on(table.configId),
    domainIndex: index2("traefik_ssl_certificates_domain_idx").on(table.domain),
    expiryIndex: index2("traefik_ssl_certificates_expiry_idx").on(table.notAfter),
    uniqueDomainConfig: uniqueIndex3("traefik_ssl_certificates_domain_config_unique").on(table.configId, table.domain)
  }
]);
var traefikConfigFiles = pgTable6("traefik_config_files", {
  id: uuid3("id").primaryKey().defaultRandom(),
  configId: uuid3("config_id").references(() => traefikServiceConfigs.id, { onDelete: "cascade" }).notNull(),
  fileName: text6("file_name").notNull(),
  filePath: text6("file_path").notNull(),
  relativePath: text6("relative_path").notNull(),
  fileType: text6("file_type").$type().default("config"),
  contentType: text6("content_type"),
  size: integer4("size"),
  checksum: text6("checksum"),
  content: text6("content"),
  lastSynced: timestamp6("last_synced"),
  syncStatus: text6("sync_status").$type().default("pending"),
  syncError: text6("sync_error"),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp6("created_at").defaultNow(),
  updatedAt: timestamp6("updated_at").defaultNow()
}, (table) => [
  {
    configIdIndex: index2("traefik_config_files_config_id_idx").on(table.configId),
    filePathIndex: index2("traefik_config_files_file_path_idx").on(table.filePath),
    fileTypeIndex: index2("traefik_config_files_file_type_idx").on(table.fileType),
    syncStatusIndex: index2("traefik_config_files_sync_status_idx").on(table.syncStatus),
    uniqueConfigFile: uniqueIndex3("traefik_config_files_config_file_unique").on(table.configId, table.filePath)
  }
]);
var traefikMiddlewares = pgTable6("traefik_middlewares", {
  id: uuid3("id").primaryKey().defaultRandom(),
  name: text6("name").notNull(),
  type: text6("type").$type().notNull(),
  config: json("config").notNull(),
  description: text6("description"),
  isGlobal: boolean4("is_global").default(false),
  serviceId: uuid3("service_id").references(() => services.id),
  isActive: boolean4("is_active").default(true),
  createdAt: timestamp6("created_at").defaultNow(),
  updatedAt: timestamp6("updated_at").defaultNow()
}, (table) => [
  {
    nameIndex: index2("traefik_middlewares_name_idx").on(table.name),
    typeIndex: index2("traefik_middlewares_type_idx").on(table.type),
    serviceIdIndex: index2("traefik_middlewares_service_id_idx").on(table.serviceId),
    uniqueServiceMiddleware: uniqueIndex3("traefik_middlewares_service_name_unique").on(table.serviceId, table.name)
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
// packages/nest/schema/src/global/deployment.schemas.ts
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
var projectSelectSchema = createSelectSchema(projects);
var projectInsertSchema = createInsertSchema(projects);
var projectUpdateSchema = createUpdateSchema(projects);
var serviceSelectSchema = createSelectSchema(services);
var serviceInsertSchema = createInsertSchema(services);
var serviceUpdateSchema = createUpdateSchema(services);
var deploymentSelectSchema = createSelectSchema(deployments);
var deploymentInsertSchema = createInsertSchema(deployments);
var deploymentUpdateSchema = createUpdateSchema(deployments);
var projectCollaboratorSelectSchema = createSelectSchema(projectCollaborators);
var projectCollaboratorInsertSchema = createInsertSchema(projectCollaborators);
var projectCollaboratorUpdateSchema = createUpdateSchema(projectCollaborators);
// packages/nest/schema/src/global/domain.ts
import {
  pgTable as pgTable7,
  uuid as uuid4,
  timestamp as timestamp7,
  boolean as boolean5,
  jsonb as jsonb5,
  pgEnum as pgEnum3,
  varchar,
  unique,
  index as index3
} from "drizzle-orm/pg-core";
import { relations as relations4 } from "drizzle-orm";
import {
  sslProviderSchema,
  verificationMethodSchema,
  verificationStatusSchema
} from "@deployer/contracts-common";
var verificationStatusEnum = pgEnum3("verification_status", [
  ...zodEnumToPgEnumValues(verificationStatusSchema)
]);
var verificationMethodEnum = pgEnum3("verification_method", [
  ...zodEnumToPgEnumValues(verificationMethodSchema)
]);
var sslProviderEnum = pgEnum3("ssl_provider", [
  ...zodEnumToPgEnumValues(sslProviderSchema)
]);
var projectDomains = pgTable7("project_domains", {
  id: uuid4("id").primaryKey().defaultRandom(),
  projectId: uuid4("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  domain: varchar("domain", { length: 255 }).notNull(),
  verificationStatus: verificationStatusEnum("verification_status").notNull().default("pending"),
  verificationMethod: verificationMethodEnum("verification_method").notNull().default("txt_record"),
  verificationToken: varchar("verification_token", { length: 255 }).notNull(),
  dnsRecordChecked: boolean5("dns_record_checked").notNull().default(false),
  lastVerificationAttempt: timestamp7("last_verification_attempt"),
  verifiedAt: timestamp7("verified_at"),
  allowedSubdomains: varchar("allowed_subdomains", { length: 100 }).array().notNull().default([]),
  isPrimary: boolean5("is_primary").notNull().default(false),
  createdAt: timestamp7("created_at").notNull().defaultNow(),
  updatedAt: timestamp7("updated_at").notNull().defaultNow(),
  metadata: jsonb5("metadata").$type().default({})
}, (table) => [{
  uniqueProjectDomain: unique().on(table.projectId, table.domain),
  projectIdIdx: index3("project_domains_project_id_idx").on(table.projectId),
  verificationStatusIdx: index3("project_domains_verification_status_idx").on(table.verificationStatus)
}]);
var serviceDomainMappings = pgTable7("service_domain_mappings", {
  id: uuid4("id").primaryKey().defaultRandom(),
  serviceId: uuid4("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  projectDomainId: uuid4("project_domain_id").notNull().references(() => projectDomains.id, { onDelete: "cascade" }),
  subdomain: varchar("subdomain", { length: 63 }),
  basePath: varchar("base_path", { length: 255 }),
  isPrimary: boolean5("is_primary").notNull().default(false),
  sslEnabled: boolean5("ssl_enabled").notNull().default(true),
  sslProvider: sslProviderEnum("ssl_provider").notNull().default("letsencrypt"),
  createdAt: timestamp7("created_at").notNull().defaultNow(),
  updatedAt: timestamp7("updated_at").notNull().defaultNow(),
  metadata: jsonb5("metadata").$type().default({})
}, (table) => [{
  uniqueUrl: unique().on(table.projectDomainId, table.subdomain, table.basePath),
  serviceIdIdx: index3("service_domain_mappings_service_id_idx").on(table.serviceId),
  projectDomainIdIdx: index3("service_domain_mappings_project_domain_id_idx").on(table.projectDomainId)
}]);
var projectDomainsRelations = relations4(projectDomains, ({ one, many }) => ({
  project: one(projects, {
    fields: [projectDomains.projectId],
    references: [projects.id]
  }),
  serviceMappings: many(serviceDomainMappings)
}));
var serviceDomainMappingsRelations = relations4(serviceDomainMappings, ({ one }) => ({
  service: one(services, {
    fields: [serviceDomainMappings.serviceId],
    references: [services.id]
  }),
  projectDomain: one(projectDomains, {
    fields: [serviceDomainMappings.projectDomainId],
    references: [projectDomains.id]
  })
}));
// packages/nest/schema/src/global/health.ts
import { pgTable as pgTable8, uuid as uuid5, text as text8, timestamp as timestamp8, boolean as boolean6, integer as integer5, jsonb as jsonb6, index as index4 } from "drizzle-orm/pg-core";
import { relations as relations5 } from "drizzle-orm";
var healthChecks = pgTable8("health_checks", {
  id: uuid5("id").primaryKey().defaultRandom(),
  serviceId: uuid5("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  status: text8("status", { enum: ["healthy", "unhealthy", "unknown", "starting"] }).notNull(),
  message: text8("message").notNull(),
  details: jsonb6("details"),
  responseTime: integer5("response_time"),
  checkType: text8("check_type", { enum: ["http", "tcp", "docker", "command", "disabled"] }).notNull(),
  checkConfig: jsonb6("check_config").notNull(),
  checkedAt: timestamp8("checked_at", { withTimezone: true }).notNull(),
  createdAt: timestamp8("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index4("health_checks_service_id_idx").on(table.serviceId), index4("health_checks_checked_at_idx").on(table.checkedAt), index4("health_checks_status_idx").on(table.status)]);
var serviceHealthConfigs = pgTable8("service_health_configs", {
  id: uuid5("id").primaryKey().defaultRandom(),
  serviceId: uuid5("service_id").notNull().unique().references(() => services.id, { onDelete: "cascade" }),
  enabled: boolean6("enabled").notNull().default(true),
  checkType: text8("check_type", { enum: ["http", "tcp", "docker", "command", "disabled"] }).notNull().default("http"),
  interval: integer5("interval").notNull().default(60),
  timeout: integer5("timeout").notNull().default(30),
  retries: integer5("retries").notNull().default(3),
  startPeriod: integer5("start_period").notNull().default(60),
  config: jsonb6("config").notNull(),
  alertOnFailure: boolean6("alert_on_failure").notNull().default(true),
  alertWebhookUrl: text8("alert_webhook_url"),
  alertEmail: text8("alert_email"),
  createdAt: timestamp8("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp8("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index4("service_health_configs_service_id_idx").on(table.serviceId)]);
var healthCheckJobs = pgTable8("health_check_jobs", {
  id: uuid5("id").primaryKey().defaultRandom(),
  name: text8("name").notNull().unique(),
  cronExpression: text8("cron_expression").notNull(),
  enabled: boolean6("enabled").notNull().default(true),
  batchSize: integer5("batch_size").notNull().default(10),
  timeout: integer5("timeout").notNull().default(300),
  lastRun: timestamp8("last_run", { withTimezone: true }),
  nextRun: timestamp8("next_run", { withTimezone: true }),
  runCount: integer5("run_count").notNull().default(0),
  createdAt: timestamp8("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp8("updated_at", { withTimezone: true }).notNull().defaultNow()
});
var healthChecksRelations = relations5(healthChecks, ({ one }) => ({
  service: one(services, {
    fields: [healthChecks.serviceId],
    references: [services.id]
  }),
  serviceHealthConfig: one(serviceHealthConfigs, {
    fields: [healthChecks.serviceId],
    references: [serviceHealthConfigs.serviceId]
  })
}));
var serviceHealthConfigsRelations = relations5(serviceHealthConfigs, ({ one, many }) => ({
  service: one(services, {
    fields: [serviceHealthConfigs.serviceId],
    references: [services.id]
  }),
  healthChecks: many(healthChecks)
}));
// packages/nest/schema/src/global/github-provider.ts
import {
  pgTable as pgTable9,
  text as text9,
  timestamp as timestamp9,
  boolean as boolean7,
  integer as integer6,
  uuid as uuid6,
  jsonb as jsonb7,
  pgEnum as pgEnum4,
  index as index5,
  uniqueIndex as uniqueIndex4
} from "drizzle-orm/pg-core";
import { relations as relations6 } from "drizzle-orm";
import { encryptedText as encryptedText2 } from "@deployer/nest-schema/codecs/codec-registry";
import {
  cacheStrategySchema,
  githubDeploymentStrategySchema,
  previewDeploymentStatusSchema
} from "@deployer/contracts-common";
var deploymentStrategyEnum = pgEnum4("deployment_strategy", [
  ...zodEnumToPgEnumValues(githubDeploymentStrategySchema)
]);
var cacheStrategyEnum = pgEnum4("cache_strategy", [...zodEnumToPgEnumValues(cacheStrategySchema)]);
var previewDeploymentStatusEnum = pgEnum4("preview_deployment_status", [
  ...zodEnumToPgEnumValues(previewDeploymentStatusSchema)
]);
var githubApps = pgTable9("github_apps", {
  id: uuid6("id").primaryKey().defaultRandom(),
  name: text9("name").notNull(),
  appId: text9("app_id").notNull(),
  clientId: text9("client_id").notNull(),
  clientSecret: encryptedText2("client_secret").notNull(),
  privateKey: encryptedText2("private_key").notNull(),
  webhookSecret: encryptedText2("webhook_secret").notNull(),
  installationId: text9("installation_id"),
  isActive: boolean7("is_active").notNull().default(true),
  createdAt: timestamp9("created_at", { withTimezone: true }).$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp9("updated_at", { withTimezone: true }).$defaultFn(() => new Date).notNull()
}, (table) => [
  index5("github_apps_app_id_idx").on(table.appId)
]);
var githubRepositoryConfigs = pgTable9("github_repository_configs", {
  id: uuid6("id").primaryKey().defaultRandom(),
  projectId: uuid6("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  githubAppId: uuid6("github_app_id").notNull().references(() => githubApps.id, { onDelete: "cascade" }),
  repositoryId: text9("repository_id").notNull(),
  repositoryFullName: text9("repository_full_name").notNull(),
  basePath: text9("base_path").default("/"),
  watchPaths: jsonb7("watch_paths").$type().default([]),
  ignorePaths: jsonb7("ignore_paths").$type().default([]),
  cacheStrategy: cacheStrategyEnum("cache_strategy").notNull().default("strict"),
  autoDeployEnabled: boolean7("auto_deploy_enabled").notNull().default(true),
  deploymentStrategy: deploymentStrategyEnum("deployment_strategy").notNull().default("standard"),
  customStrategyScript: text9("custom_strategy_script"),
  previewDeploymentsEnabled: boolean7("preview_deployments_enabled").notNull().default(false),
  previewBranchPattern: text9("preview_branch_pattern").default("*"),
  previewAutoDelete: boolean7("preview_auto_delete").notNull().default(true),
  previewAutoDeleteAfterDays: integer6("preview_auto_delete_after_days").default(7),
  createdAt: timestamp9("created_at", { withTimezone: true }).$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp9("updated_at", { withTimezone: true }).$defaultFn(() => new Date).notNull()
}, (table) => [
  index5("github_repo_configs_project_id_idx").on(table.projectId),
  index5("github_repo_configs_github_app_id_idx").on(table.githubAppId),
  index5("github_repo_configs_repo_id_idx").on(table.repositoryId)
]);
var githubDeploymentRules = pgTable9("github_deployment_rules", {
  id: uuid6("id").primaryKey().defaultRandom(),
  projectId: uuid6("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text9("name").notNull(),
  description: text9("description"),
  priority: integer6("priority").notNull().default(0),
  isActive: boolean7("is_active").notNull().default(true),
  event: text9("event").notNull(),
  branchPattern: text9("branch_pattern"),
  tagPattern: text9("tag_pattern"),
  pathConditions: jsonb7("path_conditions").$type(),
  customCondition: text9("custom_condition"),
  action: text9("action").notNull(),
  deploymentStrategy: deploymentStrategyEnum("deployment_strategy"),
  customStrategyScript: text9("custom_strategy_script"),
  bypassCache: boolean7("bypass_cache").notNull().default(false),
  createdAt: timestamp9("created_at", { withTimezone: true }).$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp9("updated_at", { withTimezone: true }).$defaultFn(() => new Date).notNull()
}, (table) => [
  index5("github_deployment_rules_project_id_idx").on(table.projectId),
  index5("github_deployment_rules_priority_idx").on(table.priority)
]);
var deploymentCache = pgTable9("deployment_cache", {
  id: uuid6("id").primaryKey().defaultRandom(),
  projectId: uuid6("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  repositoryId: text9("repository_id").notNull(),
  branch: text9("branch").notNull(),
  commitSha: text9("commit_sha").notNull(),
  commitMessage: text9("commit_message"),
  commitAuthor: text9("commit_author"),
  commitDate: timestamp9("commit_date", { withTimezone: true }),
  changedFiles: jsonb7("changed_files").$type().notNull(),
  deploymentId: uuid6("deployment_id"),
  basePath: text9("base_path").default("/"),
  cacheStrategy: cacheStrategyEnum("cache_strategy").notNull().default("strict"),
  createdAt: timestamp9("created_at", { withTimezone: true }).$defaultFn(() => new Date).notNull()
}, (table) => [
  index5("deployment_cache_project_id_idx").on(table.projectId),
  index5("deployment_cache_repo_id_idx").on(table.repositoryId),
  index5("deployment_cache_branch_idx").on(table.branch),
  index5("deployment_cache_commit_sha_idx").on(table.commitSha)
]);
var githubPreviewDeployments = pgTable9("github_preview_deployments", {
  id: uuid6("id").primaryKey().defaultRandom(),
  projectId: uuid6("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  repositoryId: text9("repository_id").notNull(),
  prNumber: integer6("pr_number").notNull(),
  branch: text9("branch").notNull(),
  deploymentId: uuid6("deployment_id"),
  serviceName: text9("service_name").notNull(),
  url: text9("url"),
  status: previewDeploymentStatusEnum("status").notNull().default("pending"),
  lastActivityAt: timestamp9("last_activity_at", { withTimezone: true }).$defaultFn(() => new Date).notNull(),
  autoDeleteAt: timestamp9("auto_delete_at", { withTimezone: true }),
  deletedAt: timestamp9("deleted_at", { withTimezone: true }),
  createdAt: timestamp9("created_at", { withTimezone: true }).$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp9("updated_at", { withTimezone: true }).$defaultFn(() => new Date).notNull()
}, (table) => [
  index5("github_preview_deployments_project_id_idx").on(table.projectId),
  index5("github_preview_deployments_repo_id_idx").on(table.repositoryId),
  index5("github_preview_deployments_pr_number_idx").on(table.prNumber),
  index5("github_preview_deployments_status_idx").on(table.status)
]);
var githubWebhookEvents = pgTable9("github_webhook_events", {
  id: uuid6("id").primaryKey().defaultRandom(),
  githubAppId: uuid6("github_app_id").references(() => githubApps.id, {
    onDelete: "cascade"
  }),
  event: text9("event").notNull(),
  deliveryId: text9("delivery_id").notNull(),
  payload: jsonb7("payload").notNull(),
  processed: boolean7("processed").notNull().default(false),
  processedAt: timestamp9("processed_at", { withTimezone: true }),
  error: text9("error"),
  createdAt: timestamp9("created_at", { withTimezone: true }).$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex4("github_webhook_events_delivery_id_uniq_idx").on(table.deliveryId),
  index5("github_webhook_events_app_id_idx").on(table.githubAppId),
  index5("github_webhook_events_processed_idx").on(table.processed)
]);
var githubAppsRelations = relations6(githubApps, ({ many }) => ({
  repositoryConfigs: many(githubRepositoryConfigs),
  webhookEvents: many(githubWebhookEvents)
}));
var githubRepositoryConfigsRelations = relations6(githubRepositoryConfigs, ({ one }) => ({
  project: one(projects, {
    fields: [githubRepositoryConfigs.projectId],
    references: [projects.id]
  }),
  githubApp: one(githubApps, {
    fields: [githubRepositoryConfigs.githubAppId],
    references: [githubApps.id]
  })
}));
var githubDeploymentRulesRelations = relations6(githubDeploymentRules, ({ one }) => ({
  project: one(projects, {
    fields: [githubDeploymentRules.projectId],
    references: [projects.id]
  })
}));
var deploymentCacheRelations = relations6(deploymentCache, ({ one }) => ({
  project: one(projects, {
    fields: [deploymentCache.projectId],
    references: [projects.id]
  })
}));
var githubPreviewDeploymentsRelations = relations6(githubPreviewDeployments, ({ one }) => ({
  project: one(projects, {
    fields: [githubPreviewDeployments.projectId],
    references: [projects.id]
  })
}));
var githubWebhookEventsRelations = relations6(githubWebhookEvents, ({ one }) => ({
  githubApp: one(githubApps, {
    fields: [githubWebhookEvents.githubAppId],
    references: [githubApps.id]
  })
}));
// packages/nest/schema/src/global/gitlab-provider.ts
import { pgTable as pgTable10, text as text10, timestamp as timestamp10, boolean as boolean8, uuid as uuid7 } from "drizzle-orm/pg-core";
import { encryptedText as encryptedText3 } from "@deployer/nest-schema/codecs/codec-registry";
var gitlabApps = pgTable10("gitlab_apps", {
  id: uuid7("id").primaryKey().defaultRandom(),
  name: text10("name").notNull(),
  url: text10("url").notNull(),
  accessToken: encryptedText3("access_token").notNull(),
  isActive: boolean8("is_active").notNull().default(true),
  createdAt: timestamp10("created_at", { withTimezone: true }).$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp10("updated_at", { withTimezone: true }).$defaultFn(() => new Date).notNull()
}, (table) => []);
// packages/nest/schema/src/global/events.ts
import { pgTable as pgTable11, text as text11, timestamp as timestamp11, boolean as boolean9, integer as integer7, uuid as uuid8, jsonb as jsonb8, index as index7 } from "drizzle-orm/pg-core";
import { relations as relations7 } from "drizzle-orm";
var coreEventStreams = pgTable11("core_event_streams", {
  id: uuid8("id").primaryKey().defaultRandom(),
  name: text11("name").notNull(),
  namespace: text11("namespace").notNull(),
  description: text11("description"),
  isActive: boolean9("is_active").default(true).notNull(),
  scope: text11("scope").notNull().default("global"),
  scopeId: text11("scope_id"),
  filters: jsonb8("filters").$type(),
  replayDefault: boolean9("replay_default").default(true).notNull(),
  replayLimitDefault: integer7("replay_limit_default").default(100).notNull(),
  createdBy: text11("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp11("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp11("updated_at").$defaultFn(() => new Date).notNull()
});
var coreEventStreamsRelations = relations7(coreEventStreams, ({ one }) => ({
  createdByUser: one(user, {
    fields: [coreEventStreams.createdBy],
    references: [user.id]
  })
}));
var coreEventLogs = pgTable11("core_event_logs", {
  id: uuid8("id").primaryKey().defaultRandom(),
  namespace: text11("namespace").notNull(),
  eventName: text11("event_name").notNull(),
  eventKey: text11("event_key").notNull(),
  sequence: integer7("sequence").notNull(),
  input: jsonb8("input").$type().notNull(),
  output: jsonb8("output").$type().notNull(),
  emittedAt: timestamp11("emitted_at").$defaultFn(() => new Date).notNull(),
  createdAt: timestamp11("created_at").defaultNow().$defaultFn(() => new Date).notNull()
}, (table) => [
  index7("core_event_logs_namespace_idx").on(table.namespace),
  index7("core_event_logs_event_name_idx").on(table.eventName),
  index7("core_event_logs_event_key_idx").on(table.eventKey),
  index7("core_event_logs_emitted_at_idx").on(table.emittedAt)
]);
// packages/nest/schema/src/global/cluster.ts
import { relations as relations8 } from "drizzle-orm";
import { boolean as boolean10, index as index8, integer as integer8, jsonb as jsonb9, pgEnum as pgEnum5, pgTable as pgTable12, text as text12, timestamp as timestamp12, unique as unique2, uniqueIndex as uniqueIndex5, uuid as uuid9 } from "drizzle-orm/pg-core";
import { encryptedText as encryptedText4 } from "@deployer/nest-schema/codecs/codec-registry";
var clusterNodeStatusEnum = pgEnum5("cluster_node_status", ["active", "suspect", "draining", "revoked"]);
var clusterJoinGrantStatusEnum = pgEnum5("cluster_join_grant_status", ["issued", "used", "expired", "revoked"]);
var clusterSigningKeyStatusEnum = pgEnum5("cluster_signing_key_status", ["active", "previous", "revoked"]);
var resourceOwnershipStatusEnum = pgEnum5("resource_ownership_status", ["active", "stale", "revoked"]);
var clusterAllocationModeEnum = pgEnum5("cluster_allocation_mode", ["dedicated_full", "dedicated_slice", "shared_slice"]);
var clusterAdmissionRequestStatusEnum = pgEnum5("cluster_admission_request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled"
]);
var clusterNodes = pgTable12("cluster_nodes", {
  id: uuid9("id").primaryKey().defaultRandom(),
  nodeId: text12("node_id").notNull(),
  serverUrl: text12("server_url").notNull(),
  displayName: text12("display_name"),
  status: clusterNodeStatusEnum("status").default("active").notNull(),
  healthy: boolean10("healthy").default(true).notNull(),
  capabilities: jsonb9("capabilities").$type(),
  maxCpuMillicores: integer8("max_cpu_millicores"),
  maxMemoryMb: integer8("max_memory_mb"),
  metadata: jsonb9("metadata").$type(),
  enrolledAt: timestamp12("enrolled_at").$defaultFn(() => new Date).notNull(),
  swarmNodeId: text12("swarm_node_id"),
  lastSeenAt: timestamp12("last_seen_at"),
  createdAt: timestamp12("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp12("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  unique2("cluster_nodes_node_id_unique").on(table.nodeId),
  index8("cluster_nodes_cluster_status_idx").on(table.status)
]);
var clusterJoinGrants = pgTable12("cluster_join_grants", {
  id: uuid9("id").primaryKey().defaultRandom(),
  grantTokenHash: text12("grant_token_hash").notNull(),
  status: clusterJoinGrantStatusEnum("status").default("issued").notNull(),
  issuedByUserId: text12("issued_by_user_id").references(() => user.id, { onDelete: "set null" }),
  targetNodeId: text12("target_node_id"),
  expiresAt: timestamp12("expires_at").notNull(),
  usedAt: timestamp12("used_at"),
  revokedAt: timestamp12("revoked_at"),
  metadata: jsonb9("metadata").$type(),
  createdAt: timestamp12("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp12("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex5("cluster_join_grants_token_hash_uidx").on(table.grantTokenHash),
  index8("cluster_join_grants_cluster_status_idx").on(table.status),
  index8("cluster_join_grants_expires_at_idx").on(table.expiresAt)
]);
var clusterSigningKeys = pgTable12("cluster_signing_keys", {
  id: uuid9("id").primaryKey().defaultRandom(),
  kid: text12("kid").notNull(),
  algorithm: text12("algorithm").default("HS256").notNull(),
  status: clusterSigningKeyStatusEnum("status").default("active").notNull(),
  secretMaterial: encryptedText4("secret_material").notNull(),
  publicJwk: jsonb9("public_jwk").$type(),
  activatedAt: timestamp12("activated_at").$defaultFn(() => new Date).notNull(),
  expiresAt: timestamp12("expires_at"),
  rotatedAt: timestamp12("rotated_at"),
  revokedAt: timestamp12("revoked_at"),
  createdAt: timestamp12("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp12("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex5("cluster_signing_keys_kid_uidx").on(table.kid),
  index8("cluster_signing_keys_cluster_status_idx").on(table.status)
]);
var clusterNodeMetrics = pgTable12("cluster_node_metrics", {
  id: uuid9("id").primaryKey().defaultRandom(),
  nodeId: text12("node_id").notNull().references(() => clusterNodes.nodeId, { onDelete: "cascade" }),
  metrics: jsonb9("metrics").$type().notNull(),
  metricVersion: integer8("metric_version").default(1).notNull(),
  reportedAt: timestamp12("reported_at").notNull(),
  expiresAt: timestamp12("expires_at"),
  createdAt: timestamp12("created_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  index8("cluster_node_metrics_cluster_node_reported_idx").on(table.nodeId, table.reportedAt)
]);
var resourceOwnershipIndex = pgTable12("resource_ownership_index", {
  id: uuid9("id").primaryKey().defaultRandom(),
  resourceKind: text12("resource_kind").notNull(),
  resourceKey: text12("resource_key").notNull(),
  ownerNodeId: text12("owner_node_id").notNull().references(() => clusterNodes.nodeId, { onDelete: "cascade" }),
  ownerServerUrl: text12("owner_server_url"),
  priority: integer8("priority").default(0).notNull(),
  status: resourceOwnershipStatusEnum("status").default("active").notNull(),
  leaseHolderNodeId: text12("lease_holder_node_id").references(() => clusterNodes.nodeId, { onDelete: "set null" }),
  leaseExpiresAt: timestamp12("lease_expires_at"),
  version: integer8("version").default(1).notNull(),
  metadata: jsonb9("metadata").$type(),
  observedAt: timestamp12("observed_at").$defaultFn(() => new Date).notNull(),
  createdAt: timestamp12("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp12("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex5("resource_ownership_index_unique_owner_uidx").on(table.resourceKind, table.resourceKey, table.ownerNodeId),
  index8("resource_ownership_index_lookup_idx").on(table.resourceKind, table.resourceKey, table.status),
  index8("resource_ownership_index_owner_node_idx").on(table.ownerNodeId)
]);
var clusterServerAllocations = pgTable12("cluster_server_allocations", {
  id: uuid9("id").primaryKey().defaultRandom(),
  serverNodeId: text12("server_node_id").notNull().references(() => clusterNodes.nodeId, { onDelete: "cascade" }),
  allocationMode: clusterAllocationModeEnum("allocation_mode").default("shared_slice").notNull(),
  cpuMillicores: integer8("cpu_millicores").default(0).notNull(),
  memoryMb: integer8("memory_mb").default(0).notNull(),
  maxServices: integer8("max_services"),
  isEnabled: boolean10("is_enabled").default(true).notNull(),
  createdByUserId: text12("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp12("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp12("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex5("cluster_server_allocations_unique_uidx").on(table.serverNodeId),
  index8("cluster_server_allocations_server_idx").on(table.serverNodeId, table.updatedAt)
]);
var clusterAdmissionRequests = pgTable12("cluster_admission_requests", {
  id: uuid9("id").primaryKey().defaultRandom(),
  status: clusterAdmissionRequestStatusEnum("status").default("pending").notNull(),
  requestedServerNodeId: text12("requested_server_node_id").references(() => clusterNodes.nodeId, {
    onDelete: "set null"
  }),
  decisionServerNodeId: text12("decision_server_node_id").references(() => clusterNodes.nodeId, {
    onDelete: "set null"
  }),
  requestedCpuMillicores: integer8("requested_cpu_millicores").default(0).notNull(),
  requestedMemoryMb: integer8("requested_memory_mb").default(0).notNull(),
  requestedServices: integer8("requested_services").default(1).notNull(),
  requesterUserId: text12("requester_user_id").references(() => user.id, { onDelete: "set null" }),
  requesterNote: text12("requester_note"),
  reviewedByUserId: text12("reviewed_by_user_id").references(() => user.id, { onDelete: "set null" }),
  reviewerNote: text12("reviewer_note"),
  reviewedAt: timestamp12("reviewed_at"),
  createdAt: timestamp12("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp12("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  index8("cluster_admission_requests_status_idx").on(table.status, table.updatedAt),
  index8("cluster_admission_requests_cluster_idx").on(table.updatedAt)
]);
var clusterNodesRelations = relations8(clusterNodes, ({ many }) => ({
  metrics: many(clusterNodeMetrics),
  ownedResources: many(resourceOwnershipIndex, { relationName: "resourceOwnershipOwner" }),
  leaseResources: many(resourceOwnershipIndex, { relationName: "resourceOwnershipLeaseHolder" })
}));
var clusterNodeMetricsRelations = relations8(clusterNodeMetrics, ({ one }) => ({
  node: one(clusterNodes, {
    fields: [clusterNodeMetrics.nodeId],
    references: [clusterNodes.nodeId]
  })
}));
var resourceOwnershipIndexRelations = relations8(resourceOwnershipIndex, ({ one }) => ({
  ownerNode: one(clusterNodes, {
    fields: [resourceOwnershipIndex.ownerNodeId],
    references: [clusterNodes.nodeId],
    relationName: "resourceOwnershipOwner"
  }),
  leaseHolderNode: one(clusterNodes, {
    fields: [resourceOwnershipIndex.leaseHolderNodeId],
    references: [clusterNodes.nodeId],
    relationName: "resourceOwnershipLeaseHolder"
  })
}));
var clusterJoinGrantsRelations = relations8(clusterJoinGrants, ({ one }) => ({
  issuedBy: one(user, {
    fields: [clusterJoinGrants.issuedByUserId],
    references: [user.id]
  })
}));
var clusterServerAllocationsRelations = relations8(clusterServerAllocations, ({ one }) => ({
  serverNode: one(clusterNodes, {
    fields: [clusterServerAllocations.serverNodeId],
    references: [clusterNodes.nodeId]
  }),
  createdBy: one(user, {
    fields: [clusterServerAllocations.createdByUserId],
    references: [user.id]
  })
}));
var clusterAdmissionRequestsRelations = relations8(clusterAdmissionRequests, ({ one }) => ({
  requestedServerNode: one(clusterNodes, {
    fields: [clusterAdmissionRequests.requestedServerNodeId],
    references: [clusterNodes.nodeId]
  }),
  decisionServerNode: one(clusterNodes, {
    fields: [clusterAdmissionRequests.decisionServerNodeId],
    references: [clusterNodes.nodeId]
  }),
  requester: one(user, {
    fields: [clusterAdmissionRequests.requesterUserId],
    references: [user.id]
  }),
  reviewer: one(user, {
    fields: [clusterAdmissionRequests.reviewedByUserId],
    references: [user.id]
  })
}));
// packages/nest/schema/src/global/runtime.ts
import { sql } from "drizzle-orm";
import {
  index as index9,
  integer as integer9,
  jsonb as jsonb10,
  pgEnum as pgEnum6,
  pgTable as pgTable13,
  text as text13,
  timestamp as timestamp13,
  uniqueIndex as uniqueIndex6,
  uuid as uuid10
} from "drizzle-orm/pg-core";
var localJobStateEnum = pgEnum6("local_job_state", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
]);
var localOutboxStateEnum = pgEnum6("local_outbox_state", [
  "pending",
  "dispatching",
  "sent",
  "failed",
  "dead_letter"
]);
var localQueueJobs = pgTable13("local_queue_jobs", {
  id: uuid10("id").primaryKey().defaultRandom(),
  nodeId: text13("node_id").notNull(),
  deploymentRunId: uuid10("deployment_run_id"),
  jobType: text13("job_type").notNull(),
  state: localJobStateEnum("state").default("queued").notNull(),
  attempt: integer9("attempt").default(0).notNull(),
  payload: jsonb10("payload").$type().notNull(),
  scheduledAt: timestamp13("scheduled_at").$defaultFn(() => new Date).notNull(),
  startedAt: timestamp13("started_at"),
  finishedAt: timestamp13("finished_at"),
  createdAt: timestamp13("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp13("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  index9("local_queue_jobs_node_state_idx").on(table.nodeId, table.state),
  index9("local_queue_jobs_deployment_idx").on(table.deploymentRunId)
]);
var localRuntimeProcesses = pgTable13("local_runtime_processes", {
  id: uuid10("id").primaryKey().defaultRandom(),
  nodeId: text13("node_id").notNull(),
  deploymentRunId: uuid10("deployment_run_id"),
  serviceId: uuid10("service_id"),
  containerName: text13("container_name"),
  processKey: text13("process_key"),
  status: text13("status").notNull(),
  metadata: jsonb10("metadata").$type(),
  startedAt: timestamp13("started_at"),
  stoppedAt: timestamp13("stopped_at"),
  createdAt: timestamp13("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp13("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  index9("local_runtime_processes_node_status_idx").on(table.nodeId, table.status),
  index9("local_runtime_processes_service_idx").on(table.serviceId)
]);
var localBuildCache = pgTable13("local_build_cache", {
  id: uuid10("id").primaryKey().defaultRandom(),
  nodeId: text13("node_id").notNull(),
  cacheKey: text13("cache_key").notNull(),
  storagePath: text13("storage_path").notNull(),
  sizeBytes: integer9("size_bytes"),
  metadata: jsonb10("metadata").$type(),
  createdAt: timestamp13("created_at").$defaultFn(() => new Date).notNull(),
  expiresAt: timestamp13("expires_at")
}, (table) => [
  index9("local_build_cache_node_idx").on(table.nodeId),
  index9("local_build_cache_cache_key_idx").on(table.cacheKey)
]);
var localEventOutbox = pgTable13("local_event_outbox", {
  id: uuid10("id").primaryKey().defaultRandom(),
  nodeId: text13("node_id").notNull(),
  topic: text13("topic").notNull(),
  payload: jsonb10("payload").$type().notNull(),
  state: localOutboxStateEnum("state").default("pending").notNull(),
  retryCount: integer9("retry_count").default(0).notNull(),
  nextRetryAt: timestamp13("next_retry_at"),
  eventId: uuid10("event_id"),
  lockedUntil: timestamp13("locked_until"),
  createdAt: timestamp13("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp13("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  index9("local_event_outbox_node_state_idx").on(table.nodeId, table.state),
  index9("local_event_outbox_topic_idx").on(table.topic),
  index9("local_event_outbox_claim_idx").on(table.nodeId, table.state, table.nextRetryAt, table.createdAt),
  uniqueIndex6("local_event_outbox_event_id_key").on(table.eventId).where(sql`${table.eventId} is not null`)
]);
// packages/nest/schema/src/global/docker-security-scan.ts
import { index as index10, integer as integer10, jsonb as jsonb11, pgEnum as pgEnum7, pgTable as pgTable14, text as text14, timestamp as timestamp14, uniqueIndex as uniqueIndex7, uuid as uuid11 } from "drizzle-orm/pg-core";
var dockerImageLifecycleStateEnum = pgEnum7("docker_image_lifecycle_state", ["alive", "deleted"]);
var dockerImageSecurityScanStatusEnum = pgEnum7("docker_image_security_scan_status", ["completed", "error"]);
var dockerImageSecurityScans = pgTable14("docker_image_security_scans", {
  id: uuid11("id").primaryKey().defaultRandom(),
  imageId: text14("image_id").notNull(),
  imageIdentifierNormalized: text14("image_identifier_normalized").notNull(),
  imageGeneration: integer10("image_generation").notNull().default(1),
  vulnerabilities: jsonb11("vulnerabilities").$type().notNull(),
  scanSummary: jsonb11("scan_summary").$type().notNull(),
  scanStatus: dockerImageSecurityScanStatusEnum("scan_status").notNull().default("completed"),
  lastUpdated: timestamp14("last_updated").$defaultFn(() => new Date).notNull(),
  createdAt: timestamp14("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp14("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex7("docker_image_security_scans_identifier_generation_uidx").on(table.imageIdentifierNormalized, table.imageGeneration),
  index10("docker_image_security_scans_image_idx").on(table.imageId),
  index10("docker_image_security_scans_image_identifier_generation_idx").on(table.imageIdentifierNormalized, table.imageGeneration),
  index10("docker_image_security_scans_last_updated_idx").on(table.lastUpdated)
]);
var dockerImageSecurityScanHistory = pgTable14("docker_image_security_scan_history", {
  id: uuid11("id").primaryKey().defaultRandom(),
  imageId: text14("image_id").notNull(),
  imageIdentifierNormalized: text14("image_identifier_normalized").notNull(),
  imageGeneration: integer10("image_generation").notNull().default(1),
  scanHash: text14("scan_hash").notNull(),
  vulnerabilities: jsonb11("vulnerabilities").$type().notNull(),
  scanSummary: jsonb11("scan_summary").$type().notNull(),
  scanStatus: dockerImageSecurityScanStatusEnum("scan_status").notNull().default("completed"),
  createdAt: timestamp14("created_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex7("docker_image_security_scan_history_scan_hash_uidx").on(table.scanHash),
  index10("docker_image_security_scan_history_identifier_idx").on(table.imageIdentifierNormalized),
  index10("docker_image_security_scan_history_generation_idx").on(table.imageIdentifierNormalized, table.imageGeneration),
  index10("docker_image_security_scan_history_created_idx").on(table.createdAt)
]);
var dockerImageSecurityLifecycle = pgTable14("docker_image_security_lifecycle", {
  id: uuid11("id").primaryKey().defaultRandom(),
  imageIdentifierNormalized: text14("image_identifier_normalized").notNull(),
  currentGeneration: integer10("current_generation").notNull().default(1),
  lifecycleState: dockerImageLifecycleStateEnum("lifecycle_state").notNull().default("alive"),
  firstSeenAt: timestamp14("first_seen_at").$defaultFn(() => new Date).notNull(),
  lastSeenAt: timestamp14("last_seen_at").$defaultFn(() => new Date).notNull(),
  deletedAt: timestamp14("deleted_at"),
  revivedAt: timestamp14("revived_at"),
  createdAt: timestamp14("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp14("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex7("docker_image_security_lifecycle_identifier_uidx").on(table.imageIdentifierNormalized),
  index10("docker_image_security_lifecycle_state_idx").on(table.lifecycleState),
  index10("docker_image_security_lifecycle_last_seen_idx").on(table.lastSeenAt)
]);
// packages/nest/schema/src/global/docker-runtime-activity.ts
import { index as index11, integer as integer11, jsonb as jsonb12, pgEnum as pgEnum8, pgTable as pgTable15, text as text15, timestamp as timestamp15, uniqueIndex as uniqueIndex8, uuid as uuid12 } from "drizzle-orm/pg-core";
var dockerRuntimeActivityStatusEnum = pgEnum8("docker_runtime_activity_status", [
  "queued",
  "running",
  "completed",
  "error",
  "info"
]);
var dockerRuntimeActivityCategoryEnum = pgEnum8("docker_runtime_activity_category", [
  "image-scanning",
  "runtime-event"
]);
var dockerRuntimeActivitySeverityEnum = pgEnum8("docker_runtime_activity_severity", [
  "info",
  "warning",
  "error"
]);
var dockerRuntimeActivities = pgTable15("docker_runtime_activities", {
  id: uuid12("id").primaryKey().defaultRandom(),
  eventFingerprint: text15("event_fingerprint").notNull(),
  eventId: text15("event_id"),
  flowId: text15("flow_id").notNull(),
  dependsOnFlowId: text15("depends_on_flow_id"),
  source: text15("source").notNull(),
  action: text15("action").notNull(),
  actorId: text15("actor_id"),
  status: dockerRuntimeActivityStatusEnum("status").notNull().default("info"),
  category: dockerRuntimeActivityCategoryEnum("category").notNull().default("runtime-event"),
  severity: dockerRuntimeActivitySeverityEnum("severity").notNull().default("info"),
  progress: integer11("progress"),
  stage: text15("stage"),
  scanner: text15("scanner"),
  message: text15("message"),
  actorAttributes: jsonb12("actor_attributes").$type().notNull(),
  payload: jsonb12("payload").$type().notNull(),
  raw: jsonb12("raw").$type().notNull(),
  occurredAt: timestamp15("occurred_at").notNull(),
  createdAt: timestamp15("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp15("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex8("docker_runtime_activities_fingerprint_uidx").on(table.eventFingerprint),
  index11("docker_runtime_activities_occurred_idx").on(table.occurredAt),
  index11("docker_runtime_activities_flow_idx").on(table.flowId),
  index11("docker_runtime_activities_category_idx").on(table.category),
  index11("docker_runtime_activities_status_idx").on(table.status),
  index11("docker_runtime_activities_source_action_idx").on(table.source, table.action)
]);
// packages/nest/schema/src/global/project-scan-config.ts
import { boolean as boolean11, jsonb as jsonb13, pgTable as pgTable16, timestamp as timestamp16, uuid as uuid13 } from "drizzle-orm/pg-core";
var projectScanConfig = pgTable16("project_scan_config", {
  id: uuid13("id").primaryKey().defaultRandom(),
  projectId: uuid13("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }).unique(),
  autoScanEnabled: boolean11("auto_scan_enabled").notNull().default(false),
  engines: jsonb13("engines").$type().notNull().default([]),
  serviceFilters: jsonb13("service_filters").$type().default(null),
  lastScanAt: timestamp16("last_scan_at"),
  createdAt: timestamp16("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp16("updated_at").$defaultFn(() => new Date).notNull()
});
// packages/nest/schema/src/global/image-project-membership.ts
import { pgTable as pgTable17, text as text17, timestamp as timestamp17, uniqueIndex as uniqueIndex9, uuid as uuid14 } from "drizzle-orm/pg-core";
var imageProjectMembership = pgTable17("image_project_membership", {
  id: uuid14("id").primaryKey().defaultRandom(),
  imageIdentifierNormalized: text17("image_identifier_normalized").notNull(),
  projectId: uuid14("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  serviceId: uuid14("service_id"),
  createdAt: timestamp17("created_at").$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp17("updated_at").$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex9("ipm_image_project_uidx").on(table.imageIdentifierNormalized, table.projectId)
]);
// packages/nest/schema/src/global/schema-version.ts
import { pgTable as pgTable18, text as text18, timestamp as timestamp18, jsonb as jsonb14 } from "drizzle-orm/pg-core";
var schemaVersion = pgTable18("schema_version", {
  nodeId: text18("node_id").primaryKey(),
  schemaVersion: text18("schema_version").notNull(),
  appliedMigrations: jsonb14("applied_migrations").notNull().$type(),
  appVersion: text18("app_version").notNull(),
  lastVerification: timestamp18("last_verification", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp18("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp18("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date)
});
// packages/nest/schema/src/global/cluster-migration-state.ts
import { pgTable as pgTable19, text as text19, timestamp as timestamp19, jsonb as jsonb15, integer as integer12 } from "drizzle-orm/pg-core";
var clusterMigrationState = pgTable19("cluster_migration_state", {
  id: integer12("id").primaryKey().default(1),
  clusterSchemaVersion: text19("cluster_schema_version").notNull(),
  requiredAppVersion: text19("required_app_version").notNull(),
  consensusNodeIds: jsonb15("consensus_node_ids").notNull().$type(),
  recordVersion: integer12("record_version").notNull().default(1),
  lastConsensusAt: timestamp19("last_consensus_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp19("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp19("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date)
});
// packages/nest/schema/src/global/app-config.ts
import { pgTable as pgTable20, text as text20, timestamp as timestamp20, index as index12 } from "drizzle-orm/pg-core";
var appConfig = pgTable20("app_config", {
  key: text20("key").primaryKey(),
  value: text20("value").notNull(),
  description: text20("description"),
  updatedAt: timestamp20("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text20("updated_by")
}, (table) => [
  index12("app_config_key_idx").on(table.key)
]);
// packages/nest/schema/src/global/dns-providers.ts
import { boolean as boolean12, index as index13, jsonb as jsonb16, pgTable as pgTable21, text as text21, timestamp as timestamp21, uuid as uuid15 } from "drizzle-orm/pg-core";
import { encryptedText as encryptedText5 } from "@deployer/nest-schema/codecs/codec-registry";
var dnsProviders = pgTable21("dns_providers", {
  id: uuid15("id").primaryKey().defaultRandom(),
  providerType: text21("provider_type").notNull(),
  name: text21("name").notNull(),
  isActive: boolean12("is_active").notNull().default(true),
  credentials: encryptedText5("credentials").notNull(),
  config: jsonb16("config").$type().notNull().$defaultFn(() => ({ accountId: null })),
  features: jsonb16("features").$type().notNull().$defaultFn(() => ({ dnsManagement: true, tunnelManagement: false })),
  state: jsonb16("state").$type().$defaultFn(() => null),
  createdAt: timestamp21("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp21("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date)
}, (table) => [
  index13("dns_providers_type_idx").on(table.providerType)
]);
// packages/nest/schema/src/global/node-network-config.ts
import { pgTable as pgTable22, text as text22, timestamp as timestamp22 } from "drizzle-orm/pg-core";
var nodeNetworkConfig = pgTable22("node_network_config", {
  nodeId: text22("node_id").primaryKey(),
  publicAddress: text22("public_address"),
  addressKind: text22("address_kind"),
  updatedAt: timestamp22("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date)
});
// packages/nest/schema/src/global/platform/app-instance.ts
import { relations as relations9 } from "drizzle-orm";
import { pgTable as pgTable23, text as text23, uuid as uuid16, timestamp as timestamp23, index as index14 } from "drizzle-orm/pg-core";
import z2 from "zod/v4";
var appInstances = pgTable23("app_instances", {
  id: uuid16("id").primaryKey().defaultRandom(),
  label: text23("label").notNull(),
  kind: text23("kind", { enum: ["managed", "external"] }).notNull().default("external"),
  tokenHash: text23("token_hash").notNull().unique(),
  status: text23("status", { enum: ["active", "stale", "revoked"] }).notNull().default("active"),
  createdByUserId: text23("created_by_user_id"),
  lastSeenAt: timestamp23("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp23("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp23("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index14("app_instances_status_idx").on(table.status)]);
var appInstancesRelations = relations9(appInstances, () => ({}));
var appInstanceKindSchema = z2.enum(["managed", "external"]);
var appInstanceStatusSchema = z2.enum(["active", "stale", "revoked"]);
var appInstanceEntitySchema = z2.object({
  id: z2.uuid(),
  label: z2.string().min(1),
  kind: appInstanceKindSchema,
  status: appInstanceStatusSchema,
  createdByUserId: z2.string().nullable(),
  lastSeenAt: z2.date(),
  createdAt: z2.date(),
  updatedAt: z2.date()
});
// packages/nest/schema/src/global/analytics.ts
import { index as index15, integer as integer13, jsonb as jsonb17, pgEnum as pgEnum9, pgTable as pgTable24, text as text24, timestamp as timestamp24, uuid as uuid17 } from "drizzle-orm/pg-core";
var analyticsReportStatusEnum = pgEnum9("analytics_report_status", [
  "pending",
  "generating",
  "completed",
  "failed"
]);
var analyticsReportFormatEnum = pgEnum9("analytics_report_format", [
  "json",
  "pdf",
  "csv"
]);
var analyticsReports = pgTable24("analytics_reports", {
  id: uuid17("id").primaryKey().defaultRandom(),
  name: text24("name").notNull(),
  status: analyticsReportStatusEnum("status").default("pending").notNull(),
  format: analyticsReportFormatEnum("format").default("json").notNull(),
  periodStart: timestamp24("period_start").notNull(),
  periodEnd: timestamp24("period_end").notNull(),
  sections: jsonb17("sections").$type().default([]),
  content: jsonb17("content").$type(),
  sizeBytes: integer13("size_bytes").default(0),
  errorMessage: text24("error_message"),
  generatedAt: timestamp24("generated_at"),
  createdAt: timestamp24("created_at").notNull().defaultNow(),
  updatedAt: timestamp24("updated_at").notNull().defaultNow()
}, (table) => [
  index15("analytics_reports_status_idx").on(table.status),
  index15("analytics_reports_period_start_idx").on(table.periodStart)
]);
var analyticsReportConfigScheduleEnum = pgEnum9("analytics_report_config_schedule", [
  "none",
  "daily",
  "weekly",
  "monthly"
]);
var analyticsReportConfigs = pgTable24("analytics_report_configs", {
  id: uuid17("id").primaryKey().defaultRandom(),
  name: text24("name").notNull(),
  description: text24("description"),
  metrics: jsonb17("metrics").$type().notNull(),
  filters: jsonb17("filters").$type(),
  schedule: analyticsReportConfigScheduleEnum("schedule").default("none").notNull(),
  recipients: jsonb17("recipients").$type().default([]),
  createdAt: timestamp24("created_at").notNull().defaultNow(),
  updatedAt: timestamp24("updated_at").notNull().defaultNow()
}, (table) => [
  index15("analytics_report_configs_schedule_idx").on(table.schedule)
]);
export {
  account,
  accountRelations,
  analyticsReportConfigScheduleEnum,
  analyticsReportConfigs,
  analyticsReportFormatEnum,
  analyticsReportStatusEnum,
  analyticsReports,
  apiKeys,
  apiKeysRelations,
  apikey,
  appConfig,
  appInstanceEntitySchema,
  appInstanceKindSchema,
  appInstanceStatusSchema,
  appInstances,
  appInstancesRelations,
  cacheStrategyEnum,
  clusterAdmissionRequestStatusEnum,
  clusterAdmissionRequests,
  clusterAdmissionRequestsRelations,
  clusterAllocationModeEnum,
  clusterJoinGrantStatusEnum,
  clusterJoinGrants,
  clusterJoinGrantsRelations,
  clusterMigrationState,
  clusterNodeMetrics,
  clusterNodeMetricsRelations,
  clusterNodeStatusEnum,
  clusterNodes,
  clusterNodesRelations,
  clusterServerAllocations,
  clusterServerAllocationsRelations,
  clusterSigningKeyStatusEnum,
  clusterSigningKeys,
  configFileSchema,
  configFiles,
  configFilesRelations,
  coreEventLogs,
  coreEventStreams,
  coreEventStreamsRelations,
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
  deploymentCache,
  deploymentCacheRelations,
  deploymentEnvironmentEnum,
  deploymentInsertSchema,
  deploymentLogs,
  deploymentLogsRelations,
  deploymentPhaseEnum,
  deploymentRollbacks,
  deploymentRollbacksRelations,
  deploymentRuleTriggerEnum,
  deploymentRules,
  deploymentRulesRelations,
  deploymentSelectSchema,
  deploymentStatusEnum,
  deploymentStrategyEnum,
  deploymentStreams,
  deploymentStreamsRelations,
  deploymentUpdateSchema,
  deployments,
  deploymentsRelations,
  deviceCode,
  dnsProviders,
  dockerImageLifecycleStateEnum,
  dockerImageSecurityLifecycle,
  dockerImageSecurityScanHistory,
  dockerImageSecurityScanStatusEnum,
  dockerImageSecurityScans,
  dockerRuntimeActivities,
  dockerRuntimeActivityCategoryEnum,
  dockerRuntimeActivitySeverityEnum,
  dockerRuntimeActivityStatusEnum,
  domainConfigSchema,
  domainConfigs,
  domainConfigsRelations,
  environmentAccessLogs,
  environmentKindEnum,
  environmentPromotions,
  environmentServices,
  environmentStatusEnum,
  environmentTemplates,
  environmentTypeEnum,
  environmentVariables,
  environments,
  githubApps,
  githubAppsRelations,
  githubDeploymentRules,
  githubDeploymentRulesRelations,
  githubInstallations,
  githubInstallationsRelations,
  githubPreviewDeployments,
  githubPreviewDeploymentsRelations,
  githubRepositories,
  githubRepositoriesRelations,
  githubRepositoryConfigs,
  githubRepositoryConfigsRelations,
  githubWebhookEvents,
  githubWebhookEventsRelations,
  gitlabApps,
  healthCheckJobs,
  healthChecks,
  healthChecksRelations,
  imageProjectMembership,
  localBuildCache,
  localEventOutbox,
  localJobStateEnum,
  localOutboxStateEnum,
  localQueueJobs,
  localRuntimeProcesses,
  logLevelEnum,
  nodeNetworkConfig,
  passkey,
  platformInvite,
  platformInviteRelations,
  previewDeploymentStatusEnum,
  previewEnvironments,
  previewEnvironmentsRelations,
  projectCollaboratorInsertSchema,
  projectCollaboratorSelectSchema,
  projectCollaboratorUpdateSchema,
  projectCollaborators,
  projectCollaboratorsRelations,
  projectDomains,
  projectDomainsRelations,
  projectInsertSchema,
  projectRoleEnum,
  projectScanConfig,
  projectSelectSchema,
  projectUpdateSchema,
  projects,
  projectsRelations,
  providerTraefikTemplateSchema,
  providerTraefikTemplates,
  providerTraefikTemplatesRelations,
  pushSubscription,
  pushSubscriptionRelations,
  resourceOwnershipIndex,
  resourceOwnershipIndexRelations,
  resourceOwnershipStatusEnum,
  roleRules,
  rollbackStatusEnum,
  routeConfigSchema,
  routeConfigs,
  routeConfigsRelations,
  schemaVersion,
  seedVersion,
  serviceConfigReferenceSchema,
  serviceConfigReferences,
  serviceConfigReferencesRelations,
  serviceDependencies,
  serviceDependenciesRelations,
  serviceDomainMappings,
  serviceDomainMappingsRelations,
  serviceEnvironments,
  serviceHealthConfigs,
  serviceHealthConfigsRelations,
  serviceInsertSchema,
  serviceProviderTypeEnum,
  serviceRunnerTypeEnum,
  serviceSelectSchema,
  serviceTraefikTemplateSchema,
  serviceTraefikTemplates,
  serviceTraefikTemplatesRelations,
  serviceTypeEnum,
  serviceUpdateSchema,
  services,
  servicesRelations,
  session,
  sessionRelations,
  sourceTypeEnum,
  sslProviderEnum,
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
  traefikStaticFilesRelations,
  twoFactor,
  user,
  userRelations,
  userVapidKeys,
  userVapidKeysRelations,
  variableResolutionStatusEnum,
  variableTemplates,
  verification,
  verificationMethodEnum,
  verificationStatusEnum,
  webhooks,
  webhooksRelations
};
