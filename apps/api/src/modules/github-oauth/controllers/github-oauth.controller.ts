import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Res,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import type { Response } from 'express'
import { App } from '@octokit/app'
import { GitHubService } from '@/core/modules/github/services/github.service'
import { GithubProviderService } from '@/core/modules/providers/github/github-provider.service'

/**
 * GitHub App Credentials DTO
 */
export interface GitHubAppCredentialsDto {
  appId: string
  appSlug: string
  privateKey: string
  clientId?: string
  clientSecret?: string
  webhookSecret?: string
}

/**
 * Controller for GitHub OAuth flow and installation management
 * 
 * Multi-Tenant Architecture:
 * - Each organization can have its own GitHub App
 * - Credentials are stored in database per installation
 * - No environment variables required for app credentials
 * 
 * Installation Flow:
 * 1. POST /github/installations/setup - User provides GitHub App credentials
 * 2. GET /github/install/:appSlug - Redirect to GitHub App installation page
 * 3. GitHub redirects to GET /github/callback with installation_id
 * 4. System stores installation with credentials in database
 * 5. System registers installation with GitHubService
 * 6. System syncs repositories
 * 7. Redirect to dashboard
 */
@Controller('github')
export class GitHubOAuthController {
  private readonly logger = new Logger(GitHubOAuthController.name)

  // Temporary in-memory store for credentials during OAuth flow
  // TODO: Replace with Redis or secure session storage in production
  private readonly credentialsStore = new Map<string, GitHubAppCredentialsDto>()

  constructor(
    private readonly githubService: GitHubService,
    private readonly githubProviderService: GithubProviderService,
  ) {}

  /**
   * Step 1: Setup GitHub App credentials (before installation)
   * Store credentials temporarily that will be used during installation flow
   * 
   * @param body GitHub App credentials
   * @returns Setup token and installation URL
   */
  @Post('installations/setup')
  async setupGitHubApp(@Body() body: GitHubAppCredentialsDto) {
    this.logger.log(`Setting up GitHub App: ${body.appId}`)

    // Validate required credentials
    if (!body.appId || !body.privateKey || !body.appSlug) {
      throw new BadRequestException('appId, appSlug, and privateKey are required')
    }

    // Validate private key format
    if (!body.privateKey.includes('BEGIN RSA PRIVATE KEY') && !body.privateKey.includes('BEGIN PRIVATE KEY')) {
      throw new BadRequestException('Invalid private key format. Must be PEM format.')
    }

    // Generate a secure token for this setup session
    const setupToken = `setup_${body.appId}_${Date.now()}_${Math.random().toString(36).substring(7)}`
    
    // Store credentials temporarily (expires in 10 minutes)
    this.credentialsStore.set(setupToken, body)
    setTimeout(() => {
      this.credentialsStore.delete(setupToken)
      this.logger.log(`Setup token expired and deleted: ${setupToken}`)
    }, 10 * 60 * 1000)

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    const installUrl = `${apiUrl}/github/install/${body.appSlug}?token=${setupToken}`

    return {
      success: true,
      message: 'GitHub App credentials stored. Proceed with installation.',
      setupToken,
      installUrl,
      expiresIn: '10 minutes',
      nextSteps: [
        'Visit the installUrl to start the GitHub App installation',
        'GitHub will redirect you back after installation',
        'Your credentials will be stored securely in the database',
      ],
    }
  }

  /**
   * Step 2: Start GitHub App installation flow
   * Redirects user to GitHub App installation page
   * 
   * @param appSlug GitHub App slug (e.g., "my-deployer-app")
   * @param token Setup token from previous step
   * @param organizationLogin Optional: pre-select organization
   * @returns Redirect to GitHub App installation URL
   */
  @Get('install/:appSlug')
  async installApp(
    @Param('appSlug') appSlug: string,
    @Query('token') token: string,
    @Query('organizationLogin') organizationLogin: string,
    @Res() res: Response,
  ) {
    this.logger.log(`Initiating GitHub App installation for app: ${appSlug}`)

    if (!token) {
      throw new BadRequestException(
        'Setup token is required. Call POST /github/installations/setup first.',
      )
    }

    // Retrieve credentials from temporary store
    const credentials = this.credentialsStore.get(token)
    if (!credentials) {
      throw new BadRequestException(
        'Invalid or expired setup token. Please call POST /github/installations/setup again.',
      )
    }

    if (credentials.appSlug !== appSlug) {
      throw new BadRequestException('App slug does not match setup credentials')
    }

    // Build callback URL with setup token
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    const callbackUrl = new URL(`${apiUrl}/github/callback`)
    callbackUrl.searchParams.set('token', token)
    
    if (organizationLogin) {
      callbackUrl.searchParams.set('organizationLogin', organizationLogin)
    }

    // Redirect to GitHub App installation page
    const installUrl = `https://github.com/apps/${appSlug}/installations/new`
    const redirectUrl = `${installUrl}?state=${encodeURIComponent(callbackUrl.toString())}`

    this.logger.log(`Redirecting to GitHub App installation: ${installUrl}`)
    return res.redirect(redirectUrl)
  }

