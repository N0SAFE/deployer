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

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { deploymentCache } from '@/config/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

// Type inference from schema
type DeploymentCache = typeof deploymentCache.$inferSelect;
type DeploymentCacheInsert = typeof deploymentCache.$inferInsert;

@Injectable()
export class GithubDeploymentCacheRepository {
  private readonly logger = new Logger(GithubDeploymentCacheRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Create a new cache entry
   */
  async create(data: DeploymentCacheInsert): Promise<DeploymentCache> {
    this.logger.log(`Creating cache entry for ${data.repositoryId}@${data.branch} - ${data.commitSha}`);
    
    const [entry] = await this.databaseService.db
      .insert(deploymentCache)
      .values(data)
      .returning();

    if (!entry) {
      throw new Error('Failed to create deployment cache entry');
    }

    return entry;
  }

  /**
   * Find the latest cache entry for a branch
   */
  async findLatestByBranch(
    projectId: string,
    repositoryId: string,
    branch: string
  ): Promise<DeploymentCache | null> {
    this.logger.debug(`Finding latest cache entry for ${repositoryId}@${branch}`);
    
    const [entry] = await this.databaseService.db
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

    return entry || null;
  }

  /**
   * Find cache entry by commit SHA
   */
  async findByCommitSha(
    projectId: string,
    repositoryId: string,
    commitSha: string
  ): Promise<DeploymentCache | null> {
    this.logger.debug(`Finding cache entry for commit: ${commitSha}`);
    
    const [entry] = await this.databaseService.db
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

    return entry || null;
  }

  /**
   * Find all cache entries for a project
   */
  async findByProjectId(projectId: string): Promise<DeploymentCache[]> {
    this.logger.debug(`Finding cache entries for project: ${projectId}`);
    
    return await this.databaseService.db
      .select()
      .from(deploymentCache)
      .where(eq(deploymentCache.projectId, projectId))
      .orderBy(desc(deploymentCache.createdAt));
  }

  /**
   * Find all cache entries for a repository
   */
  async findByRepository(
    projectId: string,
    repositoryId: string
  ): Promise<DeploymentCache[]> {
    this.logger.debug(`Finding cache entries for repository: ${repositoryId}`);
    
    return await this.databaseService.db
      .select()
      .from(deploymentCache)
      .where(
        and(
          eq(deploymentCache.projectId, projectId),
          eq(deploymentCache.repositoryId, repositoryId)
        )
      )
      .orderBy(desc(deploymentCache.createdAt));
  }

  /**
   * Update cache entry with deployment ID
   */
  async updateDeploymentId(
    id: string,
    deploymentId: string
  ): Promise<DeploymentCache | null> {
    this.logger.log(`Updating cache entry ${id} with deployment ${deploymentId}`);
    
    const [entry] = await this.databaseService.db
      .update(deploymentCache)
      .set({ deploymentId })
      .where(eq(deploymentCache.id, id))
      .returning();

    return entry || null;
  }

  /**
   * Delete a cache entry
   */
  async delete(id: string): Promise<boolean> {
    this.logger.log(`Deleting cache entry: ${id}`);
    
    const result = await this.databaseService.db
      .delete(deploymentCache)
      .where(eq(deploymentCache.id, id));

    return result.rowCount ? result.rowCount > 0 : false;
  }

  /**
   * Delete all cache entries for a branch
   */
  async deleteByBranch(
    projectId: string,
    repositoryId: string,
    branch: string
  ): Promise<number> {
    this.logger.log(`Deleting cache entries for ${repositoryId}@${branch}`);
    
    const result = await this.databaseService.db
      .delete(deploymentCache)
      .where(
        and(
          eq(deploymentCache.projectId, projectId),
          eq(deploymentCache.repositoryId, repositoryId),
          eq(deploymentCache.branch, branch)
        )
      );

    return result.rowCount || 0;
  }

  /**
   * Delete multiple cache entries by IDs
   */
  async deleteMany(ids: string[]): Promise<number> {
    this.logger.log(`Deleting ${ids.length} cache entries`);
    
    let deletedCount = 0;
    for (const id of ids) {
      const result = await this.databaseService.db
        .delete(deploymentCache)
        .where(eq(deploymentCache.id, id));
      
      if (result.rowCount) {
        deletedCount += result.rowCount;
      }
    }

    return deletedCount;
  }
}
