import {
  Controller,
  Post,
  Body,
  Logger,
  Req,
  Res,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import type {
  PushEvent,
  PullRequestEvent,
  CreateEvent,
  ReleaseEvent,
  Schema as WebhookPayload,
} from '@octokit/webhooks-types'
import {
  isPushEvent,
  isPullRequestEvent,
  isCreateEvent,
  isReleaseEvent,
  type NormalizedGitHubEvent,
} from '@/core/modules/git/github'
import { GitHubService } from '@/core/modules/git/github'
import { GithubProviderService } from '@/core/modules/providers/github/github-provider.service'
import { StaticProviderService } from '@/core/modules/providers/static/static-provider.service'
import { DeploymentRulesService } from '@/core/modules/deployment/services/deployment-rules.service'
import { DeploymentService } from '@/core/modules/deployment/services/deployment.service'
import { GithubChangeDetectionService } from '@/core/modules/providers/github/services/github-change-detection.service'
import { GithubDeploymentCacheService } from '@/core/modules/providers/github/services/github-deployment-cache.service'
import { PreviewDeploymentService } from '@/core/modules/deployment/services/preview-deployment.service'
import { EnhancedDeploymentRulesService } from '@/core/modules/deployment/services/enhanced-deployment-rules.service'
import { GitHubRuleMatcherService } from '../services/github-rule-matcher.service'
import { ApiResponse } from '@nestjs/swagger'

@Controller('webhooks/github')
export class GitHubWebhookController {
  private readonly logger = new Logger(GitHubWebhookController.name)

  constructor(
    private readonly githubService: GitHubService,
    private readonly githubProviderService: GithubProviderService,
    private readonly staticProviderService: StaticProviderService,
    private readonly deploymentRulesService: DeploymentRulesService,
    private readonly deploymentService: DeploymentService,
    private readonly changeDetectionService: GithubChangeDetectionService,
    private readonly cacheService: GithubDeploymentCacheService,
    private readonly previewService: PreviewDeploymentService,
    private readonly enhancedRules: EnhancedDeploymentRulesService,
    private readonly ruleMatcher: GitHubRuleMatcherService,
  ) {}

  /**
   * POST /webhooks/github
   * Handle GitHub webhook events
   */
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
    @Post('webhooks/github')
  async handleWebhook(
    @Req() req: Request,
    @Body() payload: WebhookPayload,
    @Res() res: Response
  ) {
    try {
      if (!('installation' in payload) || !payload.installation || !('account' in payload.installation)) {
        this.logger.warn('Received invalid webhook payload');
        return res.status(400).json({ error: 'Invalid webhook payload' });
      }
      // Extract organization from webhook payload
      const organizationLogin = payload.installation.account.login;
      
      if (!organizationLogin) {
        this.logger.warn('Webhook received without organization context, skipping');
        return res.status(200).json({ message: 'Webhook received but no organization context' });
      }

      this.logger.log(`Processing webhook from organization: ${organizationLogin}`);

      // Get event type from headers
      const eventType = req.headers['x-github-event'] as string;
      const deliveryId = req.headers['x-github-delivery'] as string;

      this.logger.log(`Received GitHub webhook: ${eventType} (${deliveryId})`);

      // Load installation from database to get webhook secret
      const installation = await this.githubProviderService.getInstallationByOrganization(organizationLogin);
      
      if (!installation) {
        this.logger.warn(
          `Webhook received from unregistered organization: ${organizationLogin}. ` +
          `Please install the GitHub App for this organization.`
        );
        return res.status(200).json({ 
          message: 'Organization not registered',
          organizationLogin 
        });
      }

      // Ensure GitHub App is registered in GitHubService
      if (!this.githubService.hasAppForOrganization(organizationLogin)) {
        // Register the app if it has credentials
        if (installation.appId && installation.privateKey) {
          this.logger.log(`Auto-registering GitHub App for organization: ${organizationLogin}`);
          this.githubService.registerInstallation(organizationLogin, {
            appId: installation.appId,
            privateKey: installation.privateKey,
            clientId: installation.clientId || undefined,
            clientSecret: installation.clientSecret || undefined,
            webhookSecret: installation.webhookSecret || undefined,
          });
        } else {
          this.logger.error(`Installation for ${organizationLogin} has no credentials stored`);
          return res.status(400).json({ 
            error: 'GitHub App not configured for this organization',
            organizationLogin 
          });
        }
      }

      // Verify signature using installation-specific webhook secret
      const signature = req.headers['x-hub-signature-256'] as string;
      if (!signature) {
        this.logger.error('Missing signature header');
        return res.status(401).json({ error: 'Missing signature' });
      }

      try {
        // Use installation-specific webhook secret if available
        await this.githubService.verifyWebhookSignature(
          JSON.stringify(payload),
          signature,
          installation.webhookSecret || undefined // Pass per-installation secret
        );
      } catch (error) {
        this.logger.error('Invalid webhook signature:', error);
        return res.status(401).json({ error: 'Invalid signature' });
      }

      if (isPushEvent(eventType, payload)) {
        await this.handlePushEvent(payload, organizationLogin);
      } else if (isPullRequestEvent(eventType, payload)) {
        await this.handlePullRequestEvent(payload, organizationLogin);
      } else if (isCreateEvent(eventType, payload)) {
        await this.handleCreateEvent(payload, organizationLogin);
      } else if (isReleaseEvent(eventType, payload)) {
        await this.handleReleaseEvent(payload, organizationLogin);
      } else {
        this.logger.debug(`Unhandled event type: ${eventType}`);
      }

      return res.status(200).json({ message: 'Webhook processed' });
    } catch (error) {
      this.logger.error('Error handling GitHub webhook:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Handle push events (branch pushes)
   */
  private async handlePushEvent(payload: PushEvent, _organizationLogin: string) {
    // Extract branch name from ref
    const branch = payload.ref.replace('refs/heads/', '')

    // Normalize the event for rule matching
    const event: NormalizedGitHubEvent = {
      type: 'push',
      repository: {
        id: payload.repository.id,
        name: payload.repository.name,
        full_name: payload.repository.full_name,
        private: payload.repository.private,
        html_url: payload.repository.html_url,
        default_branch: payload.repository.default_branch,
      },
      ref: payload.ref,
      branch,
      before: payload.before,
      after: payload.after,
      commits: payload.commits.map(c => ({
        id: c.id,
        message: c.message,
        added: c.added,
        modified: c.modified,
        removed: c.removed,
      })),
      pusher: {
        name: payload.pusher.name,
        email: payload.pusher.email ?? undefined,
      },
      sender: {
        login: payload.sender.login,
        type: payload.sender.type,
      },
    }

    this.logger.log(`Push to ${event.repository.full_name}/${branch}`)

    // Find matching services and rules
    const matches = await this.ruleMatcher.findMatchesForEvent(event)

    if (matches.length === 0) {
      this.logger.debug(`No matching deployment rules for push to ${branch}`)
      return
    }

    // Trigger deployments for each match
    for (const match of matches) {
      try {
        this.logger.log(
          `Triggering deployment for service ${match.service.id} using rule "${match.rule.name}"`
        )

        // Run change detection per-match when possible to determine watched files
        let changedFiles: string[] = []
        try {
          const detection = await this.changeDetectionService.detectChanges(
            match.service.projectId,
            String(event.repository.id),
            {
              sha: event.after ?? '',
              message: '',
              author: event.pusher?.name ?? event.pusher?.email ?? 'unknown',
              date: new Date(),
              added: payload.commits.flatMap((c) => c.added),
              modified: payload.commits.flatMap((c) => c.modified),
              removed: payload.commits.flatMap((c) => c.removed),
            },
            undefined
          )
          changedFiles = detection.watchedFiles
        } catch (err) {
          this.logger.debug('Change detection failed for match, continuing with empty changedFiles', err)
        }

        // Evaluate enhanced rule conditions (path patterns / custom conditions)
        const evalResult = this.enhancedRules.evaluateRuleWithContext(match.rule, { changedFiles, event });
        if (!evalResult.matches) {
          this.logger.debug(`Rule ${match.rule.id} skipped: ${evalResult.reason}`)
          continue
        }

        // Check deployment cache to avoid duplicate/no-op deployments
        const cacheStrategy = match.service.repoConfig?.cacheStrategy ?? 'strict'
        const cacheCheck = await this.cacheService.shouldSkipDeployment(
          match.service.projectId,
          String(event.repository.id),
          match.deploymentConfig.branch ?? 'main',
          event.after ?? '',
          payload.commits.flatMap((c) => [...c.added, ...c.modified, ...c.removed]),
          changedFiles,
          cacheStrategy
        )
        if (cacheCheck.shouldSkip) {
          this.logger.log(`Skipping deployment due to cache: ${cacheCheck.reason}`)
          continue
        }

        // Create deployment record
        const deploymentId = await this.deploymentService.createDeployment({
          serviceId: match.service.id,
          sourceType: 'github',
          sourceConfig: {
            repositoryUrl: event.repository.html_url,
            branch: match.deploymentConfig.branch,
            commitSha: event.after,
          },
          triggeredBy: 'github-webhook',
          environment: match.rule.environment as 'production' | 'staging' | 'preview' | 'development',
          metadata: {
            provider: 'github',
            event: 'push',
            rule: match.rule.name,
            ruleId: match.rule.id,
            repository: event.repository.full_name,
            commitMessage: event.commits?.[0]?.message ?? '',
            pusher: event.pusher?.name ?? 'unknown',
          },
        })

        // Trigger deployment
        await this.deploymentService.deployService(
          {
            deploymentId,
            serviceName: match.service.name,
            sourcePath: `/tmp/deployments/${deploymentId}`,
            buildType: match.service.builderId,
            environmentVariables: match.service.builderIdConfig?.buildArgs ?? {},
            healthCheckPath: '/health',
            ...match.service.builderIdConfig,
          },
          match.service.builderId === 'static' ? this.staticProviderService : undefined
        )

        // Increment rule trigger count
        await this.deploymentRulesService.incrementTriggerCount(match.rule.id)
      } catch (error) {
        this.logger.error(
          `Failed to trigger deployment for service ${match.service.id}:`,
          error
        )
      }
    }
  }

  /**
   * Handle pull request events
   */
  private async handlePullRequestEvent(payload: PullRequestEvent, _organizationLogin: string) {
    const event: NormalizedGitHubEvent = {
      type: 'pull_request',
      action: payload.action, // opened, synchronize, reopened, closed, etc.
      repository: {
        id: payload.repository.id,
        name: payload.repository.name,
        full_name: payload.repository.full_name,
        private: payload.repository.private,
        html_url: payload.repository.html_url,
        default_branch: payload.repository.default_branch,
      },
      pull_request: {
        number: payload.pull_request.number,
        title: payload.pull_request.title,
        state: payload.pull_request.state,
        merged: payload.pull_request.merged ?? false,
        head: {
          ref: payload.pull_request.head.ref, // source branch
          sha: payload.pull_request.head.sha,
        },
        base: {
          ref: payload.pull_request.base.ref, // target branch
        },
        labels: payload.pull_request.labels.map((l) => ({ name: l.name })),
      },
      sender: {
        login: payload.sender.login,
        type: payload.sender.type,
      },
    }

    // pull_request is guaranteed to be set since we just created it above
    const pr = event.pull_request

    this.logger.log(`PR #${pr.number} ${event.action} in ${event.repository.full_name}`)

    // Handle PR merge (cleanup preview deployments)
    if (event.action === 'closed' && pr.merged) {
      this.logger.log(`PR #${pr.number} merged, cleaning up preview deployments`)
      // TODO: Implement cleanup logic
      return
    }

    // Find matching services and rules
    const matches = await this.ruleMatcher.findMatchesForEvent(event)

    if (matches.length === 0) {
      this.logger.debug(`No matching deployment rules for PR #${pr.number}`)
      return
    }

    // Trigger preview deployments for each match
    for (const match of matches) {
      try {
        this.logger.log(
          `Triggering preview deployment for service ${match.service.id} using rule "${match.rule.name}"`
        )

        // Create deployment record
        const deploymentId = await this.deploymentService.createDeployment({
          serviceId: match.service.id,
          sourceType: 'github',
          sourceConfig: {
            repositoryUrl: event.repository.html_url,
            branch: match.deploymentConfig.branch,
            commitSha: pr.head.sha,
            pullRequestNumber: pr.number,
          },
          triggeredBy: 'github-webhook',
          environment: 'preview',
          metadata: {
            provider: 'github',
            event: 'pull_request',
            action: event.action,
            rule: match.rule.name,
            ruleId: match.rule.id,
            repository: event.repository.full_name,
            prNumber: pr.number,
            prTitle: pr.title,
            sourceBranch: pr.head.ref,
            targetBranch: pr.base.ref,
          },
        })

        // Trigger deployment
        await this.deploymentService.deployService(
          {
            deploymentId,
            serviceName: match.service.name,
            sourcePath: `/tmp/deployments/${deploymentId}`,
            buildType: match.service.builderId,
            environmentVariables: match.service.builderIdConfig?.buildArgs ?? {},
            healthCheckPath: '/health',
            ...match.service.builderIdConfig,
          },
          match.service.builderId === 'static' ? this.staticProviderService : undefined
        )

        // Increment rule trigger count
        await this.deploymentRulesService.incrementTriggerCount(match.rule.id)
      } catch (error) {
        this.logger.error(
          `Failed to trigger preview deployment for service ${match.service.id}:`,
          error
        )
      }
    }
  }

  /**
   * Handle create events (tags, branches)
   */
  private async handleCreateEvent(payload: CreateEvent, _organizationLogin: string) {
    // Only handle tag creation
    if (payload.ref_type !== 'tag') {
      return
    }

    const event = {
      type: 'tag' as const,
      repository: {
        id: payload.repository.id,
        name: payload.repository.name,
        full_name: payload.repository.full_name,
        private: payload.repository.private,
        html_url: payload.repository.html_url,
        default_branch: payload.repository.default_branch,
      },
      ref: payload.ref, // tag name
      ref_type: payload.ref_type,
      master_branch: payload.master_branch,
      sender: payload.sender,
    }

    this.logger.log(`Tag created: ${event.ref} in ${event.repository.full_name}`)

    // Find matching services and rules
  const matches = await this.ruleMatcher.findMatchesForEvent(event)

    if (matches.length === 0) {
      this.logger.debug(`No matching deployment rules for tag ${event.ref}`)
      return
    }

    // Trigger deployments for each match
    for (const match of matches) {
      try {
        this.logger.log(
          `Triggering deployment for service ${match.service.id} using rule "${match.rule.name}"`
        )

        // Create deployment record
        const deploymentId = await this.deploymentService.createDeployment({
          serviceId: match.service.id,
          sourceType: 'github',
          sourceConfig: {
            repositoryUrl: event.repository.html_url,
            customData: {
              tag: event.ref,
            },
          },
          triggeredBy: 'github-webhook',
          environment: match.deploymentConfig.environment as 'production' | 'staging' | 'preview' | 'development',
          metadata: {
            provider: 'github',
            event: 'tag',
            rule: match.rule.name,
            ruleId: match.rule.id,
            repository: event.repository.full_name,
            tag: event.ref,
            creator: event.sender.login,
          },
        })

        // Trigger deployment
        await this.deploymentService.deployService(
          {
            deploymentId,
            serviceName: match.service.name,
            sourcePath: `/tmp/deployments/${deploymentId}`,
            buildType: match.service.builderId,
            environmentVariables: match.service.builderIdConfig?.buildArgs ?? {},
            healthCheckPath: '/health',
            ...match.service.builderIdConfig,
          },
          match.service.builderId === 'static' ? this.staticProviderService : undefined
        )

        // Increment rule trigger count
        await this.deploymentRulesService.incrementTriggerCount(match.rule.id)
      } catch (error) {
        this.logger.error(
          `Failed to trigger deployment for service ${match.service.id}:`,
          error
        )
      }
    }
  }

  /**
   * Handle release events
   */
  private async handleReleaseEvent(payload: ReleaseEvent, _organizationLogin: string) {
    // Only handle published releases
    if (payload.action !== 'published') {
      return
    }

    const event: NormalizedGitHubEvent = {
      type: 'release',
      action: payload.action,
      repository: {
        id: payload.repository.id,
        name: payload.repository.name,
        full_name: payload.repository.full_name,
        private: payload.repository.private,
        html_url: payload.repository.html_url,
        default_branch: payload.repository.default_branch,
      },
      release: {
        tag_name: payload.release.tag_name,
        name: payload.release.name,
        draft: payload.release.draft,
        prerelease: payload.release.prerelease,
        created_at: payload.release.created_at ?? payload.release.published_at,
        published_at: payload.release.published_at,
      },
      sender: {
        login: payload.sender.login,
        type: payload.sender.type,
      },
    }

    // release is guaranteed to be set since we just created it above
    const releaseInfo = event.release

    this.logger.log(
      `Release published: ${releaseInfo.tag_name} in ${event.repository.full_name}`
    )

    // Find matching services and rules
    const matches = await this.ruleMatcher.findMatchesForEvent(event)

    if (matches.length === 0) {
      this.logger.debug(
        `No matching deployment rules for release ${releaseInfo.tag_name}`
      )
      return
    }

    // Trigger deployments for each match
    for (const match of matches) {
      try {
        this.logger.log(
          `Triggering deployment for service ${match.service.id} using rule "${match.rule.name}"`
        )

        // Create deployment record
        const deploymentId = await this.deploymentService.createDeployment({
          serviceId: match.service.id,
          sourceType: 'github',
          sourceConfig: {
            repositoryUrl: event.repository.html_url,
            customData: {
              tag: releaseInfo.tag_name,
            },
          },
          triggeredBy: 'github-webhook',
          environment: match.deploymentConfig.environment as 'production' | 'staging' | 'preview' | 'development',
          metadata: {
            provider: 'github',
            event: 'release',
            rule: match.rule.name,
            ruleId: match.rule.id,
            repository: event.repository.full_name,
            tag: releaseInfo.tag_name,
            releaseName: releaseInfo.name,
            isPrerelease: releaseInfo.prerelease,
            publisher: event.sender.login,
          },
        })

        // Trigger deployment
        await this.deploymentService.deployService(
          {
            deploymentId,
            serviceName: match.service.name,
            sourcePath: `/tmp/deployments/${deploymentId}`,
            buildType: match.service.builderId,
            environmentVariables: match.service.builderIdConfig?.buildArgs ?? {},
            healthCheckPath: '/health',
            ...match.service.builderIdConfig,
          },
          match.service.builderId === 'static' ? this.staticProviderService : undefined
        )

        // Increment rule trigger count
        await this.deploymentRulesService.incrementTriggerCount(match.rule.id)
      } catch (error) {
        this.logger.error(
          `Failed to trigger deployment for service ${match.service.id}:`,
          error
        )
      }
    }
  }
}