  /**
   * Step 3: Handle GitHub OAuth callback after app installation
   * This is called by GitHub after user installs the app
   * 
   * @param installationId Installation ID from GitHub
   * @param setupAction Setup action (install, update, etc.)
   * @param state Callback state containing setup token
   * @returns Redirect to dashboard with installation details
   */
  @Get('callback')
  async handleCallback(
    @Query('installation_id') installationId: string,
    @Query('setup_action') setupAction: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      this.logger.log(
        `GitHub callback received - Installation ID: ${installationId}, Setup Action: ${setupAction}`,
      )

      if (!installationId) {
        throw new BadRequestException('installation_id is required')
      }

      if (!state) {
        throw new BadRequestException('state parameter is required')
      }

      // Parse state parameter to extract setup token
      const stateUrl = new URL(state)
      const token = stateUrl.searchParams.get('token')
      const organizationLoginHint = stateUrl.searchParams.get('organizationLogin')

      if (!token) {
        throw new BadRequestException('Setup token not found in callback state')
      }

      // Retrieve credentials from temporary store
      const credentials = this.credentialsStore.get(token)
      if (!credentials) {
        throw new BadRequestException(
          'Invalid or expired setup token. Installation may have succeeded but credentials were not saved.',
        )
      }

      this.logger.log(`Using credentials for app: ${credentials.appId}`)

      // Create GitHub App instance with provided credentials
      const app = new App({
        appId: credentials.appId,
        privateKey: credentials.privateKey,
      })

      // Get Octokit instance for this installation
      const octokit = await app.getInstallationOctokit(parseInt(installationId, 10))

      // Fetch installation details from GitHub
      const { data: installation } = await octokit.request('GET /app/installations/{installation_id}', {
        installation_id: parseInt(installationId, 10),
      })

      // Extract organization information
      const account = installation.account
      if (!account) {
        throw new NotFoundException('Installation account not found')
      }

      const organizationLogin =
        'login' in account
          ? account.login
          : organizationLoginHint || `org_${installation.id}`

      const accountType = 'type' in account ? account.type : 'Organization'

      this.logger.log(`Processing installation for organization: ${organizationLogin}`)

      // Check if installation already exists
      const existingInstallation =
        await this.githubProviderService.getInstallationByOrganization(organizationLogin)

      let storedInstallationId: string

      if (existingInstallation) {
        // Update existing installation with new credentials
        this.logger.log(`Updating existing installation for ${organizationLogin}`)

        await this.githubProviderService.updateInstallation({
          id: existingInstallation.id,
          installationId: parseInt(installationId, 10),
          accountType,
          accountAvatarUrl: account.avatar_url,
          permissions: installation.permissions as any,
          htmlUrl: installation.html_url,
          appId: credentials.appId,
          privateKey: credentials.privateKey,
          clientId: credentials.clientId || null,
          clientSecret: credentials.clientSecret || null,
          webhookSecret: credentials.webhookSecret || null,
          updatedAt: new Date(),
        })

        storedInstallationId = existingInstallation.id
      } else {
        // Create new installation
        this.logger.log(`Creating new installation for ${organizationLogin}`)

        storedInstallationId = await this.githubProviderService.storeInstallation({
          userId: 'system', // TODO: Get from authenticated user session
          installationId: parseInt(installationId, 10),
          organizationLogin,
          accountLogin: organizationLogin,
          accountType,
          accountAvatarUrl: account.avatar_url,
          permissions: installation.permissions as any,
          htmlUrl: installation.html_url,
          appId: credentials.appId,
          privateKey: credentials.privateKey,
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          webhookSecret: credentials.webhookSecret,
        })
      }

      // Register installation with GitHubService (loads from database)
      const registered = await this.githubProviderService.getInstallationByOrganization(
        organizationLogin,
      )

      if (registered && registered.appId && registered.privateKey) {
        await this.githubService.registerInstallation(organizationLogin, {
          appId: registered.appId,
          privateKey: registered.privateKey,
          clientId: registered.clientId || undefined,
          clientSecret: registered.clientSecret || undefined,
          webhookSecret: registered.webhookSecret || undefined,
        })
        this.logger.log(`Registered installation with GitHubService: ${organizationLogin}`)
      }

      // Sync repositories
      const syncedCount = await this.syncRepositories(organizationLogin, octokit, storedInstallationId)
      this.logger.log(`Synced ${syncedCount} repositories for ${organizationLogin}`)

      // Clean up credentials from temporary store
      this.credentialsStore.delete(token)
      this.logger.log(`Cleaned up setup token: ${token}`)

      // Redirect to dashboard or success page
      const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const redirectTarget = `${dashboardUrl}/dashboard?installation=${organizationLogin}&status=success&synced=${syncedCount}`

      this.logger.log(`Installation complete. Redirecting to: ${redirectTarget}`)
      return res.redirect(redirectTarget)
    } catch (error) {
      this.logger.error('GitHub OAuth callback failed', error)

      const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during installation'
      const errorRedirect = `${dashboardUrl}/dashboard?status=error&message=${encodeURIComponent(errorMessage)}`

      return res.redirect(errorRedirect)
    }
  }

  /**
   * Get all GitHub installations for current user
   * @returns List of installations
   */
  @Get('installations')
  async getInstallations() {
    // TODO: Filter by authenticated user
    const installations = await this.githubProviderService.getUserInstallations('system')

    return {
      total: installations.length,
      installations: installations.map((inst) => ({
        id: inst.id,
        installationId: inst.installationId,
        organizationLogin: inst.organizationId,
        name: inst.name,
        appId: inst.appId,
        isActive: inst.isActive,
        createdAt: inst.createdAt,
        hasCredentials: !!(inst.appId && inst.privateKey),
        hasWebhookSecret: !!inst.webhookSecret,
      })),
    }
  }

  /**
   * Get specific installation details
   * @param organizationLogin Organization login
   * @returns Installation details (without sensitive credentials)
   */
  @Get('installations/:organizationLogin')
  async getInstallation(@Param('organizationLogin') organizationLogin: string) {
    const installation =
      await this.githubProviderService.getInstallationByOrganization(organizationLogin)

    if (!installation) {
      throw new NotFoundException(
        `GitHub installation not found for organization: ${organizationLogin}`,
      )
    }

    // Don't expose sensitive credentials in API responses
    return {
      id: installation.id,
      installationId: installation.installationId,
      organizationLogin: installation.organizationId,
      name: installation.name,
      appId: installation.appId,
      isActive: installation.isActive,
      createdAt: installation.createdAt,
      hasCredentials: !!(installation.appId && installation.privateKey),
      hasWebhookSecret: !!installation.webhookSecret,
    }
  }

  /**
   * Sync repositories for an installation
   * @param organizationLogin Organization login
   * @returns Sync result
   */
  @Get('installations/:organizationLogin/sync')
  async syncInstallationRepositories(@Param('organizationLogin') organizationLogin: string) {
    const installation =
      await this.githubProviderService.getInstallationByOrganization(organizationLogin)

    if (!installation) {
      throw new NotFoundException(
        `GitHub installation not found for organization: ${organizationLogin}`,
      )
    }

    if (!installation.appId || !installation.privateKey) {
      throw new BadRequestException(
        `GitHub App credentials not configured for organization: ${organizationLogin}`,
      )
    }

    // Create App instance with stored credentials
    const app = new App({
      appId: installation.appId,
      privateKey: installation.privateKey,
    })

    const octokit = await app.getInstallationOctokit(
      installation.installationId ? parseInt(installation.installationId, 10) : 0
    )

    const syncedCount = await this.syncRepositories(
      organizationLogin,
      octokit,
      installation.id,
    )

    return {
      success: true,
      message: 'Repositories synced successfully',
      organizationLogin,
      syncedCount,
      syncedAt: new Date(),
    }
  }

  /**
   * Delete installation and revoke access
   * @param organizationLogin Organization login
   * @returns Deletion confirmation
   */
  @Get('installations/:organizationLogin/delete')
  async deleteInstallation(
    @Param('organizationLogin') organizationLogin: string,
    @Res() res: Response,
  ) {
    const installation =
      await this.githubProviderService.getInstallationByOrganization(organizationLogin)

    if (!installation) {
      throw new NotFoundException(
        `GitHub installation not found for organization: ${organizationLogin}`,
      )
    }

    // TODO: Implement deletion logic
    // 1. Unregister from GitHubService
    // 2. Delete all repositories
    // 3. Delete installation record
    // 4. Optionally revoke access on GitHub

    this.logger.log(`Installation deletion requested for ${organizationLogin}`)

    const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return res.redirect(
      `${dashboardUrl}/dashboard?message=${encodeURIComponent('Installation deletion not yet implemented')}`,
    )
  }

  /**
   * Private helper to sync repositories from GitHub API
   * @param organizationLogin Organization login
   * @param octokit Authenticated Octokit instance
   * @param installationId Database installation ID
   * @returns Number of repositories synced
   */
  private async syncRepositories(
    organizationLogin: string,
    octokit: any,
    installationId: string,
  ): Promise<number> {
    this.logger.log(`Syncing repositories for ${organizationLogin}`)

    try {
      // Fetch all repositories accessible to this installation
      const { data: response } = await octokit.request('GET /installation/repositories', {
        per_page: 100,
      })

      const repositories = response.repositories || []

      this.logger.log(`Found ${repositories.length} repositories for ${organizationLogin}`)

      // Store each repository
      for (const repo of repositories) {
        await this.githubProviderService.storeRepository({
          id: crypto.randomUUID(),
          repositoryId: repo.id,
          installationId,
          name: repo.name,
          fullName: repo.full_name,
          private: repo.private,
          htmlUrl: repo.html_url,
          description: repo.description,
          defaultBranch: repo.default_branch,
          language: repo.language,
          stargazersCount: repo.stargazers_count,
          forksCount: repo.forks_count,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }

      this.logger.log(`Successfully synced ${repositories.length} repositories for ${organizationLogin}`)
      return repositories.length
    } catch (error) {
      this.logger.error(`Failed to sync repositories for ${organizationLogin}`, error)
      throw error
    }
  }
}
