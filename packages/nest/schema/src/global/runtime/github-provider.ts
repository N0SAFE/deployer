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
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { encryptedText } from '@deployer/nest-schema/codecs/codec-registry';
import { projects } from "@deployer/nest-schema/global/project/deployment";
import {
  cacheStrategySchema,
  githubDeploymentStrategySchema,
  previewDeploymentStatusSchema,
} from '@deployer/contracts-common';
import { zodEnumToPgEnumValues } from "@deployer/nest-schema/global/utils/zod-enum";
import { cacheStrategyEnum } from "@deployer/nest-schema/global/platform/github-provider";

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
  (table) => [
    index('deployment_cache_project_id_idx').on(table.projectId),
    index('deployment_cache_repo_id_idx').on(table.repositoryId),
    index('deployment_cache_branch_idx').on(table.branch),
    index('deployment_cache_commit_sha_idx').on(table.commitSha),
  ],
);



export const deploymentCacheRelations = relations(deploymentCache, ({ one }) => ({
  project: one(projects, {
    fields: [deploymentCache.projectId],
    references: [projects.id],
  }),
}));
