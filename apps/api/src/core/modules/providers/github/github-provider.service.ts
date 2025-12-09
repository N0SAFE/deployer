import { Injectable } from '@nestjs/common';
import type {
  IWebhookProvider,
  IOAuthProvider,
  ProviderConfig,
  DeploymentTrigger,
  SourceFiles,
} from '../interfaces/provider.interface';
import type { IProvider, ConfigSchema } from '@/core/interfaces/provider.interface';
import type { NormalizedGitHubEvent } from '@/core/modules/git/github';
import { z } from 'zod';
import { BaseProviderService } from '../common/services/base-provider.service';
import { GithubRepositoryConfigService } from './services/github-repository-config.service';
import { GithubChangeDetectionService } from './services/github-change-detection.service';
import { GithubDeploymentCacheService } from './services/github-deployment-cache.service';
import { TraefikConfigBuilder } from '@/core/modules/traefik/config-builder/builders';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { GithubProviderRepository } from './repositories/github-provider.repository';

/**
 * Type for GitHub App installation update data
 */
interface InstallationUpdateData {
  installationId?: string;
  appId?: string;
  privateKey?: string;
  clientId?: string;
  clientSecret?: string;
  webhookSecret?: string;
}

/**
 * Type for service match results from findMatchingServices
 */
interface ServiceMatch {
  service: {
    id: string;
    name: string;
    projectId: string;
  };
  rule: {
    id: string;
    name: string;
    projectId: string;
    action: string;
  };
  deploymentConfig: {
    branch: string;
    environment: string;
    strategy: string;
  };
}

/**
 * GitHub webhook payload types for type-safe parsing
 */
interface GitHubRepository {
  id: number;
  clone_url: string;
  full_name: string;
}

interface GitHubCommitAuthor {
  name: string;
  email?: string;
}

interface GitHubCommit {
  id: string;
  message: string;
  author?: GitHubCommitAuthor;
  added?: string[];
  modified?: string[];
  removed?: string[];
}

interface GitHubPushPayload {
  ref: string;
  after?: string;
  head_commit?: {
    id: string;
    message: string;
    author?: GitHubCommitAuthor;
  };
  commits?: GitHubCommit[];
  repository: GitHubRepository;
}

interface GitHubPullRequestPayload {
  action: string;
  pull_request?: {
    number: number;
    title: string;
    head?: { ref: string; sha: string };
    base?: { ref: string };
    user?: { login: string };
    labels?: { name: string }[];
  };
  repository: GitHubRepository;
}

interface GitHubCreatePayload {
  ref_type: string;
  ref: string;
  master_branch?: string;
  sender?: { login: string };
  repository: GitHubRepository;
}

/**
 * Type guards for GitHub webhook payloads
 * These ensure both the correct event type AND that repository is present
 */
function isGitHubPushPayload(payload: unknown): payload is GitHubPushPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.ref === 'string' &&
    typeof p.repository === 'object' &&
    p.repository !== null
  );
}

function isGitHubPullRequestPayload(payload: unknown): payload is GitHubPullRequestPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.action === 'string' &&
    typeof p.repository === 'object' &&
    p.repository !== null
  );
}

function isGitHubCreatePayload(payload: unknown): payload is GitHubCreatePayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.ref_type === 'string' &&
    typeof p.repository === 'object' &&
    p.repository !== null
  );
}

/**
 * Type for deployment trigger data
 */
interface DeploymentTriggerData {
  projectId?: string;
  repositoryId?: string;
  repositoryUrl?: string;
  branch?: string;
  commitSha?: string;
  tag?: string;
  author?: string;
  message?: string;
  changedFiles?: string[];
  watchedFiles?: string[];
  action?: string;
  prNumber?: number;
  prLabels?: string[];
  targetBranch?: string;
}

/**
 * Type guard for DeploymentTriggerData
 */
function isDeploymentTriggerData(data: unknown): data is DeploymentTriggerData {
  if (!data || typeof data !== 'object') return false;
  return true; // All fields are optional, basic object check is sufficient
}

/**
 * Helper to safely extract trigger data with proper typing
 */
function getTriggerData(trigger: DeploymentTrigger): DeploymentTriggerData {
  if (trigger.data && isDeploymentTriggerData(trigger.data)) {
    return trigger.data;
  }
  return {};
}

