import { Injectable, Logger } from '@nestjs/common'
import { Octokit } from '@octokit/rest'
import { App } from '@octokit/app'
import { Webhooks } from '@octokit/webhooks'
import { EnvService } from '@/config/env/env.service'

interface GitHubAppConfig {
  appId: string
  privateKey: string
  clientId?: string
  clientSecret?: string
  webhookSecret?: string
}

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name)
  private readonly webhooks: Webhooks
  private readonly apps: Map<string, App> = new Map() // Cache apps by organization login
  private readonly octokit: Octokit
  private readonly defaultWebhookSecret: string

  constructor(private readonly envService: EnvService) {
    // Initialize Webhooks with fallback secret for signature verification
    // Each installation can have its own webhook secret stored in database
    this.defaultWebhookSecret = this.envService.get('GITHUB_WEBHOOK_SECRET') || 'fallback-secret-change-in-production'
    this.webhooks = new Webhooks({ secret: this.defaultWebhookSecret })

    // Initialize basic Octokit client (without authentication for public operations)
    this.octokit = new Octokit()
    
    this.logger.log('GitHub Service initialized - ready to manage multiple GitHub App installations from database')
  }

  /**
   * Create and cache a GitHub App instance for a specific organization
   */
  private createApp(config: GitHubAppConfig): App {
    const app = new App({
      appId: config.appId,
      privateKey: config.privateKey.replace(/\\n/g, '\n'), // Handle escaped newlines
      oauth: config.clientId && config.clientSecret ? {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      } : undefined,
      webhooks: config.webhookSecret ? {
        secret: config.webhookSecret,
      } : undefined,
    })
    
    return app
  }

  /**
   * Register a GitHub App installation for an organization
   */
  registerInstallation(organizationLogin: string, config: GitHubAppConfig): void {
    try {
      const app = this.createApp(config)
      this.apps.set(organizationLogin, app)
      this.logger.log(`Registered GitHub App for organization: ${organizationLogin}`)
    } catch (error) {
      this.logger.error(`Failed to register GitHub App for ${organizationLogin}:`, error)
      throw error
    }
  }

  /**
   * Get GitHub App instance for a specific organization
   */
  getAppForOrganization(organizationLogin: string): App {
    const app = this.apps.get(organizationLogin)
    if (!app) {
      throw new Error(`GitHub App not registered for organization: ${organizationLogin}`)
    }
    return app
  }

  /**
   * Check if an organization has a registered GitHub App
   */
  hasAppForOrganization(organizationLogin: string): boolean {
    return this.apps.has(organizationLogin)
  }

  /**
   * Unregister a GitHub App installation
   */
  unregisterInstallation(organizationLogin: string): void {
    this.apps.delete(organizationLogin)
    this.logger.log(`Unregistered GitHub App for organization: ${organizationLogin}`)
  }

  /**
   * Get all registered organizations
   */
  getRegisteredOrganizations(): string[] {
    return Array.from(this.apps.keys())
  }

  /**
   * Verify GitHub webhook signature
   * Uses default webhook secret or organization-specific secret if provided
   */
  async verifyWebhookSignature(payload: string, signature: string, webhookSecret?: string): Promise<boolean> {
    try {
      const secret = webhookSecret || this.defaultWebhookSecret
      const webhooksInstance = new Webhooks({ secret })
      return await webhooksInstance.verify(payload, signature)
    } catch (error) {
      this.logger.error('Webhook signature verification failed', error)
      return false
    }
  }

  /**
   * Get an Octokit instance authenticated for a specific installation
   */
  async getInstallationOctokit(organizationLogin: string, installationId: number): Promise<any> {
    const app = this.getAppForOrganization(organizationLogin)
    return await app.getInstallationOctokit(installationId)
  }

  /**
   * Get Octokit instance authenticated with personal access token
   */
  getOctokitWithToken(token: string): Octokit {
    return new Octokit({ auth: token })
  }

  /**
   * Get unauthenticated Octokit instance (for public API calls)
   */
  getPublicOctokit(): Octokit {
    return this.octokit
  }

  /**
   * Get GitHub App instance for a specific organization
   */
  getApp(organizationLogin: string): App {
    return this.getAppForOrganization(organizationLogin)
  }

  /**
   * Get webhooks handler instance
   */
  getWebhooks(): Webhooks {
    return this.webhooks
  }

  /**
   * Exchange OAuth code for access token
   */
  async exchangeCodeForToken(organizationLogin: string, code: string): Promise<{
    access_token: string
    token_type: string
    scope: string
  }> {
    const app = this.getAppForOrganization(organizationLogin)
    const { authentication } = await app.oauth.createToken({ code })
    return {
      access_token: authentication.token,
      token_type: authentication.tokenType,
      scope: (authentication as any).scopes?.join(',') || '',
    }
  }

  /**
   * Get installation access token
   */
  async getInstallationAccessToken(organizationLogin: string, installationId: number): Promise<string> {
    const octokit = await this.getInstallationOctokit(organizationLogin, installationId)
    const { data } = await octokit.apps.createInstallationAccessToken({
      installation_id: installationId,
    })

    return data.token
  }

  /**
   * List repositories accessible by installation
   */
  async listInstallationRepositories(organizationLogin: string, installationId: number): Promise<Array<{
    id: number
    name: string
    full_name: string
    private: boolean
    description: string | null
    html_url: string
    default_branch: string
    language: string | null
    stargazers_count: number
    forks_count: number
  }>> {
    const octokit = await this.getInstallationOctokit(organizationLogin, installationId)
    
    const repositories: any[] = []
    let page = 1
    let hasMore = true

    while (hasMore) {
      const { data } = await octokit.apps.listReposAccessibleToInstallation({
        per_page: 100,
        page,
      })

      repositories.push(...data.repositories)
      hasMore = data.repositories.length === 100
      page++
    }

    return repositories.map(repo => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      description: repo.description,
      html_url: repo.html_url,
      default_branch: repo.default_branch,
      language: repo.language,
      stargazers_count: repo.stargazers_count,
      forks_count: repo.forks_count,
    }))
  }

  /**
   * Get repository information
   */
  async getRepository(owner: string, repo: string, organizationLogin?: string, installationId?: number): Promise<{
    id: number
    name: string
    full_name: string
    private: boolean
    description: string | null
    html_url: string
    default_branch: string
    language: string | null
    stargazers_count: number
    forks_count: number
  }> {
    const octokit = (installationId && organizationLogin)
      ? await this.getInstallationOctokit(organizationLogin, installationId)
      : this.octokit

    const { data } = await octokit.repos.get({ owner, repo })

    return {
      id: data.id,
      name: data.name,
      full_name: data.full_name,
      private: data.private,
      description: data.description,
      html_url: data.html_url,
      default_branch: data.default_branch,
      language: data.language,
      stargazers_count: data.stargazers_count,
      forks_count: data.forks_count,
    }
  }

  /**
   * Get installation by ID
   */
  async getInstallation(organizationLogin: string, installationId: number): Promise<{
    id: number
    account: {
      login: string
      type: string
      avatar_url: string
    }
    repository_selection: string
    permissions: Record<string, string>
    events: string[]
    created_at: string
    updated_at: string
  }> {
    const octokit = await this.getInstallationOctokit(organizationLogin, installationId)
    const { data } = await (octokit as any).rest.apps.getInstallation({ installation_id: installationId })

    return {
      id: data.id,
      account: {
        login: data.account!.login,
        type: data.account!.type!,
        avatar_url: data.account!.avatar_url,
      },
      repository_selection: data.repository_selection,
      permissions: data.permissions as Record<string, string>,
      events: data.events,
      created_at: data.created_at,
      updated_at: data.updated_at,
    }
  }

  /**
   * Get commit information
   */
  async getCommit(
    owner: string,
    repo: string,
    sha: string,
    organizationLogin?: string,
    installationId?: number
  ): Promise<{
    sha: string
    message: string
    author: {
      name: string
      email: string
      date: string
    }
    url: string
  }> {
    const octokit = (installationId && organizationLogin)
      ? await this.getInstallationOctokit(organizationLogin, installationId)
      : this.octokit

    const { data } = await octokit.repos.getCommit({ owner, repo, ref: sha })

    return {
      sha: data.sha,
      message: data.commit.message,
      author: {
        name: data.commit.author?.name || 'Unknown',
        email: data.commit.author?.email || 'unknown@email.com',
        date: data.commit.author?.date || new Date().toISOString(),
      },
      url: data.html_url,
    }
  }

  /**
   * Create a deployment status
   */
  async createDeploymentStatus(
    owner: string,
    repo: string,
    deploymentId: number,
    state: 'error' | 'failure' | 'inactive' | 'in_progress' | 'queued' | 'pending' | 'success',
    organizationLogin: string,
    installationId: number,
    options?: {
      description?: string
      environment_url?: string
      log_url?: string
    }
  ): Promise<void> {
    const octokit = await this.getInstallationOctokit(organizationLogin, installationId)
    
    await octokit.repos.createDeploymentStatus({
      owner,
      repo,
      deployment_id: deploymentId,
      state,
      description: options?.description,
      environment_url: options?.environment_url,
      log_url: options?.log_url,
    })
  }
}
