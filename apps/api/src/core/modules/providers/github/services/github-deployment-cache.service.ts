import { Injectable, Logger } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { deploymentCache } from '@/config/drizzle/schema';

export interface CacheEntry {
  id: string;
  projectId: string;
  repositoryId: string;
  branch: string;
  commitSha: string;
  commitMessage: string | null;
  commitAuthor: string | null;
  commitDate: Date | null;
  changedFiles: string[];
  deploymentId: string | null;
  basePath: string;
  cacheStrategy: 'strict' | 'loose';
  createdAt: Date;
}

export interface CreateCacheEntryInput {
  projectId: string;
  repositoryId: string;
  branch: string;
  commitSha: string;
  commitMessage?: string;
  commitAuthor?: string;
  commitDate?: Date;
  changedFiles: string[];
  deploymentId?: string;
  basePath?: string;
  cacheStrategy?: 'strict' | 'loose';
}

@Injectable()
export class GithubDeploymentCacheService {
  private readonly logger = new Logger(GithubDeploymentCacheService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Create a cache entry for a deployment
   */
  async createCacheEntry(input: CreateCacheEntryInput): Promise<CacheEntry> {
    this.logger.log(
      `Creating cache entry for ${input.repositoryId}@${input.branch} - ${input.commitSha}`,
    );

    const [entry] = await this.databaseService.db
      .insert(deploymentCache)
      .values({
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        branch: input.branch,
        commitSha: input.commitSha,
        commitMessage: input.commitMessage || null,
        commitAuthor: input.commitAuthor || null,
        commitDate: input.commitDate || null,
        changedFiles: input.changedFiles,
        deploymentId: input.deploymentId || null,
        basePath: input.basePath || '/',
        cacheStrategy: input.cacheStrategy || 'strict',
        createdAt: new Date(),
      })
      .returning();

    return entry as CacheEntry;
  }

  /**
   * Get the latest cache entry for a branch
   */
  async getLatestCacheEntry(
    projectId: string,
    repositoryId: string,
    branch: string,
  ): Promise<CacheEntry | null> {
    const [entry] = await this.databaseService.db
      .select()
      .from(deploymentCache)
      .where(
        and(
          eq(deploymentCache.projectId, projectId),
          eq(deploymentCache.repositoryId, repositoryId),
          eq(deploymentCache.branch, branch),
        ),
      )
      .orderBy(desc(deploymentCache.createdAt))
      .limit(1);

    return (entry as CacheEntry) || null;
  }

  /**
   * Get cache entry by commit SHA
   */
  async getCacheEntryByCommit(
    projectId: string,
    repositoryId: string,
    commitSha: string,
  ): Promise<CacheEntry | null> {
    const [entry] = await this.databaseService.db
      .select()
      .from(deploymentCache)
      .where(
        and(
          eq(deploymentCache.projectId, projectId),
          eq(deploymentCache.repositoryId, repositoryId),
          eq(deploymentCache.commitSha, commitSha),
        ),
      );

    return (entry as CacheEntry) || null;
  }

  /**
   * Check if deployment should be skipped based on cache
   * 
   * Strict strategy: Skip if commit SHA already deployed
   * Loose strategy: Skip if no watched files changed compared to last deployment
   */
  async shouldSkipDeployment(
    projectId: string,
    repositoryId: string,
    branch: string,
    commitSha: string,
    changedFiles: string[],
    watchedFiles: string[],
    cacheStrategy: 'strict' | 'loose',
  ): Promise<{ shouldSkip: boolean; reason: string; cachedEntry?: CacheEntry }> {
    // Get latest cache entry for this branch
    const latestCache = await this.getLatestCacheEntry(projectId, repositoryId, branch);

    if (!latestCache) {
      return {
        shouldSkip: false,
        reason: 'No previous deployment found',
      };
    }

    // Strict strategy: Skip if exact commit already deployed
    if (cacheStrategy === 'strict') {
      if (latestCache.commitSha === commitSha) {
        return {
          shouldSkip: true,
          reason: `Commit ${commitSha} already deployed`,
          cachedEntry: latestCache,
        };
      }

      return {
        shouldSkip: false,
        reason: 'New commit detected',
        cachedEntry: latestCache,
      };
    }

    // Loose strategy: Check if any watched files changed compared to cached files
    if (cacheStrategy === 'loose') {
      const cachedWatchedFiles = latestCache.changedFiles;
      const newWatchedFiles = watchedFiles;

      // Check if there are any new watched files that weren't in the last deployment
      const hasNewChanges = newWatchedFiles.some(
        (file) => !cachedWatchedFiles.includes(file),
      );

      if (!hasNewChanges && newWatchedFiles.length > 0) {
        return {
          shouldSkip: true,
          reason: 'No new watched files changed since last deployment',
          cachedEntry: latestCache,
        };
      }

      return {
        shouldSkip: false,
        reason: hasNewChanges
          ? 'New watched files detected'
          : 'First deployment or all watched files changed',
        cachedEntry: latestCache,
      };
    }

    return {
      shouldSkip: false,
      reason: 'Unknown cache strategy',
    };
  }

  /**
   * Update cache entry with deployment ID
   */
  async updateDeploymentId(cacheEntryId: string, deploymentId: string): Promise<void> {
    await this.databaseService.db
      .update(deploymentCache)
      .set({ deploymentId })
      .where(eq(deploymentCache.id, cacheEntryId));

    this.logger.log(`Updated cache entry ${cacheEntryId} with deployment ${deploymentId}`);
  }

  /**
   * Get all cache entries for a project
   */
  async getCacheEntriesByProject(projectId: string): Promise<CacheEntry[]> {
    const entries = await this.databaseService.db
      .select()
      .from(deploymentCache)
      .where(eq(deploymentCache.projectId, projectId))
      .orderBy(desc(deploymentCache.createdAt));

    return entries as CacheEntry[];
  }

  /**
   * Get cache statistics for a repository
   */
  async getCacheStats(projectId: string, repositoryId: string): Promise<{
    totalEntries: number;
    branches: string[];
    latestCommit: string | null;
    oldestEntry: Date | null;
    newestEntry: Date | null;
  }> {
    const entries = await this.databaseService.db
      .select()
      .from(deploymentCache)
      .where(
        and(
          eq(deploymentCache.projectId, projectId),
          eq(deploymentCache.repositoryId, repositoryId),
        ),
      )
      .orderBy(desc(deploymentCache.createdAt));

    const branches = [...new Set(entries.map((e) => e.branch))];
    const latestCommit = entries.length > 0 ? entries[0].commitSha : null;
    const oldestEntry = entries.length > 0 ? entries[entries.length - 1].createdAt : null;
    const newestEntry = entries.length > 0 ? entries[0].createdAt : null;

    return {
      totalEntries: entries.length,
      branches,
      latestCommit,
      oldestEntry,
      newestEntry,
    };
  }

  /**
   * Clean up old cache entries (keep only last N entries per branch)
   */
  async cleanupOldEntries(
    projectId: string,
    repositoryId: string,
    keepPerBranch: number = 10,
  ): Promise<number> {
    const entries = await this.databaseService.db
      .select()
      .from(deploymentCache)
      .where(
        and(
          eq(deploymentCache.projectId, projectId),
          eq(deploymentCache.repositoryId, repositoryId),
        ),
      )
      .orderBy(desc(deploymentCache.createdAt));

    // Group by branch
    const entriesByBranch = entries.reduce(
      (acc, entry) => {
        if (!acc[entry.branch]) {
          acc[entry.branch] = [];
        }
        acc[entry.branch].push(entry);
        return acc;
      },
      {} as Record<string, typeof entries>,
    );

    // Find entries to delete (keep only keepPerBranch newest per branch)
    const toDelete: string[] = [];
    for (const branch in entriesByBranch) {
      const branchEntries = entriesByBranch[branch];
      if (branchEntries.length > keepPerBranch) {
        const entriesToDelete = branchEntries.slice(keepPerBranch);
        toDelete.push(...entriesToDelete.map((e) => e.id));
      }
    }

    // Delete old entries
    if (toDelete.length > 0) {
      for (const id of toDelete) {
        await this.databaseService.db.delete(deploymentCache).where(eq(deploymentCache.id, id));
      }

      this.logger.log(
        `Cleaned up ${toDelete.length} old cache entries for ${repositoryId}`,
      );
    }

    return toDelete.length;
  }

  /**
   * Delete all cache entries for a branch
   */
  async deleteBranchCache(
    projectId: string,
    repositoryId: string,
    branch: string,
  ): Promise<void> {
    await this.databaseService.db
      .delete(deploymentCache)
      .where(
        and(
          eq(deploymentCache.projectId, projectId),
          eq(deploymentCache.repositoryId, repositoryId),
          eq(deploymentCache.branch, branch),
        ),
      );

    this.logger.log(`Deleted all cache entries for ${repositoryId}@${branch}`);
  }
}
