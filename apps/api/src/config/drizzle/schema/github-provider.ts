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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { encryptedText } from '@/config/drizzle/custom-types/encrypted-text';
import { projects } from './deployment';

// Enums for GitHub provider
export const deploymentStrategyEnum = pgEnum('deployment_strategy', [
  'standard',
  'blue-green',
  'canary',
  'rolling',
  'custom',
]);

export const cacheStrategyEnum = pgEnum('cache_strategy', ['strict', 'loose']);

export const previewDeploymentStatusEnum = pgEnum('preview_deployment_status', [
  'pending',
  'building',
  'deploying',
  'active',
  'failed',
  'deleted',
]);

// GitHub Apps Table - Multiple GitHub app support per organization
export const githubApps = pgTable(
  'github_apps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(), // Reference to organization (not enforced with FK)
    name: text('name').notNull(),
    appId: text('app_id').notNull(),
    clientId: text('client_id').notNull(),
    clientSecret: encryptedText('client_secret').notNull(),
    privateKey: encryptedText('private_key').notNull(),
    webhookSecret: encryptedText('webhook_secret').notNull(),
    installationId: text('installation_id'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    orgIdIdx: index('github_apps_org_id_idx').on(table.organizationId),
    appIdIdx: index('github_apps_app_id_idx').on(table.appId),
  }),
);

// GitHub Repository Configs Table - Heavy configuration for each repository
export const githubRepositoryConfigs = pgTable(
  'github_repository_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    githubAppId: uuid('github_app_id')
      .notNull()
      .references(() => githubApps.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id').notNull(),
    repositoryFullName: text('repository_full_name').notNull(),

    // Monorepo Support
    basePath: text('base_path').default('/'),
    watchPaths: jsonb('watch_paths')
      .$type<string[]>()
      .default([]),
    ignorePaths: jsonb('ignore_paths')
      .$type<string[]>()
      .default([]),

    // Cache Strategy
    cacheStrategy: cacheStrategyEnum('cache_strategy').notNull().default('strict'),

    // Deployment Configuration
    autoDeployEnabled: boolean('auto_deploy_enabled').notNull().default(true),
    deploymentStrategy: deploymentStrategyEnum('deployment_strategy')
      .notNull()
      .default('standard'),
    customStrategyScript: text('custom_strategy_script'),

    // Preview Deployments
    previewDeploymentsEnabled: boolean('preview_deployments_enabled')
      .notNull()
      .default(false),
    previewBranchPattern: text('preview_branch_pattern').default('*'),
    previewAutoDelete: boolean('preview_auto_delete').notNull().default(true),
    previewAutoDeleteAfterDays: integer('preview_auto_delete_after_days').default(7),

    createdAt: timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    projectIdIdx: index('github_repo_configs_project_id_idx').on(table.projectId),
    githubAppIdIdx: index('github_repo_configs_github_app_id_idx').on(table.githubAppId),
    repoIdIdx: index('github_repo_configs_repo_id_idx').on(table.repositoryId),
  }),
);

// Enhanced Deployment Rules Table - Extends existing deployment rules
export const githubDeploymentRules = pgTable(
  'github_deployment_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    priority: integer('priority').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),

    // Trigger Configuration
    event: text('event').notNull(), // 'push', 'pull_request', 'tag', etc.
    branchPattern: text('branch_pattern'),
    tagPattern: text('tag_pattern'),

    // Path-based Conditions
    pathConditions: jsonb('path_conditions').$type<{
      include?: string[];
      exclude?: string[];
      requireAll?: boolean;
    }>(),

    // Custom Conditions (JS expression)
    customCondition: text('custom_condition'),

    // Action
    action: text('action').notNull(), // 'deploy', 'preview', 'skip'
    deploymentStrategy: deploymentStrategyEnum('deployment_strategy'),
    customStrategyScript: text('custom_strategy_script'),

    // Override cache behavior
    bypassCache: boolean('bypass_cache').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    projectIdIdx: index('github_deployment_rules_project_id_idx').on(table.projectId),
    priorityIdx: index('github_deployment_rules_priority_idx').on(table.priority),
  }),
);