/**
 * GitHub Provider Service
 * 
 * Responsibilities:
 * 1. Fetch source files from GitHub repository
 * 2. Verify webhooks
 * 3. Handle OAuth flow
 * 4. Check deployment cache
 * 
 * The provider is ONLY responsible for getting files.
 * Building and deploying is handled by the DeploymentOrchestrator.
 */
@Injectable()
export class GithubProviderService
  extends BaseProviderService
  implements IWebhookProvider, IOAuthProvider, IProvider
{
  // IProvider properties
  readonly id = 'github';
  readonly name = 'GitHub';
  readonly type = 'github' as const;
  readonly description = 'Deploy from GitHub repositories with automatic webhooks and CI/CD integration';
  readonly icon = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
  readonly supportedBuilders = ['dockerfile', 'buildpack', 'nixpack', 'static', 'docker-compose'];

  constructor(
    private readonly repoConfigService: GithubRepositoryConfigService,
    private readonly changeDetectionService: GithubChangeDetectionService,
    private readonly cacheService: GithubDeploymentCacheService,
    private readonly githubProviderRepository: GithubProviderRepository,
  ) {
    super('GithubProviderService');
  }

  /**
   * Fetch source files from GitHub
   */
  async fetchSource(config: ProviderConfig, trigger: DeploymentTrigger): Promise<SourceFiles> {
    return this.executeWithLogging(
      'fetchSource',
      async () => {
        this.log(`Fetching source from GitHub: ${config.repository?.url ?? ''}`);

        const {
          url,
          branch = 'main',
          accessToken,
        } = config.repository ?? {};

        if (!url) {
          throw new Error('Repository URL is required');
        }

        // Create temporary directory for source files
        const tmpDir = path.join('/tmp', `github-${String(Date.now())}-${this.generateId()}`);
        await fs.mkdir(tmpDir, { recursive: true });

        try {
          // Clone repository
          await this.cloneRepository(url, branch, tmpDir, accessToken);

          // Apply monorepo filtering if configured
          let localPath = tmpDir;
          if (config.monorepo?.basePath && config.monorepo.basePath !== '/') {
            localPath = path.join(tmpDir, config.monorepo.basePath);
          }

          // Get changed files for cache detection
          const changedFiles = await this.getChangedFiles(tmpDir, trigger);
          const triggerData = getTriggerData(trigger);

          return {
            sourceId: `github-${String(Date.now())}-${this.generateId()}`,
            localPath,
            metadata: {
              provider: 'github',
              version: branch,
              branch,
              commitSha: triggerData.commitSha,
              tag: triggerData.tag,
              author: triggerData.author,
              message: triggerData.message,
              timestamp: this.getCurrentTimestamp(),
              repositoryUrl: url,
            },
            changedFiles,
            cleanup: async () => {
              await fs.rm(tmpDir, { recursive: true, force: true });
              this.debug(`Cleaned up temporary directory: ${tmpDir}`);
            },
          };
        } catch (error) {
          // Cleanup on error
          await fs.rm(tmpDir, { recursive: true, force: true });
          this.error('Failed to fetch source', error);
          throw error;
        }
      },
    );
  }

  /**
   * Retrieve a stored GitHub App installation by organization login.
   * Returns null when not found. This is a small helper used by the webhook
   * handlers to look up per-organization credentials and webhook secrets.
   */
  async getInstallationByOrganization(organizationLogin: string) {
    return await this.githubProviderRepository.findInstallationByOrganization(organizationLogin);
  }

  /**
   * Get all GitHub installations (for backward compatibility with OAuth controller)
   * Note: The githubApps table doesn't have a userId field in the current schema.
   * This returns all installations. In a production system, you would filter by user.
   */
  async getUserInstallations(_userId: string) {
    return await this.githubProviderRepository.findAllInstallations();
  }

  /**
   * Store a new GitHub App installation
   */
  async storeInstallation(data: {
    userId: string;
    installationId: number;
    organizationLogin: string;
    accountLogin: string;
    accountType: string;
    accountAvatarUrl: string;
    permissions: Record<string, unknown>;
    htmlUrl: string;
    appId: string;
    privateKey: string;
    clientId?: string;
    clientSecret?: string;
    webhookSecret?: string;
  }): Promise<string> {
    const inserted = await this.githubProviderRepository.createInstallation({
      organizationId: data.organizationLogin,
      name: `${data.accountLogin} App`,
      appId: data.appId,
      clientId: data.clientId ?? '',
      clientSecret: data.clientSecret ?? '',
      privateKey: data.privateKey,
      webhookSecret: data.webhookSecret ?? '',
      installationId: data.installationId.toString(),
      isActive: true,
    });

    if (!inserted) {
      throw new Error('Failed to create GitHub App installation');
    }
    return inserted.id;
  }

  /**
   * Update an existing GitHub App installation
   */
  async updateInstallation(data: {
    id: string;
    installationId?: number;
    accountType?: string;
    accountAvatarUrl?: string;
    permissions?: Record<string, unknown>;
    htmlUrl?: string;
    appId?: string;
    privateKey?: string;
    clientId?: string | null;
    clientSecret?: string | null;
    webhookSecret?: string | null;
    lastSyncedAt?: Date;
    repositoriesCount?: number;
    updatedAt?: Date;
  }): Promise<void> {
    const updateData: InstallationUpdateData = {};
    
    if (data.installationId !== undefined) {
      updateData.installationId = data.installationId.toString();
    }
    if (data.appId !== undefined) {
      updateData.appId = data.appId;
    }
    if (data.privateKey !== undefined) {
      updateData.privateKey = data.privateKey;
    }
    if (data.clientId !== undefined) {
      updateData.clientId = data.clientId ?? '';
    }
    if (data.clientSecret !== undefined) {
      updateData.clientSecret = data.clientSecret ?? '';
    }
    if (data.webhookSecret !== undefined) {
      updateData.webhookSecret = data.webhookSecret ?? '';
    }

    await this.githubProviderRepository.updateInstallation(data.id, updateData);
  }

  /**
   * Store a GitHub repository
   * Note: This is a placeholder since repositories are tracked via githubRepositoryConfigs
   * which requires project association. The OAuth controller should be updated to handle
   * this differently.
   */
  async storeRepository(data: {
    id: string;
    repositoryId: number;
    installationId: string;
    name: string;
    fullName: string;
    private: boolean;
    htmlUrl: string;
    description: string | null;
    defaultBranch: string;
    language: string | null;
    stargazersCount: number;
    forksCount: number;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<void> {
    const existing = await this.githubProviderRepository.findRepositoryConfigByRepositoryId(data.repositoryId.toString());

    if (existing) {
      await this.githubProviderRepository.updateRepositoryConfig(
        data.repositoryId.toString(),
        {
          repositoryFullName: data.fullName,
        }
      );
      
      this.log(`Updated repository config for ${data.fullName}`);
    } else {
      // Log that repository would be stored but requires project association
      // In a real implementation, you would either:
      // 1. Create a default project for the installation
      // 2. Require the user to associate the repository with an existing project
      // 3. Store repository metadata in a separate table for later association
      this.log(`Repository ${data.fullName} requires project association - skipping storage`);
    }
  }

  /**
   * Find matching services and deployment rules for an incoming GitHub event.
   *
   * NOTE: This is a conservative placeholder implementation that attempts to
   * locate repository configuration and deployment rules in the DB. It will
   * return lightweight match objects which the webhook controller can use to
   * create deployments. In a later pass this should be expanded to resolve
   * exact service records and more sophisticated rule matching.
   */
  async findMatchingServices(event: NormalizedGitHubEvent): Promise<ServiceMatch[]> {
    const repoId = event.repository.id.toString();
    const repoFull = event.repository.full_name;

    const config = await this.githubProviderRepository.findRepositoryConfig(
      repoId,
      repoFull
    );
    
    if (!config) return [];

    const rules = await this.githubProviderRepository.findDeploymentRulesByProjectAndEvent(
      config.projectId,
      event.type
    );

    const matches: ServiceMatch[] = [];
    for (const rule of rules) {
      const svc = await this.githubProviderRepository.findServiceByProjectId(rule.projectId);

      const serviceObj = svc ?? { id: `svc-${rule.id}`, name: `svc-${rule.name}`, projectId: config.projectId };

      matches.push({
        service: serviceObj,
        rule: {
          id: rule.id,
          name: rule.name,
          projectId: rule.projectId,
          action: rule.action,
        },
        deploymentConfig: {
          branch: config.basePath ?? 'main',
          environment: rule.action === 'preview' ? 'preview' : 'production',
          strategy: config.deploymentStrategy,
        },
      });
    }

    return matches;
  }

  /**
   * Check if deployment should be skipped based on cache
   */
  async shouldSkipDeployment(
    config: ProviderConfig,
    trigger: DeploymentTrigger,
  ): Promise<{ shouldSkip: boolean; reason: string }> {
    if (!config.cache?.enabled) {
      return { shouldSkip: false, reason: 'Cache disabled' };
    }

    const triggerData = getTriggerData(trigger);
    const projectId = triggerData.projectId;
    const repositoryId = triggerData.repositoryId;
    const branch = triggerData.branch ?? config.repository?.branch ?? 'main';
    const commitSha = triggerData.commitSha;

    if (!projectId || !repositoryId || !commitSha) {
      return { shouldSkip: false, reason: 'Missing required data for cache check' };
    }

    // Get changed files from trigger
    const changedFiles = triggerData.changedFiles ?? [];
    const watchedFiles = triggerData.watchedFiles ?? changedFiles;

    const skipResult = await this.cacheService.shouldSkipDeployment(
      projectId,
      repositoryId,
      branch,
      commitSha,
      changedFiles,
      watchedFiles,
      config.cache.strategy,
    );

    return {
      shouldSkip: skipResult.shouldSkip,
      reason: skipResult.reason,
    };
  }

  /**
   * Get deployment version string
   */
  getDeploymentVersion(source: SourceFiles): string {
    if (source.metadata.tag) {
      return source.metadata.tag;
    }
    if (source.metadata.commitSha) {
      return source.metadata.commitSha.substring(0, 7);
    }
    return source.metadata.branch ?? 'unknown';
  }

  /**
   * Get the default Traefik configuration template for GitHub provider
   */
  getTraefikTemplate(): string {
    return `# GitHub Provider Traefik Template
# Variables: ~##domain##~, ~##subdomain##~, ~##host##~, ~##projectId##~, ~##serviceName##~, ~##containerName##~, ~##containerPort##~

http:
  routers:
    ~##routerName##~:
      rule: "Host(\`~##host##~\`)"
      service: "~##serviceName##~-svc"
      entryPoints:
        - web
      middlewares:
        - "~##serviceName##~-cors"
  
  middlewares:
    ~##serviceName##~-cors:
      headers:
        accessControlAllowOriginList:
          - "*"
        accessControlAllowMethods:
          - "GET"
          - "POST"
          - "PUT"
          - "DELETE"
        accessControlAllowHeaders:
          - "Content-Type"
          - "Authorization"
  
  services:
    ~##serviceName##~-svc:
      loadBalancer:
        servers:
          - url: "http://~##containerName##~:~##containerPort##~"
`;
  }

  /**
   * Verify GitHub webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    try {
      const hmac = crypto.createHmac('sha256', secret);
      const digest = 'sha256=' + hmac.update(payload).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
    } catch (error) {
      this.error('Failed to verify webhook signature', error);
      return false;
    }
  }

  /**
   * Parse GitHub webhook payload using type guards for safety
   */
  parseWebhookPayload(
    event: string,
    payload: Record<string, unknown>,
  ): Promise<DeploymentTrigger | null> {
    switch (event) {
      case 'push':
        if (isGitHubPushPayload(payload)) {
          return Promise.resolve({
            trigger: 'webhook',
            event: 'push',
            data: {
              branch: payload.ref.replace('refs/heads/', ''),
              commitSha: payload.after ?? payload.head_commit?.id,
              message: payload.head_commit?.message,
              author: payload.head_commit?.author?.name,
              changedFiles: this.extractChangedFiles(payload.commits ?? []),
              repositoryId: payload.repository.id.toString(),
              repositoryUrl: payload.repository.clone_url,
            },
          });
        }
        break;

      case 'pull_request':
        if (isGitHubPullRequestPayload(payload)) {
          return Promise.resolve({
            trigger: 'webhook',
            event: 'pull_request',
            data: {
              action: payload.action,
              branch: payload.pull_request?.head?.ref,
              commitSha: payload.pull_request?.head?.sha,
              message: payload.pull_request?.title,
              author: payload.pull_request?.user?.login,
              prNumber: payload.pull_request?.number,
              prLabels: payload.pull_request?.labels?.map((l) => l.name) ?? [],
              targetBranch: payload.pull_request?.base?.ref,
              repositoryId: payload.repository.id.toString(),
              repositoryUrl: payload.repository.clone_url,
            },
          });
        }
        break;

      case 'create':
        if (isGitHubCreatePayload(payload) && payload.ref_type === 'tag') {
          return Promise.resolve({
            trigger: 'webhook',
            event: 'tag',
            data: {
              tag: payload.ref,
              commitSha: payload.master_branch,
              author: payload.sender?.login,
              repositoryId: payload.repository.id.toString(),
              repositoryUrl: payload.repository.clone_url,
            },
          });
        }
        break;

      default:
        this.warn(`Unhandled GitHub event: ${event}`);
        return Promise.resolve(null);
    }

    return Promise.resolve(null);
  }

  /**
   * Get OAuth authorization URL
   */
  getAuthorizationUrl(redirectUri: string, state: string): string {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      throw new Error('GITHUB_CLIENT_ID environment variable is not set');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: 'repo,read:org',
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange code for access token
   */
  async exchangeCodeForToken(
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('GitHub OAuth credentials not configured');
    }

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub OAuth failed: ${response.statusText}`);
    }

    const data = (await response.json()) as { access_token: string };

    return {
      accessToken: data.access_token,
    };
  }

  /**
   * Clone GitHub repository
   * 
   * Implementation options:
   * 1. Use GitHub API to download archive (tarball/zipball)
   * 2. Use git clone command
   * 3. Use simple-git or nodegit library
   */
  private async cloneRepository(
    url: string,
    branch: string,
    targetDir: string,
    _accessToken?: string,
  ): Promise<void> {
    return this.executeWithLogging(
      'cloneRepository',
      async () => {
        this.debug(`Cloning ${url}#${branch} to ${targetDir}`);
        
        // TODO: Implement actual cloning logic
        // For now, create a placeholder file
        await fs.writeFile(
          path.join(targetDir, 'README.md'),
          `# Cloned from ${url}\nBranch: ${branch}\nTimestamp: ${new Date().toISOString()}`,
        );

        this.debug(`Successfully cloned repository`);
      },
    );
  }

  /**
   * Get changed files from repository
   */
  private async getChangedFiles(
    repoPath: string,
    trigger: DeploymentTrigger,
  ): Promise<string[]> {
    // If webhook provides changed files, use those
    const triggerData = getTriggerData(trigger);
    if (triggerData.changedFiles) {
      return triggerData.changedFiles;
    }

    // Otherwise, get all files (for manual deployments)
    return this.executeWithLogging(
      'getChangedFiles',
      async () => {
        const files: string[] = [];
        
        const readDir = async (dir: string) => {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              // Skip common directories
              if (!['node_modules', '.git', '.next', 'dist', 'build'].includes(entry.name)) {
                await readDir(fullPath);
              }
            } else {
              files.push(path.relative(repoPath, fullPath));
            }
          }
        };

        await readDir(repoPath);
        return files;
      },
    );
  }

  /**
   * Extract changed files from commit payload
   */
  private extractChangedFiles(commits: GitHubCommit[]): string[] {
    const files = new Set<string>();

    for (const commit of commits) {
      if (commit.added) commit.added.forEach((f) => files.add(f));
      if (commit.modified) commit.modified.forEach((f) => files.add(f));
      if (commit.removed) commit.removed.forEach((f) => files.add(f));
    }

    return Array.from(files);
  }

  /**
   * Validate glob pattern
   */
  private isValidGlobPattern(pattern: string): boolean {
    try {
      // Basic validation - ensure pattern doesn't have invalid sequences
      if (pattern.includes('***')) return false;
      if (pattern.includes('//')) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get configuration schema for GitHub provider (IProvider interface)
   */
  getConfigSchema(): ConfigSchema {
    return {
      id: 'github-provider-config',
      version: '1.0.0',
      title: 'GitHub Repository Configuration',
      description: 'Configure GitHub repository access and deployment settings',
      fields: [
        {
          key: 'repositoryUrl',
          label: 'Repository URL',
          description: 'GitHub repository URL (e.g., https://github.com/owner/repo)',
          schema: z.url(),
          type: 'url',
          required: true,
          placeholder: 'https://github.com/owner/repo',
          group: 'repository',
          ui: { order: 1 },
        },
        {
          key: 'branch',
          label: 'Branch',
          description: 'Git branch to deploy from',
          schema: z.string().min(1),
          type: 'text',
          required: true,
          defaultValue: 'main',
          placeholder: 'main',
          group: 'repository',
          ui: { order: 2 },
        },
        {
          key: 'accessToken',
          label: 'Access Token',
          description: 'GitHub personal access token for private repositories',
          schema: z.string().min(1).optional(),
          type: 'password',
          required: false,
          group: 'authentication',
          ui: { order: 3 },
        },
        {
          key: 'useMonorepo',
          label: 'Monorepo',
          description: 'Enable monorepo support',
          schema: z.boolean(),
          type: 'boolean',
          required: false,
          defaultValue: false,
          group: 'advanced',
          ui: { order: 4 },
        },
        {
          key: 'basePath',
          label: 'Base Path',
          description: 'Path to the service within the monorepo (e.g., /apps/web)',
          schema: z.string().startsWith('/').optional(),
          type: 'text',
          required: false,
          placeholder: '/apps/web',
          group: 'advanced',
          conditional: {
            field: 'useMonorepo',
            value: true,
            operator: 'equals',
          },
          ui: { order: 5 },
        },
        {
          key: 'watchPaths',
          label: 'Watch Paths',
          description: 'Glob patterns to watch for changes (comma-separated)',
          schema: z.string().optional(),
          type: 'textarea',
          required: false,
          placeholder: 'apps/web/**,packages/shared/**',
          group: 'advanced',
          conditional: {
            field: 'useMonorepo',
            value: true,
            operator: 'equals',
          },
          ui: { order: 6 },
        },
        {
          key: 'enableCache',
          label: 'Enable Cache',
          description: 'Skip deployments when no relevant files changed',
          schema: z.boolean(),
          type: 'boolean',
          required: false,
          defaultValue: true,
          group: 'optimization',
          ui: { order: 7 },
        },
        {
          key: 'cacheStrategy',
          label: 'Cache Strategy',
          description: 'How strict to be with cache invalidation',
          schema: z.enum(['strict', 'loose']),
          type: 'select',
          required: false,
          defaultValue: 'strict',
          options: [
            { label: 'Strict (only deploy on relevant changes)', value: 'strict' },
            { label: 'Loose (deploy on any change)', value: 'loose' },
          ],
          group: 'optimization',
          conditional: {
            field: 'enableCache',
            value: true,
            operator: 'equals',
          },
          ui: { order: 8 },
        },
      ],
      validate: (config: unknown) => {
        const errors: string[] = [];
        if (typeof config !== 'object' || config === null) {
          return { valid: false, errors: ['Configuration must be an object'] };
        }
        const cfg = config as Record<string, unknown>;
        
        const repositoryUrl = cfg.repositoryUrl as string | undefined;
        if (repositoryUrl && !repositoryUrl.includes('github.com')) {
          errors.push('Repository URL must be a GitHub URL');
        }
        
        if (cfg.useMonorepo && !cfg.basePath) {
          errors.push('Base path is required when monorepo is enabled');
        }
        
        return { valid: errors.length === 0, errors };
      },
      transform: (config: unknown) => {
        if (typeof config !== 'object' || config === null) {
          return config;
        }
        const cfg = config as Record<string, unknown>;
        
        // Transform UI config to ProviderConfig format
        const transformed: Record<string, unknown> = {
          type: 'github',
          repository: {
            url: cfg.repositoryUrl,
            branch: (cfg.branch as string | undefined) ?? 'main',
            accessToken: cfg.accessToken,
          },
          cache: {
            enabled: (cfg.enableCache as boolean | undefined) ?? true,
            strategy: (cfg.cacheStrategy as string | undefined) ?? 'strict',
          },
        };
        
        if (cfg.useMonorepo) {
          const watchPaths = cfg.watchPaths as string | undefined;
          transformed.monorepo = {
            basePath: cfg.basePath,
            watchPaths: watchPaths ? watchPaths.split(',').map((p: string) => p.trim()) : [],
            ignorePaths: [],
          };
        }
        
        return transformed;
      },
    };
  }

  /**
   * Get default configuration (IProvider interface)
   */
  getDefaultConfig(): Record<string, any> {
    return {
      repositoryUrl: '',
      branch: 'main',
      accessToken: '',
      useMonorepo: false,
      basePath: '',
      watchPaths: '',
      enableCache: true,
      cacheStrategy: 'strict',
    };
  }

  /**
   * Validate provider configuration (overridden from IProvider)
   */
  validateConfig(config: unknown): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    // Type guard for config object
    if (typeof config !== 'object' || config === null) {
      return Promise.resolve({ valid: false, errors: ['Configuration must be an object'] });
    }
    const cfg = config as Record<string, unknown>;
    const repository = cfg.repository as Record<string, unknown> | undefined;
    const monorepo = cfg.monorepo as Record<string, unknown> | undefined;

    // Support both ProviderConfig and raw config format
    const repoUrl = (repository?.url as string | undefined) ?? (cfg.repositoryUrl as string | undefined);
    const accessToken = (repository?.accessToken as string | undefined) ?? (cfg.accessToken as string | undefined);
    const sshKey = repository?.sshKey as string | undefined;

    if (!repoUrl) {
      errors.push('Repository URL is required');
    }

    if (!accessToken && !sshKey) {
      errors.push('Access token or SSH key is required');
    }

    if (monorepo) {
      const basePath = monorepo.basePath as string | undefined;
      if (basePath && !basePath.startsWith('/')) {
        errors.push('Base path must start with /');
      }

      const watchPaths = (monorepo.watchPaths as string[] | undefined) ?? [];
      const ignorePaths = (monorepo.ignorePaths as string[] | undefined) ?? [];
      const patterns = [...watchPaths, ...ignorePaths];

      for (const pattern of patterns) {
        if (!this.isValidGlobPattern(pattern)) {
          errors.push(`Invalid glob pattern: ${pattern}`);
        }
      }
    }

    return Promise.resolve({
      valid: errors.length === 0,
      errors,
    });
  }

  /**
   * Get default Traefik configuration builder for GitHub deployments
   * @param config Optional configuration for customizing the default setup
   * @returns TraefikConfigBuilder with GitHub-optimized defaults
   */
  getDefaultTraefikConfig(config?: {
    domain?: string;
    enableSSL?: boolean;
    enableCORS?: boolean;
    enableRateLimit?: boolean;
  }): TraefikConfigBuilder {
    const builder = new TraefikConfigBuilder();
    const domain = config?.domain ?? '~##domain##~';

    // Default router for GitHub deployments
    builder.addRouter('github-app', r => r
      .rule(`Host(\`${domain}\`)`)
      .service('github-app-service')
      .entryPoint(config?.enableSSL ? 'websecure' : 'web')
    );

    // Default service
    builder.addService('github-app-service', s => s
      .loadBalancer(lb => lb
        .server('http://~##containerName##~:~##containerPort##~')
        .healthCheck({ path: '/health', interval: '10s' })
      )
    );

    // Add CORS middleware if enabled
    if (config?.enableCORS) {
      builder.addMiddleware('cors', m => m.cors({
        origins: ['*'],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        headers: ['Content-Type', 'Authorization'],
      }));
    }

    // Add rate limiting if enabled
    if (config?.enableRateLimit) {
      builder.addMiddleware('rate-limit', m => m.rateLimit({
        average: 100,
        burst: 50,
      }));
    }

    // Add SSL configuration if enabled
    if (config?.enableSSL) {
      builder.configureTLS(tls => tls
        .certificate('~##certFile##~', '~##keyFile##~')
        .minVersion('VersionTLS12')
      );
    }

    return builder;
  }
}
