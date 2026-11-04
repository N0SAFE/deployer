/**
 * GitHub Deployment Rules Repository
 * 
 * PURPOSE: Database access layer for GitHub deployment rules
 * 
 * RESPONSIBILITIES:
 * - All database queries for GitHub-specific deployment rules
 * - Raw data retrieval and persistence
 * - No business logic or transformations
 * 
 * PATTERN: Repository Pattern
 * - Encapsulates all data access for GitHub deployment rules
 * - Returns raw database entities
 * - Used by service layer
 */

import { Context, Effect } from 'effect';
import { eq, and, desc } from 'drizzle-orm';

import { githubDeploymentRules } from "@deployer/nest-schema/global/fleet/github-provider";

import { storage, type DatabasePort, type StorageFailure } from '../../../database/storage';
// Type inference from schema
type GithubDeploymentRule = typeof githubDeploymentRules.$inferSelect;
type GithubDeploymentRuleInsert = typeof githubDeploymentRules.$inferInsert;

type Ports = { readonly database: Context.Service.Shape<typeof DatabasePort> };

export type GithubDeploymentRulesRepositoryShape = {
  readonly findById: (id: string) => Effect.Effect<GithubDeploymentRule | null, StorageFailure>;
  readonly findByProjectAndEvent: (projectId: string, event: string) => Effect.Effect<GithubDeploymentRule[], StorageFailure>;
  readonly findByProjectId: (projectId: string) => Effect.Effect<GithubDeploymentRule[], StorageFailure>;
  readonly findActiveByProjectId: (projectId: string) => Effect.Effect<GithubDeploymentRule[], StorageFailure>;
  readonly create: (data: GithubDeploymentRuleInsert) => Effect.Effect<GithubDeploymentRule, StorageFailure>;
  readonly update: (id: string, data: Partial<GithubDeploymentRuleInsert>) => Effect.Effect<GithubDeploymentRule | null, StorageFailure>;
  readonly delete: (id: string) => Effect.Effect<boolean, StorageFailure>;
};

export function makeGithubDeploymentRulesRepository({ database }: Ports): GithubDeploymentRulesRepositoryShape {
  return {
  /**
   * Find a GitHub deployment rule by ID
   */
    findById: (id: string) =>
      Effect.logDebug(`Finding GitHub deployment rule by ID: ${id}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    const [rule] = await db
          .select()
          .from(githubDeploymentRules)
          .where(eq(githubDeploymentRules.id, id))
          .limit(1);

        return rule ?? null;
  
      }),
      )),

  /**
   * Find rules by project ID and event
   */
    findByProjectAndEvent: (projectId: string, event: string) =>
      Effect.logDebug(`Finding GitHub deployment rules for project ${projectId} and event ${event}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    return await db
          .select()
          .from(githubDeploymentRules)
          .where(
            and(
              eq(githubDeploymentRules.projectId, projectId),
              eq(githubDeploymentRules.event, event)
            )
          );
  
      }),
      )),

  /**
   * Find all rules for a project
   */
    findByProjectId: (projectId: string) =>
      Effect.logDebug(`Finding all GitHub deployment rules for project: ${projectId}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    return await db
          .select()
          .from(githubDeploymentRules)
          .where(eq(githubDeploymentRules.projectId, projectId))
          .orderBy(desc(githubDeploymentRules.priority));
  
      }),
      )),

  /**
   * Find active rules for a project (ordered by priority)
   */
    findActiveByProjectId: (projectId: string) =>
      Effect.logDebug(`Finding active GitHub deployment rules for project: ${projectId}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    return await db
          .select()
          .from(githubDeploymentRules)
          .where(
            and(
              eq(githubDeploymentRules.projectId, projectId),
              eq(githubDeploymentRules.isActive, true),
            ),
          )
          .orderBy(desc(githubDeploymentRules.priority));
  
      }),
      )),

  /**
   * Create a new GitHub deployment rule
   */
    create: (data: GithubDeploymentRuleInsert) =>
      Effect.logInfo(`Creating GitHub deployment rule: ${data.name}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    const [rule] = await db
          .insert(githubDeploymentRules)
          .values(data)
          .returning();

        if (!rule) {
          throw new Error('Failed to create GitHub deployment rule');
        }

        return rule;
  
      }),
      )),

  /**
   * Update a GitHub deployment rule
   */
    update: (id: string, data: Partial<GithubDeploymentRuleInsert>) =>
      Effect.logInfo(`Updating GitHub deployment rule: ${id}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    const [rule] = await db
          .update(githubDeploymentRules)
          .set({
            ...data,
            updatedAt: new Date(),
          })
          .where(eq(githubDeploymentRules.id, id))
          .returning();

        return rule ?? null;
  
      }),
      )),

  /**
   * Delete a GitHub deployment rule
   */
    delete: (id: string) =>
      Effect.logInfo(`Deleting GitHub deployment rule: ${id}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    const result = await db
          .delete(githubDeploymentRules)
          .where(eq(githubDeploymentRules.id, id));

        return result.rowCount ? result.rowCount > 0 : false;
  
      }),
      )),
  };
}

export class GithubDeploymentRulesRepository extends Context.Service<GithubDeploymentRulesRepository, GithubDeploymentRulesRepositoryShape>()("shared/GithubDeploymentRulesRepository") {}
