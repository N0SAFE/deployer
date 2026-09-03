import { AppError } from "@repo/errors";
import { Injectable, Logger } from '@nestjs/common'
import { Octokit } from '@octokit/rest'
import { App } from '@octokit/app'
import { Webhooks } from '@octokit/webhooks'
import z from 'zod/v4'

/**
 * Minimal `@octokit/core` client returned by `App.getInstallationOctokit()` —
 * it has no `rest.*` namespaces; callers must use `octokit.request()` with the
 * raw endpoint. Derived from the App class so no direct `@octokit/core`
 * dependency is required.
 */
type InstallationOctokit = Awaited<ReturnType<InstanceType<typeof App>['getInstallationOctokit']>>

interface GitHubAppConfig {
  appId: string
  privateKey: string
  clientId?: string
  clientSecret?: string
  webhookSecret?: string
}

/**
 * Repository data structure from GitHub API
 */
interface GitHubRepository {
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
}

/**
 * Zod schema for the GitHub App Manifest conversion response
 * (POST /app-manifests/{code}/conversions). The response crosses a trust
 * boundary — this schema makes the field nullability explicit so the
 * downstream types are truthful.
 */
const githubManifestResponseSchema = z.object({
  id: z.number(),
  slug: z.string().optional().default(''),
  name: z.string().optional().default(''),
  client_id: z.string().optional().default(''),
  client_secret: z.string().optional().default(''),
  pem: z.string().optional().default(''),
  webhook_secret: z.string().optional().default(''),
  html_url: z.string().optional().default(''),
})

// ─── Runner-detection response schemas (octokit crosses a trust boundary) ──

/** Entry of `GET /repos/{owner}/{repo}/contents/{path}` (root listing). */
const githubContentEntrySchema = z.object({ name: z.string().optional() }).loose()

/** Entry of `GET /repos/{owner}/{repo}/git/trees/{tree_sha}`. */
const githubTreeEntrySchema = z
  .object({
    path: z.string().optional(),
    type: z.string().optional(),
  })
  .loose()

/** Body of `GET /repos/{owner}/{repo}/contents/{path}` for a single file. */
const githubFileContentSchema = z.object({ content: z.string().nullish() }).loose()

/**
 * Octokit types entity ids as `number | bigint` (union across response kinds),
 * but the wire payload is always a JSON number. Parse — never cast.
 */
const githubNumericIdSchema = z.number()

/**
 * Installation account information
 */
interface GitHubInstallationAccount {
  login: string
  type: string
  avatar_url: string
}

/**
 * Installation data structure
 */
interface GitHubInstallation {
  id: number
  account: GitHubInstallationAccount
  repository_selection: string
  permissions: Record<string, string>
  events: string[]
  created_at: string
  updated_at: string
}

/**
 * Commit author information
 */
interface GitHubCommitAuthor {
  name: string
  email: string
  date: string
}

/**
 * Commit data structure
 */
