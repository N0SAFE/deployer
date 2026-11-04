/**
 * GitHub Deployment Cache Repository
 * 
 * PURPOSE: Database access layer for GitHub deployment cache
 * 
 * RESPONSIBILITIES:
 * - All database queries for deployment cache
 * - Raw data retrieval and persistence
 * - No business logic or transformations
 * 
 * PATTERN: Repository Pattern
 * - Encapsulates all data access for deployment cache
 * - Returns raw database entities
 * - Used by service layer
 */

import { Context, Effect } from 'effect';
import { eq, and, desc } from 'drizzle-orm';

import { deploymentCache } from '@deployer/nest-schema/global';

import { storage, type DatabasePort, type StorageFailure } from '../../../database/storage';
// Type inference from schema
type DeploymentCache = typeof deploymentCache.$inferSelect;
type DeploymentCacheInsert = typeof deploymentCache.$inferInsert;

type Ports = { readonly database: Context.Service.Shape<typeof DatabasePort> };

export type GithubDeploymentCacheRepositoryShape = {
  readonly create: (data: DeploymentCacheInsert) => Effect.Effect<DeploymentCache, StorageFailure>;
  readonly findLatestByBranch: (projectId: string, repositoryId: string, branch: string) => Effect.Effect<DeploymentCache | null, StorageFailure>;
  readonly findByCommitSha: (projectId: string, repositoryId: string, commitSha: string) => Effect.Effect<DeploymentCache | null, StorageFailure>;
  readonly findByProjectId: (projectId: string) => Effect.Effect<DeploymentCache[], StorageFailure>;
  readonly findByRepository: (projectId: string, repositoryId: string) => Effect.Effect<DeploymentCache[], StorageFailure>;
  readonly updateDeploymentId: (id: string, deploymentId: string) => Effect.Effect<DeploymentCache | null, StorageFailure>;
  readonly delete: (id: string) => Effect.Effect<boolean, StorageFailure>;
  readonly deleteByBranch: (projectId: string, repositoryId: string, branch: string) => Effect.Effect<number, StorageFailure>;
  readonly deleteMany: (ids: string[]) => Effect.Effect<number, StorageFailure>;
};

export function makeGithubDeploymentCacheRepository({ database }: Ports): GithubDeploymentCacheRepositoryShape {
  return {
  /**
   * Create a new cache entry
   */
    create: (data: DeploymentCacheInsert) =>
      Effect.logInfo(`Creating cache entry for ${data.repositoryId}@${data.branch} - ${data.commitSha}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    const [entry] = await db
          .insert(deploymentCache)
          .values(data)
          .returning();

        if (!entry) {
          throw new Error('Failed to create deployment cache entry');
        }

        return entry;
  
      }),
      )),

  /**
   * Find the latest cache entry for a branch
   */
    findLatestByBranch: (projectId: string, repositoryId: string, branch: string) =>
      Effect.logDebug(`Finding latest cache entry for ${repositoryId}@${branch}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    const [entry] = await db
          .select()
          .from(deploymentCache)
          .where(
            and(
              eq(deploymentCache.projectId, projectId),
              eq(deploymentCache.repositoryId, repositoryId),
              eq(deploymentCache.branch, branch)
            )
          )
          .orderBy(desc(deploymentCache.createdAt))
          .limit(1);

        return entry ?? null;
  
      }),
      )),

  /**
   * Find cache entry by commit SHA
   */
    findByCommitSha: (projectId: string, repositoryId: string, commitSha: string) =>
      Effect.logDebug(`Finding cache entry for commit: ${commitSha}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    const [entry] = await db
          .select()
          .from(deploymentCache)
          .where(
            and(
              eq(deploymentCache.projectId, projectId),
              eq(deploymentCache.repositoryId, repositoryId),
              eq(deploymentCache.commitSha, commitSha)
            )
          )
          .limit(1);

        return entry ?? null;
  
      }),
      )),

  /**
   * Find all cache entries for a project
   */
    findByProjectId: (projectId: string) =>
      Effect.logDebug(`Finding cache entries for project: ${projectId}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    return await db
          .select()
          .from(deploymentCache)
          .where(eq(deploymentCache.projectId, projectId))
          .orderBy(desc(deploymentCache.createdAt));
  
      }),
      )),

  /**
   * Find all cache entries for a repository
   */
    findByRepository: (projectId: string, repositoryId: string) =>
      Effect.logDebug(`Finding cache entries for repository: ${repositoryId}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    return await db
          .select()
          .from(deploymentCache)
          .where(
            and(
              eq(deploymentCache.projectId, projectId),
              eq(deploymentCache.repositoryId, repositoryId)
            )
          )
          .orderBy(desc(deploymentCache.createdAt));
  
      }),
      )),

  /**
   * Update cache entry with deployment ID
   */
    updateDeploymentId: (id: string, deploymentId: string) =>
      Effect.logInfo(`Updating cache entry ${id} with deployment ${deploymentId}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    const [entry] = await db
          .update(deploymentCache)
          .set({ deploymentId })
          .where(eq(deploymentCache.id, id))
          .returning();

        return entry ?? null;
  
      }),
      )),

  /**
   * Delete a cache entry
   */
    delete: (id: string) =>
      Effect.logInfo(`Deleting cache entry: ${id}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    const result = await db
          .delete(deploymentCache)
          .where(eq(deploymentCache.id, id));

        return result.rowCount ? result.rowCount > 0 : false;
  
      }),
      )),

  /**
   * Delete all cache entries for a branch
   */
    deleteByBranch: (projectId: string, repositoryId: string, branch: string) =>
      Effect.logInfo(`Deleting cache entries for ${repositoryId}@${branch}`).pipe(Effect.andThen(
        storage(database, async (db) => {
    const result = await db
          .delete(deploymentCache)
          .where(
            and(
              eq(deploymentCache.projectId, projectId),
              eq(deploymentCache.repositoryId, repositoryId),
              eq(deploymentCache.branch, branch)
            )
          );

        return result.rowCount ?? 0;
  
      }),
      )),

  /**
   * Delete multiple cache entries by IDs
   */
    deleteMany: (ids: string[]) =>
      Effect.logInfo(`Deleting ${String(ids.length)} cache entries`).pipe(Effect.andThen(
        storage(database, async (db) => {
    let deletedCount = 0;
        for (const id of ids) {
          const result = await db
            .delete(deploymentCache)
            .where(eq(deploymentCache.id, id));
      
          if (result.rowCount) {
            deletedCount += result.rowCount;
          }
        }

        return deletedCount;
  
      }),
      )),
  };
}

export class GithubDeploymentCacheRepository extends Context.Service<GithubDeploymentCacheRepository, GithubDeploymentCacheRepositoryShape>()("shared/GithubDeploymentCacheRepository") {}