// Deployment Cache Table
export const deploymentCache = pgTable(
  'deployment_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id').notNull(),
    branch: text('branch').notNull(),

    // Commit Information
    commitSha: text('commit_sha').notNull(),
    commitMessage: text('commit_message'),
    commitAuthor: text('commit_author'),
    commitDate: timestamp('commit_date', { withTimezone: true }),

    // Changed Files (for loose strategy)
    changedFiles: jsonb('changed_files').$type<string[]>().notNull(),

    // Deployment Reference
    deploymentId: uuid('deployment_id'),

    // Metadata
    basePath: text('base_path').default('/'),
    cacheStrategy: cacheStrategyEnum('cache_strategy').notNull().default('strict'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    projectIdIdx: index('deployment_cache_project_id_idx').on(table.projectId),
    repoIdIdx: index('deployment_cache_repo_id_idx').on(table.repositoryId),
    branchIdx: index('deployment_cache_branch_idx').on(table.branch),
    commitShaIdx: index('deployment_cache_commit_sha_idx').on(table.commitSha),
  }),
);

// Preview Deployment Configs Table
export const githubPreviewDeployments = pgTable(
  'github_preview_deployments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id').notNull(),
    prNumber: integer('pr_number').notNull(),
    branch: text('branch').notNull(),

    // Deployment Info
    deploymentId: uuid('deployment_id'),
    serviceName: text('service_name').notNull(),
    url: text('url'),

    // Status
    status: previewDeploymentStatusEnum('status').notNull().default('pending'),

    // Lifecycle
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    autoDeleteAt: timestamp('auto_delete_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    projectIdIdx: index('github_preview_deployments_project_id_idx').on(table.projectId),
    repoIdIdx: index('github_preview_deployments_repo_id_idx').on(table.repositoryId),
    prNumberIdx: index('github_preview_deployments_pr_number_idx').on(table.prNumber),
    statusIdx: index('github_preview_deployments_status_idx').on(table.status),
  }),
);

// GitHub Webhook Events Table
export const githubWebhookEvents = pgTable(
  'github_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    githubAppId: uuid('github_app_id')
      .notNull()
      .references(() => githubApps.id, { onDelete: 'cascade' }),

    // Event Details
    event: text('event').notNull(),
    deliveryId: text('delivery_id').notNull(),
    payload: jsonb('payload').notNull(),

    // Processing Status
    processed: boolean('processed').notNull().default(false),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    githubAppIdIdx: index('github_webhook_events_app_id_idx').on(table.githubAppId),
    deliveryIdIdx: index('github_webhook_events_delivery_id_idx').on(table.deliveryId),
    processedIdx: index('github_webhook_events_processed_idx').on(table.processed),
  }),
);

// Relations
export const githubAppsRelations = relations(githubApps, ({ many }) => ({
  repositoryConfigs: many(githubRepositoryConfigs),
  webhookEvents: many(githubWebhookEvents),
}));

export const githubRepositoryConfigsRelations = relations(
  githubRepositoryConfigs,
  ({ one }) => ({
    project: one(projects, {
      fields: [githubRepositoryConfigs.projectId],
      references: [projects.id],
    }),
    githubApp: one(githubApps, {
      fields: [githubRepositoryConfigs.githubAppId],
      references: [githubApps.id],
    }),
    // Note: deploymentRules, deploymentCache, and previewDeployments are associated
    // with projects (via projectId), not directly with repository configs.
    // They can be filtered by repositoryId (text field) but there's no FK relationship.
    // Access deployment rules via: config.project (projects have deploymentRules relation)
    // Filter cache/previews by repositoryId in queries when needed
  }),
);

export const githubDeploymentRulesRelations = relations(githubDeploymentRules, ({ one }) => ({
  project: one(projects, {
    fields: [githubDeploymentRules.projectId],
    references: [projects.id],
  }),
}));

export const deploymentCacheRelations = relations(deploymentCache, ({ one }) => ({
  project: one(projects, {
    fields: [deploymentCache.projectId],
    references: [projects.id],
  }),
}));

export const githubPreviewDeploymentsRelations = relations(
  githubPreviewDeployments,
  ({ one }) => ({
    project: one(projects, {
      fields: [githubPreviewDeployments.projectId],
      references: [projects.id],
    }),
  }),
);

export const githubWebhookEventsRelations = relations(githubWebhookEvents, ({ one }) => ({
  githubApp: one(githubApps, {
    fields: [githubWebhookEvents.githubAppId],
    references: [githubApps.id],
  }),
}));
