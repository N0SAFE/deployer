import {
  zodEnumToPgEnumValues2
} from "./migrations-trk55dxz.mjs";
import {
  projects2
} from "./migrations-r9ccee18.mjs";

// packages/nest/schema/src/global/github-provider.ts
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  jsonb,
  pgEnum,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { encryptedText } from "@deployer/nest-schema/codecs/codec-registry";
import {
  cacheStrategySchema,
  githubDeploymentStrategySchema,
  previewDeploymentStatusSchema
} from "@deployer/contracts-common";
var deploymentStrategyEnum2 = pgEnum("deployment_strategy", [
  ...zodEnumToPgEnumValues2(githubDeploymentStrategySchema)
]);
var cacheStrategyEnum2 = pgEnum("cache_strategy", [...zodEnumToPgEnumValues2(cacheStrategySchema)]);
var previewDeploymentStatusEnum2 = pgEnum("preview_deployment_status", [
  ...zodEnumToPgEnumValues2(previewDeploymentStatusSchema)
]);
var githubApps2 = pgTable("github_apps", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  appId: text("app_id").notNull(),
  clientId: text("client_id").notNull(),
  clientSecret: encryptedText("client_secret").notNull(),
  privateKey: encryptedText("private_key").notNull(),
  webhookSecret: encryptedText("webhook_secret").notNull(),
  installationId: text("installation_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date).notNull()
}, (table) => [
  index("github_apps_app_id_idx").on(table.appId)
]);
var githubRepositoryConfigs2 = pgTable("github_repository_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects2.id, { onDelete: "cascade" }),
  githubAppId: uuid("github_app_id").notNull().references(() => githubApps2.id, { onDelete: "cascade" }),
  repositoryId: text("repository_id").notNull(),
  repositoryFullName: text("repository_full_name").notNull(),
  basePath: text("base_path").default("/"),
  watchPaths: jsonb("watch_paths").$type().default([]),
  ignorePaths: jsonb("ignore_paths").$type().default([]),
  cacheStrategy: cacheStrategyEnum2("cache_strategy").notNull().default("strict"),
  autoDeployEnabled: boolean("auto_deploy_enabled").notNull().default(true),
  deploymentStrategy: deploymentStrategyEnum2("deployment_strategy").notNull().default("standard"),
  customStrategyScript: text("custom_strategy_script"),
  previewDeploymentsEnabled: boolean("preview_deployments_enabled").notNull().default(false),
  previewBranchPattern: text("preview_branch_pattern").default("*"),
  previewAutoDelete: boolean("preview_auto_delete").notNull().default(true),
  previewAutoDeleteAfterDays: integer("preview_auto_delete_after_days").default(7),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date).notNull()
}, (table) => [
  index("github_repo_configs_project_id_idx").on(table.projectId),
  index("github_repo_configs_github_app_id_idx").on(table.githubAppId),
  index("github_repo_configs_repo_id_idx").on(table.repositoryId)
]);
var githubDeploymentRules2 = pgTable("github_deployment_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects2.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  priority: integer("priority").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  event: text("event").notNull(),
  branchPattern: text("branch_pattern"),
  tagPattern: text("tag_pattern"),
  pathConditions: jsonb("path_conditions").$type(),
  customCondition: text("custom_condition"),
  action: text("action").notNull(),
  deploymentStrategy: deploymentStrategyEnum2("deployment_strategy"),
  customStrategyScript: text("custom_strategy_script"),
  bypassCache: boolean("bypass_cache").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date).notNull()
}, (table) => [
  index("github_deployment_rules_project_id_idx").on(table.projectId),
  index("github_deployment_rules_priority_idx").on(table.priority)
]);
var deploymentCache2 = pgTable("deployment_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects2.id, { onDelete: "cascade" }),
  repositoryId: text("repository_id").notNull(),
  branch: text("branch").notNull(),
  commitSha: text("commit_sha").notNull(),
  commitMessage: text("commit_message"),
  commitAuthor: text("commit_author"),
  commitDate: timestamp("commit_date", { withTimezone: true }),
  changedFiles: jsonb("changed_files").$type().notNull(),
  deploymentId: uuid("deployment_id"),
  basePath: text("base_path").default("/"),
  cacheStrategy: cacheStrategyEnum2("cache_strategy").notNull().default("strict"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date).notNull()
}, (table) => [
  index("deployment_cache_project_id_idx").on(table.projectId),
  index("deployment_cache_repo_id_idx").on(table.repositoryId),
  index("deployment_cache_branch_idx").on(table.branch),
  index("deployment_cache_commit_sha_idx").on(table.commitSha)
]);
var githubPreviewDeployments2 = pgTable("github_preview_deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects2.id, { onDelete: "cascade" }),
  repositoryId: text("repository_id").notNull(),
  prNumber: integer("pr_number").notNull(),
  branch: text("branch").notNull(),
  deploymentId: uuid("deployment_id"),
  serviceName: text("service_name").notNull(),
  url: text("url"),
  status: previewDeploymentStatusEnum2("status").notNull().default("pending"),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).$defaultFn(() => new Date).notNull(),
  autoDeleteAt: timestamp("auto_delete_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(() => new Date).notNull()
}, (table) => [
  index("github_preview_deployments_project_id_idx").on(table.projectId),
  index("github_preview_deployments_repo_id_idx").on(table.repositoryId),
  index("github_preview_deployments_pr_number_idx").on(table.prNumber),
  index("github_preview_deployments_status_idx").on(table.status)
]);
var githubWebhookEvents2 = pgTable("github_webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubAppId: uuid("github_app_id").references(() => githubApps2.id, {
    onDelete: "cascade"
  }),
  event: text("event").notNull(),
  deliveryId: text("delivery_id").notNull(),
  payload: jsonb("payload").notNull(),
  processed: boolean("processed").notNull().default(false),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(() => new Date).notNull()
}, (table) => [
  uniqueIndex("github_webhook_events_delivery_id_uniq_idx").on(table.deliveryId),
  index("github_webhook_events_app_id_idx").on(table.githubAppId),
  index("github_webhook_events_processed_idx").on(table.processed)
]);
var githubAppsRelations2 = relations(githubApps2, ({ many }) => ({
  repositoryConfigs: many(githubRepositoryConfigs2),
  webhookEvents: many(githubWebhookEvents2)
}));
var githubRepositoryConfigsRelations2 = relations(githubRepositoryConfigs2, ({ one }) => ({
  project: one(projects2, {
    fields: [githubRepositoryConfigs2.projectId],
    references: [projects2.id]
  }),
  githubApp: one(githubApps2, {
    fields: [githubRepositoryConfigs2.githubAppId],
    references: [githubApps2.id]
  })
}));
var githubDeploymentRulesRelations2 = relations(githubDeploymentRules2, ({ one }) => ({
  project: one(projects2, {
    fields: [githubDeploymentRules2.projectId],
    references: [projects2.id]
  })
}));
var deploymentCacheRelations2 = relations(deploymentCache2, ({ one }) => ({
  project: one(projects2, {
    fields: [deploymentCache2.projectId],
    references: [projects2.id]
  })
}));
var githubPreviewDeploymentsRelations2 = relations(githubPreviewDeployments2, ({ one }) => ({
  project: one(projects2, {
    fields: [githubPreviewDeployments2.projectId],
    references: [projects2.id]
  })
}));
var githubWebhookEventsRelations2 = relations(githubWebhookEvents2, ({ one }) => ({
  githubApp: one(githubApps2, {
    fields: [githubWebhookEvents2.githubAppId],
    references: [githubApps2.id]
  })
}));

export { deploymentStrategyEnum2, cacheStrategyEnum2, previewDeploymentStatusEnum2, githubApps2, githubRepositoryConfigs2, githubDeploymentRules2, deploymentCache2, githubPreviewDeployments2, githubWebhookEvents2, githubAppsRelations2, githubRepositoryConfigsRelations2, githubDeploymentRulesRelations2, deploymentCacheRelations2, githubPreviewDeploymentsRelations2, githubWebhookEventsRelations2 };
