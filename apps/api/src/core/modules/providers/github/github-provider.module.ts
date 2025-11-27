import { Module } from "@nestjs/common";
import { DatabaseModule } from '@/core/modules/database/database.module';
import { GithubProviderService } from "./github-provider.service";
import { GithubRepositoryConfigService } from './services/github-repository-config.service';
import { GithubChangeDetectionService } from './services/github-change-detection.service';
import { GithubDeploymentCacheService } from './services/github-deployment-cache.service';
import { GithubDeploymentRulesService } from './services/github-deployment-rules.service';
import { GithubDeploymentRulesDataService } from './services/github-deployment-rules-data.service';
import { GithubRepositoryConfigRepository } from '@/core/modules/github/repositories/github-repository-config.repository';
import { GithubDeploymentRulesRepository } from '@/core/modules/github/repositories/github-deployment-rules.repository';
import { GithubDeploymentCacheRepository } from '@/core/modules/github/repositories/github-deployment-cache.repository';
import { GithubProviderRepository } from './repositories/github-provider.repository';

/**
 * GitHub Provider Module
 * 
 * Provides TWO GitHub services:
 * 1. GitHubProviderService: Handles GitHub App installations, repositories, and deployment matching
 * 2. GithubProviderService: Implements provider interface for fetching files (new architecture)
 * 
 * Enhanced with:
 * - Repository configuration with monorepo support (base path, watch paths, ignore paths)
 * - Change detection with strict/loose cache strategies
 * - Deployment caching to skip unnecessary deployments
 * - Provider abstraction for unified deployment pipeline
 * 
 * Dependencies:
 * - DatabaseModule: For database access
 * 
 * Note: Removed GitHubModule import as GitHubProviderService doesn't actually use GitHubService.
 * This breaks the circular dependency: GitHubModule ↔ GitHubProviderModule
 */
@Module({
  imports: [
    DatabaseModule,
  ],
  providers: [
    GithubProviderService,
    GithubRepositoryConfigService,
    GithubChangeDetectionService,
    GithubDeploymentCacheService,
    GithubDeploymentRulesService,
    GithubDeploymentRulesDataService,
    GithubProviderRepository,
    GithubRepositoryConfigRepository,
    GithubDeploymentRulesRepository,
    GithubDeploymentCacheRepository,
  ],
  exports: [
    GithubProviderService,
    GithubRepositoryConfigService,
    GithubChangeDetectionService,
    GithubDeploymentCacheService,
    GithubDeploymentRulesService,
    GithubDeploymentRulesDataService,
    GithubProviderRepository,
    GithubRepositoryConfigRepository,
    GithubDeploymentRulesRepository,
    GithubDeploymentCacheRepository,
  ],
})
export class GitHubProviderModule {}