interface GitHubCommitInfo {
  sha: string
  message: string
  author: GitHubCommitAuthor
  url: string
}

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name)
  private readonly apps = new Map<string, App>() // Cache apps by organization login
  private readonly octokit: Octokit

  constructor() {
    // Credentials (appId, privateKey, webhookSecret, etc.) are stored per-organization
    // in the database (githubApps table). Use registerInstallation() with DB-loaded config.
    this.octokit = new Octokit()
    this.logger.log('GitHub Service initialized - credentials are loaded per-organization from database')
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
      throw new AppError(`GitHub App not registered for organization: ${organizationLogin}`, `INTERNAL_ERROR`)
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
   * Verify GitHub webhook signature using the organization's secret from the database.
   */
  async verifyWebhookSignature(payload: string, signature: string, webhookSecret: string): Promise<boolean> {
    try {
      return await new Webhooks({ secret: webhookSecret }).verify(payload, signature)
    } catch (error) {
      this.logger.error('Webhook signature verification failed', error)
      return false
    }
  }

  /**
   * Get an Octokit instance authenticated for a specific installation.
   *
   * `app.getInstallationOctokit()` returns a MINIMAL `@octokit/core` client —
   * it has no `rest.*` namespaces. Callers must use `octokit.request()` with
   * the raw endpoint (see listInstallationRepositories).
   */
  async getInstallationOctokit(organizationLogin: string, installationId: number): Promise<InstallationOctokit> {
    const app = this.getAppForOrganization(organizationLogin)
    return app.getInstallationOctokit(installationId)
  }

  /**
   * List the installations of a registered GitHub App using its App
   * credentials (GET /app/installations). Returns `{ id, accountLogin }`
   * for each installation — used to (re)discover the installation id when
   * the DB row has none (e.g. before the installation webhook was wired).
   */
  async listInstallations(organizationLogin: string): Promise<{ id: number; accountLogin: string; accountType: string }[]> {
    const app = this.getAppForOrganization(organizationLogin)
    const result: { id: number; accountLogin: string; accountType: string }[] = []
    await app.eachInstallation(({ installation }) => {
      const account = (installation as { account?: { login?: string; type?: string } }).account
      result.push({
        id: installation.id,
        accountLogin: account?.login ?? '',
        accountType: account?.type ?? '',
      })
    })
    return result
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
   * Create a Webhooks handler for an organization using its secret from the database.
   */
  createWebhooks(webhookSecret: string): Webhooks {
    return new Webhooks({ secret: webhookSecret })
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
    const authData = authentication as { token: string; tokenType: string; scopes?: string[] }
    return {
      access_token: authData.token,
      token_type: authData.tokenType,
      scope: authData.scopes?.join(',') ?? '',
    }
  }

  /**
   * Exchange a GitHub App Manifest code for app credentials.
   * Uses Octokit's REST endpoint POST /app-manifests/{code}/conversions
   * Returns the full app configuration including appId, slug, pem, clientId, clientSecret, webhookSecret.
   */
  async createFromManifestCode(code: string): Promise<{
    id: number
    slug: string
    name: string
    client_id: string
    client_secret: string
    pem: string
    webhook_secret: string
    html_url: string
  }> {
    // Use an unauthenticated Octokit instance (the manifest code API is public)
    const octokit = new Octokit()
    const { data } = await octokit.rest.apps.createFromManifest({ code })
    // GitHub's response crosses a trust boundary — validate it with Zod so the
    // types below are truthful regardless of octokit's nullable inconsistencies.
    const parsed = githubManifestResponseSchema.parse(data)
    return {
      id: parsed.id,
      slug: parsed.slug,
      name: parsed.name,
      client_id: parsed.client_id,
      client_secret: parsed.client_secret,
      pem: parsed.pem,
      webhook_secret: parsed.webhook_secret,
      html_url: parsed.html_url,
    }
  }

  /**
   * Get installation access token
   */
  async getInstallationAccessToken(organizationLogin: string, installationId: number): Promise<string> {
    const octokit = await this.getInstallationOctokit(organizationLogin, installationId)
    const { data } = await octokit.request("POST /app/installations/{installation_id}/access_tokens", {
      installation_id: installationId,
    })
    return data.token
  }

  /**
   * List repositories accessible by installation
   *
   * NOTE: `app.getInstallationOctokit()` returns a MINIMAL `@octokit/core`
   * client — it has no `apps.*` REST namespaces. Use `octokit.request()`
   * with the raw endpoint instead (works on any octokit instance).
   */
  async listInstallationRepositories(organizationLogin: string, installationId: number): Promise<GitHubRepository[]> {
    const octokit = await this.getInstallationOctokit(organizationLogin, installationId)

    const repositories: GitHubRepository[] = []
    let page = 1
    let hasMore = true

    while (hasMore) {
      const { data } = await octokit.request("GET /installation/repositories", {
        per_page: 100,
        page,
      })

      for (const repo of data.repositories) {
        repositories.push({
          id: githubNumericIdSchema.parse(repo.id),
          name: repo.name,
          full_name: repo.full_name,
          private: repo.private,
          description: repo.description ?? null,
          html_url: repo.html_url,
          default_branch: repo.default_branch,
          language: repo.language ?? null,
          stargazers_count: repo.stargazers_count,
          forks_count: repo.forks_count,
        })
      }
      hasMore = data.repositories.length === 100
      page++
    }

    return repositories
  }

  /**
   * List branches of a repository, authenticated as an installation.
   */
  async listRepositoryBranches(
    organizationLogin: string,
    installationId: number,
    owner: string,
    repo: string,
  ): Promise<{ name: string; sha: string; protected: boolean }[]> {
    const octokit = await this.getInstallationOctokit(organizationLogin, installationId)
    const branches: { name: string; sha: string; protected: boolean }[] = []
    let page = 1
    let hasMore = true

    while (hasMore) {
      const { data } = await octokit.request("GET /repos/{owner}/{repo}/branches", {
        owner,
        repo,
        per_page: 100,
        page,
      })
      for (const b of data) {
        branches.push({
          name: b.name,
          sha: b.commit.sha,
          protected: b.protected,
        })
      }
      hasMore = data.length === 100
      page++
    }

    return branches
  }

  /**
   * Get repository information
   */
  async getRepository(owner: string, repo: string, organizationLogin?: string, installationId?: number): Promise<GitHubRepository> {
    const octokit = (installationId && organizationLogin)
      ? await this.getInstallationOctokit(organizationLogin, installationId)
      : this.octokit

    const { data } = await octokit.request("GET /repos/{owner}/{repo}", { owner, repo })

    return {
      id: githubNumericIdSchema.parse(data.id),
      name: data.name,
      full_name: data.full_name,
      private: data.private,
      description: data.description ?? null,
      html_url: data.html_url,
      default_branch: data.default_branch,
      language: data.language ?? null,
      stargazers_count: data.stargazers_count,
      forks_count: data.forks_count,
    }
  }

  /**
   * Get installation by ID
   */
  async getInstallation(organizationLogin: string, installationId: number): Promise<GitHubInstallation> {
    const octokit = await this.getInstallationOctokit(organizationLogin, installationId)
    const { data } = await octokit.request("GET /app/installations/{installation_id}", { installation_id: installationId })

    // data.account can be a User or an Enterprise - handle both cases
    const account = data.account
    const accountLogin = account && 'login' in account ? account.login : (account && 'slug' in account ? account.slug : 'unknown')
    const accountType = account && 'type' in account ? account.type : 'Enterprise'
    const accountAvatarUrl = account?.avatar_url ?? ''

    return {
      id: data.id,
      account: {
        login: accountLogin,
        type: accountType,
        avatar_url: accountAvatarUrl,
      },
      repository_selection: data.repository_selection,
      permissions: data.permissions,
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
  ): Promise<GitHubCommitInfo> {
    const octokit = (installationId && organizationLogin)
      ? await this.getInstallationOctokit(organizationLogin, installationId)
      : this.octokit

    const { data } = await octokit.request("GET /repos/{owner}/{repo}/commits/{ref}", { owner, repo, ref: sha })

    return {
      sha: data.sha,
      message: data.commit.message,
      author: {
        name: data.commit.author?.name ?? 'Unknown',
        email: data.commit.author?.email ?? 'unknown@email.com',
        date: data.commit.author?.date ?? new Date().toISOString(),
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

    await octokit.request("POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses", {
      owner,
      repo,
      deployment_id: deploymentId,
      state,
      description: options?.description,
      environment_url: options?.environment_url,
      log_url: options?.log_url,
    })
  }

  /**
   * List repository contents (root listing) — used by runner detection.
   * Works on the minimal installation octokit via octokit.request().
   */
  async listRepositoryRoot(organizationLogin: string, installationId: number, owner: string, repo: string): Promise<string[]> {
    const octokit = await this.getInstallationOctokit(organizationLogin, installationId)
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner,
      repo,
      path: "",
    })
    const files = Array.isArray(data) ? data : [data]
    // Shape validation through Zod — never cast-based field access.
    const parsed = z.array(githubContentEntrySchema).safeParse(files)
    if (!parsed.success) return []
    return parsed.data.map((f) => f.name ?? "")
  }

  /**
   * Recursively list ALL file paths in a repository via the git trees API
   * (`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`). Returns
   * paths like `docker/compose/docker-compose.prod.yml`. Falls back to
   * walking the root listing when the tree API fails (e.g. empty repos).
   * Used by runner detection to find compose files anywhere in the repo.
   */
  async listRepositoryFiles(
    organizationLogin: string,
    installationId: number,
    owner: string,
    repo: string,
    branch = "HEAD",
  ): Promise<string[]> {
    const octokit = await this.getInstallationOctokit(organizationLogin, installationId)
    try {
      const { data } = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
        owner,
        repo,
        tree_sha: branch,
        recursive: "1",
      })
      const tree = z.array(githubTreeEntrySchema).safeParse(data.tree)
      if (!tree.success) return []
      const paths: string[] = []
      for (const entry of tree.data) {
        if (entry.type === "blob" && typeof entry.path === "string") paths.push(entry.path)
      }
      return paths
    } catch {
      // Fall back to the root listing only (can't recurse without the tree API).
      return this.listRepositoryRoot(organizationLogin, installationId, owner, repo)
    }
  }

  /**
   * Fetch a single file's decoded content from a repository (base64).
   * Returns `null` when the file doesn't exist or is a submodule/directory.
   * Used by runner detection to inspect package.json, Dockerfile, compose, etc.
   */
  async getRepositoryFileContent(
    organizationLogin: string,
    installationId: number,
    owner: string,
    repo: string,
    path: string,
  ): Promise<string | null> {
    const octokit = await this.getInstallationOctokit(organizationLogin, installationId)
    try {
      const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner,
        repo,
        path,
      })
      if (Array.isArray(data)) return null
      // Shape validation through Zod — never cast-based field access.
      const parsed = githubFileContentSchema.safeParse(data)
      const content = parsed.success ? parsed.data.content : null
      if (!content) return null
      return Buffer.from(content, "base64").toString("utf-8")
    } catch {
      return null
    }
  }
}
