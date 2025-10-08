import { Injectable, Logger } from '@nestjs/common';
import { GithubRepositoryConfigService } from './github-repository-config.service';
import { githubRepositoryConfigs } from '@/config/drizzle/schema';

export interface ChangeDetectionResult {
  shouldDeploy: boolean;
  reason: string;
  changedFiles: string[];
  watchedFiles: string[];
  cachedCommit?: string;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: Date;
  added: string[];
  modified: string[];
  removed: string[];
}

@Injectable()
export class GithubChangeDetectionService {
  private readonly logger = new Logger(GithubChangeDetectionService.name);

  constructor(
    private readonly repoConfigService: GithubRepositoryConfigService,
  ) {}

  /**
   * Detect if deployment is needed based on changed files
   * 
   * Algorithm:
   * 1. Get all changed files from commit
   * 2. Filter by base path (monorepo support)
   * 3. Apply watch paths and ignore paths
   * 4. Check cache strategy (strict vs loose)
   * 5. Return decision with details
   */
  async detectChanges(
    projectId: string,
    repositoryId: string,
    commit: GitHubCommit,
    previousCommitSha?: string,
  ): Promise<ChangeDetectionResult> {
    this.logger.log(
      `Detecting changes for project ${projectId}, repo ${repositoryId}, commit ${commit.sha}`,
    );

    // Get repository configuration
    const config = await this.repoConfigService.findByProjectAndRepository(
      projectId,
      repositoryId,
    );

    if (!config) {
      return {
        shouldDeploy: false,
        reason: 'No repository configuration found',
        changedFiles: [],
        watchedFiles: [],
      };
    }

    // Get all changed files from commit
    const allChangedFiles = [...commit.added, ...commit.modified, ...commit.removed];

    if (allChangedFiles.length === 0) {
      return {
        shouldDeploy: false,
        reason: 'No files changed in commit',
        changedFiles: [],
        watchedFiles: [],
      };
    }

    this.logger.debug(`Total changed files: ${allChangedFiles.length}`);

    // Filter files based on watch/ignore patterns
    const watchedFiles = this.repoConfigService.getWatchedFiles(allChangedFiles, config);

    this.logger.debug(`Watched files after filtering: ${watchedFiles.length}`);

    // If no watched files changed, no deployment needed
    if (watchedFiles.length === 0) {
      return {
        shouldDeploy: false,
        reason: 'No watched files changed (filtered by base path, watch paths, or ignore paths)',
        changedFiles: allChangedFiles,
        watchedFiles: [],
      };
    }

    // Deployment is needed
    return {
      shouldDeploy: true,
      reason: `${watchedFiles.length} watched file(s) changed`,
      changedFiles: allChangedFiles,
      watchedFiles,
      cachedCommit: previousCommitSha,
    };
  }

  /**
   * Check if deployment should be skipped based on cache strategy
   * 
   * Strict strategy: Skip if NO watched files changed
   * Loose strategy: Skip if NO files in changed paths changed
   */
  async shouldSkipDeployment(
    projectId: string,
    repositoryId: string,
    branch: string,
    commit: GitHubCommit,
    cachedCommit?: string,
  ): Promise<{ shouldSkip: boolean; reason: string }> {
    const config = await this.repoConfigService.findByProjectAndRepository(
      projectId,
      repositoryId,
    );

    if (!config) {
      return { shouldSkip: false, reason: 'No configuration found' };
    }

    const result = await this.detectChanges(projectId, repositoryId, commit, cachedCommit);

    if (!result.shouldDeploy) {
      return {
        shouldSkip: true,
        reason: result.reason,
      };
    }

    return {
      shouldSkip: false,
      reason: result.reason,
    };
  }

  /**
   * Get the list of files that would trigger a deployment
   * Useful for UI and debugging
   */
  async getDeploymentTriggerFiles(
    projectId: string,
    repositoryId: string,
    files: string[],
  ): Promise<string[]> {
    const config = await this.repoConfigService.findByProjectAndRepository(
      projectId,
      repositoryId,
    );

    if (!config) {
      return [];
    }

    return this.repoConfigService.getWatchedFiles(files, config);
  }

  /**
   * Validate repository configuration patterns
   * Returns any invalid patterns
   */
  validatePatterns(config: typeof githubRepositoryConfigs.$inferSelect): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Validate base path
    if (config.basePath && !config.basePath.startsWith('/')) {
      errors.push('Base path must start with /');
    }

    // Validate watch paths
    if (config.watchPaths) {
      for (const pattern of config.watchPaths) {
        if (pattern.includes('//')) {
          errors.push(`Invalid watch pattern: ${pattern} (contains //)`);
        }
      }
    }

    // Validate ignore paths
    if (config.ignorePaths) {
      for (const pattern of config.ignorePaths) {
        if (pattern.includes('//')) {
          errors.push(`Invalid ignore pattern: ${pattern} (contains //)`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get a summary of what files would be watched
   * Useful for configuration UI
   */
  async getWatchSummary(
    projectId: string,
    repositoryId: string,
  ): Promise<{
    basePath: string;
    watchPaths: string[];
    ignorePaths: string[];
    cacheStrategy: 'strict' | 'loose';
    examplePaths: { path: string; watched: boolean; reason: string }[];
  }> {
    const config = await this.repoConfigService.findByProjectAndRepository(
      projectId,
      repositoryId,
    );

    if (!config) {
      return {
        basePath: '/',
        watchPaths: [],
        ignorePaths: [],
        cacheStrategy: 'strict',
        examplePaths: [],
      };
    }

    // Generate example paths
    const examplePaths = [
      'src/index.ts',
      'package.json',
      'README.md',
      'apps/web/src/app.tsx',
      'apps/api/src/main.ts',
      'docs/guide.md',
      '.github/workflows/ci.yml',
      'node_modules/package/index.js',
    ].map((path) => {
      const watched = this.repoConfigService.isPathWatched(path, config);
      let reason = '';

      if (!watched) {
        if (!path.startsWith(config.basePath || '/')) {
          reason = 'Outside base path';
        } else if (
          config.ignorePaths &&
          config.ignorePaths.some((pattern) =>
            this.repoConfigService['matchPattern'](path, pattern),
          )
        ) {
          reason = 'Matches ignore pattern';
        } else if (config.watchPaths && config.watchPaths.length > 0) {
          reason = 'No watch pattern match';
        }
      } else {
        reason = 'Watched';
      }

      return { path, watched, reason };
    });

    return {
      basePath: config.basePath || '/',
      watchPaths: config.watchPaths || [],
      ignorePaths: config.ignorePaths || [],
      cacheStrategy: config.cacheStrategy,
      examplePaths,
    };
  }
}
