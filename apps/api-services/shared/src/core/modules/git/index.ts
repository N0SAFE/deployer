/**
 * Git Module Family
 *
 * Organized structure for all git-related modules:
 * - git/    : Core git operations (clone, pull, checkout, etc.)
 * - github/ : GitHub API integration
 * - gitlab/ : GitLab API integration (future)
 * - gitea/  : Gitea API integration (future)
 *
 * Import pattern:
 *   import { GitModule, GitService } from '@/core/modules/git/git';
 *   import { GitHubModule, GitHubService } from '@/core/modules/git/github';
 */

// Git (core operations)
export { GitModule, GitService } from '@/core/modules/git/git';

// GitHub
export {
  GitHubModule,
  GitHubService,
  GithubDeploymentCacheRepository,
  GithubDeploymentRulesRepository,
  GithubRepositoryConfigRepository,
  getGitHubEventType,
  getGitHubDeliveryId,
} from '@/core/modules/git/github';
export * from '@/core/modules/git/github/types';
