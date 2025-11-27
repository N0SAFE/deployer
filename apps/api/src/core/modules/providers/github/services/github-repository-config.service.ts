import { Injectable } from '@nestjs/common';
import { GithubRepositoryConfigRepository } from '@/core/modules/github/repositories/github-repository-config.repository';
import { githubRepositoryConfigs } from '@/config/drizzle/schema';

export interface CreateRepositoryConfigInput {
  projectId: string;
  githubAppId: string;
  repositoryId: string;
  repositoryFullName: string;
  basePath?: string;
  watchPaths?: string[];
  ignorePaths?: string[];
  cacheStrategy?: 'strict' | 'loose';
  autoDeployEnabled?: boolean;
  deploymentStrategy?: 'standard' | 'blue-green' | 'canary' | 'rolling' | 'custom';
  customStrategyScript?: string;
  previewDeploymentsEnabled?: boolean;
  previewBranchPattern?: string;
  previewAutoDelete?: boolean;
  previewAutoDeleteAfterDays?: number;
}

export interface UpdateRepositoryConfigInput {
  basePath?: string;
  watchPaths?: string[];
  ignorePaths?: string[];
  cacheStrategy?: 'strict' | 'loose';
  autoDeployEnabled?: boolean;
  deploymentStrategy?: 'standard' | 'blue-green' | 'canary' | 'rolling' | 'custom';
  customStrategyScript?: string;
  previewDeploymentsEnabled?: boolean;
  previewBranchPattern?: string;
  previewAutoDelete?: boolean;
  previewAutoDeleteAfterDays?: number;
}

@Injectable()
export class GithubRepositoryConfigService {
  constructor(
    private readonly configRepository: GithubRepositoryConfigRepository,
  ) {}

  /**
   * Create a new repository configuration
   */
  async create(input: CreateRepositoryConfigInput) {
    return await this.configRepository.create({
      projectId: input.projectId,
      githubAppId: input.githubAppId,
      repositoryId: input.repositoryId,
      repositoryFullName: input.repositoryFullName,
      basePath: input.basePath || '/',
      watchPaths: input.watchPaths || [],
      ignorePaths: input.ignorePaths || [],
      cacheStrategy: input.cacheStrategy || 'strict',
      autoDeployEnabled: input.autoDeployEnabled ?? true,
      deploymentStrategy: input.deploymentStrategy || 'standard',
      customStrategyScript: input.customStrategyScript,
      previewDeploymentsEnabled: input.previewDeploymentsEnabled ?? false,
      previewBranchPattern: input.previewBranchPattern || '*',
      previewAutoDelete: input.previewAutoDelete ?? true,
      previewAutoDeleteAfterDays: input.previewAutoDeleteAfterDays || 7,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Get repository configuration by ID
   */
  async findById(id: string) {
    return await this.configRepository.findById(id);
  }

  /**
   * Get repository configuration by project ID
   */
  async findByProjectId(projectId: string) {
    return await this.configRepository.findByProjectId(projectId);
  }

  /**
   * Get repository configuration by repository ID
   */
  async findByRepositoryId(repositoryId: string) {
    return await this.configRepository.findByRepositoryId(repositoryId);
  }

  /**
   * Get repository configuration by project and repository
   */
  async findByProjectAndRepository(projectId: string, repositoryId: string) {
    return await this.configRepository.findByProjectAndRepository(
      projectId,
      repositoryId,
    );
  }

  /**
   * Find config by repository ID or full name
   */
  async findByRepositoryIdOrFullName(
    repositoryId?: string,
    fullName?: string
  ) {
    return await this.configRepository.findByRepositoryIdOrFullName(
      repositoryId,
      fullName,
    );
  }

  /**
   * Update repository configuration
   */
  async update(id: string, input: UpdateRepositoryConfigInput) {
    return await this.configRepository.update(id, input);
  }

  /**
   * Delete repository configuration
   */
  async delete(id: string) {
    await this.configRepository.delete(id);
  }

  /**
   * Check if a file path matches watch patterns
   */
  isPathWatched(filePath: string, config: typeof githubRepositoryConfigs.$inferSelect): boolean {
    const { basePath, watchPaths, ignorePaths } = config;

    // Normalize paths
    const normalizedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    const normalizedBasePath = basePath || '/';

    // Check if path is within base path
    if (!normalizedPath.startsWith(normalizedBasePath)) {
      return false;
    }

    // Get relative path from base
    const relativePath = normalizedPath.slice(normalizedBasePath.length);

    // Check ignore patterns first
    if (ignorePaths && ignorePaths.length > 0) {
      for (const pattern of ignorePaths) {
        if (this.matchPattern(relativePath, pattern)) {
          return false;
        }
      }
    }

    // If no watch paths specified, watch everything (except ignored)
    if (!watchPaths || watchPaths.length === 0) {
      return true;
    }

    // Check watch patterns
    for (const pattern of watchPaths) {
      if (this.matchPattern(relativePath, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Match a file path against a glob-like pattern
   * Supports: *, **, ?
   */
  private matchPattern(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.') // Escape dots
      .replace(/\*\*/g, '.*') // ** matches any number of directories
      .replace(/\*/g, '[^/]*') // * matches anything except /
      .replace(/\?/g, '.'); // ? matches single character

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  /**
   * Get all watched files from a list of changed files
   */
  getWatchedFiles(
    changedFiles: string[],
    config: typeof githubRepositoryConfigs.$inferSelect,
  ): string[] {
    return changedFiles.filter((file) => this.isPathWatched(file, config));
  }
}
