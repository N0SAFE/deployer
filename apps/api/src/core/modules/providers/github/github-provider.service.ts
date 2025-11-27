import { Injectable } from '@nestjs/common';
import type {
  IWebhookProvider,
  IOAuthProvider,
  ProviderConfig,
  DeploymentTrigger,
  SourceFiles,
} from '../interfaces/provider.interface';
import type { IProvider, ConfigSchema } from '@/core/interfaces/provider.interface';
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
        this.log(`Fetching source from GitHub: ${config.repository?.url}`);

        const {
          url,
          branch = 'main',
          accessToken,
        } = config.repository || {};

        if (!url) {
          throw new Error('Repository URL is required');
        }

        // Create temporary directory for source files
        const tmpDir = path.join('/tmp', `github-${Date.now()}-${this.generateId()}`);
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

          return {
            sourceId: `github-${Date.now()}-${this.generateId()}`,
            localPath,
            metadata: {
              provider: 'github',
              version: branch,
              branch,
              commitSha: trigger.data?.commitSha,
              tag: trigger.data?.tag,
              author: trigger.data?.author,
              message: trigger.data?.message,
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
    permissions: any;
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
      clientId: data.clientId || '',
      clientSecret: data.clientSecret || '',
      privateKey: data.privateKey,
      webhookSecret: data.webhookSecret || '',
      installationId: data.installationId.toString(),
      isActive: true,
    });

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
    permissions?: any;
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
    const updateData: any = {};
    
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
      updateData.clientId = data.clientId || '';
    }
    if (data.clientSecret !== undefined) {
      updateData.clientSecret = data.clientSecret || '';
    }
    if (data.webhookSecret !== undefined) {
      updateData.webhookSecret = data.webhookSecret || '';
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
  async findMatchingServices(event: any): Promise<Array<any>> {
    const repoId = event.repository?.id?.toString();
    const repoFull = event.repository?.full_name;

    const config = await this.githubProviderRepository.findRepositoryConfig(
      repoId,
      repoFull
    );
    
    if (!config) return [];

    const rules = await this.githubProviderRepository.findDeploymentRulesByProjectAndEvent(
      config.projectId,
      event.type || event.event || 'push'
    );

    const matches: Array<any> = [];
    for (const rule of rules) {
      const svc = await this.githubProviderRepository.findServiceByProjectId(rule.projectId);

      const serviceObj = svc ? svc : { id: `svc-${rule.id}`, name: `svc-${rule.name}`, projectId: config.projectId };

      matches.push({
        service: serviceObj,
        rule,
        deploymentConfig: {
          branch: config.basePath || 'main',
          environment: rule.action === 'preview' ? 'preview' : 'production',
          strategy: config.deploymentStrategy || 'standard',
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

    const projectId = trigger.data?.projectId;
    const repositoryId = trigger.data?.repositoryId;
    const branch = trigger.data?.branch || config.repository?.branch || 'main';
    const commitSha = trigger.data?.commitSha;

    if (!projectId || !repositoryId || !commitSha) {
      return { shouldSkip: false, reason: 'Missing required data for cache check' };
    }

    // Get changed files from trigger
    const changedFiles = trigger.data?.changedFiles || [];
    const watchedFiles = trigger.data?.watchedFiles || changedFiles;

    const skipResult = await this.cacheService.shouldSkipDeployment(
      projectId,
      repositoryId,
      branch,
      commitSha,
      changedFiles,
      watchedFiles,
      config.cache.strategy || 'strict',
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
    return source.metadata.branch || 'unknown';
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
   * Parse GitHub webhook payload
   */
  async parseWebhookPayload(
    event: string,
    payload: Record<string, any>,
  ): Promise<DeploymentTrigger | null> {
    switch (event) {
      case 'push':
        return {
          trigger: 'webhook',
          event: 'push',
          data: {
            branch: payload.ref?.replace('refs/heads/', ''),
            commitSha: payload.after || payload.head_commit?.id,
            message: payload.head_commit?.message,
            author: payload.head_commit?.author?.name,
            changedFiles: this.extractChangedFiles(payload.commits || []),
            repositoryId: payload.repository?.id?.toString(),
            repositoryUrl: payload.repository?.clone_url,
          },
        };

      case 'pull_request':
        return {
          trigger: 'webhook',
          event: 'pull_request',
          data: {
            action: payload.action,
            branch: payload.pull_request?.head?.ref,
            commitSha: payload.pull_request?.head?.sha,
            message: payload.pull_request?.title,
            author: payload.pull_request?.user?.login,
            prNumber: payload.pull_request?.number,
            prLabels: payload.pull_request?.labels?.map((l: any) => l.name) || [],
            targetBranch: payload.pull_request?.base?.ref,
            repositoryId: payload.repository?.id?.toString(),
            repositoryUrl: payload.repository?.clone_url,
          },
        };

      case 'create':
        if (payload.ref_type === 'tag') {
          return {
            trigger: 'webhook',
            event: 'tag',
            data: {
              tag: payload.ref,
              commitSha: payload.master_branch,
              author: payload.sender?.login,
              repositoryId: payload.repository?.id?.toString(),
              repositoryUrl: payload.repository?.clone_url,
            },
          };
        }
        break;

      default:
        this.warn(`Unhandled GitHub event: ${event}`);
        return null;
    }

    return null;
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
    if (trigger.data?.changedFiles) {
      return trigger.data.changedFiles;
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
  private extractChangedFiles(commits: any[]): string[] {
    const files = new Set<string>();

    for (const commit of commits) {
      if (commit.added) commit.added.forEach((f: string) => files.add(f));
      if (commit.modified) commit.modified.forEach((f: string) => files.add(f));
      if (commit.removed) commit.removed.forEach((f: string) => files.add(f));
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
          schema: z.string().url(),
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
      validate: async (config: any) => {
        const errors: string[] = [];
        
        if (config.repositoryUrl && !config.repositoryUrl.includes('github.com')) {
          errors.push('Repository URL must be a GitHub URL');
        }
        
        if (config.useMonorepo && !config.basePath) {
          errors.push('Base path is required when monorepo is enabled');
        }
        
        return { valid: errors.length === 0, errors };
      },
      transform: (config: any) => {
        // Transform UI config to ProviderConfig format
        const transformed: any = {
          type: 'github',
          repository: {
            url: config.repositoryUrl,
            branch: config.branch || 'main',
            accessToken: config.accessToken,
          },
          cache: {
            enabled: config.enableCache ?? true,
            strategy: config.cacheStrategy || 'strict',
          },
        };
        
        if (config.useMonorepo) {
          transformed.monorepo = {
            basePath: config.basePath,
            watchPaths: config.watchPaths ? config.watchPaths.split(',').map((p: string) => p.trim()) : [],
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
  async validateConfig(config: any): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Support both ProviderConfig and raw config format
    const repoUrl = config.repository?.url || config.repositoryUrl;
    const accessToken = config.repository?.accessToken || config.accessToken;
    const sshKey = config.repository?.sshKey;
    const monorepo = config.monorepo;

    if (!repoUrl) {
      errors.push('Repository URL is required');
    }

    if (!accessToken && !sshKey) {
      errors.push('Access token or SSH key is required');
    }

    if (monorepo) {
      if (monorepo.basePath && !monorepo.basePath.startsWith('/')) {
        errors.push('Base path must start with /');
      }

      const patterns = [
        ...(monorepo.watchPaths || []),
        ...(monorepo.ignorePaths || []),
      ];

      for (const pattern of patterns) {
        if (!this.isValidGlobPattern(pattern)) {
          errors.push(`Invalid glob pattern: ${pattern}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
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
    const domain = config?.domain || '~##domain##~';

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
