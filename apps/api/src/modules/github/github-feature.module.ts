import { Module, forwardRef } from '@nestjs/common';
import { GitHubWebhookController } from './controllers/github-webhook.controller';
import { GitHubOAuthController } from './controllers/github-oauth.controller';
import { GitHubRuleMatcherService } from './services/github-rule-matcher.service';
import { CoreModule } from '@/core/core.module';
import { WebSocketModule } from '@/modules/websocket/websocket.module';

/**
 * FEATURE MODULE: GitHub Integration
 *
 * Unified feature module for all GitHub-related functionality including:
 * - GitHub App OAuth installation flow
 * - GitHub webhook event handling
 * - GitHub-specific deployment rule matching
 *
 * This module consolidates GitHub-related functionality into a single feature module.
 *
 * Controllers:
 * - GitHubOAuthController: Handles GitHub App installation, OAuth flow, repository sync
 * - GitHubWebhookController: Processes GitHub webhook events (push, PR, release, etc.)
 *
 * Services:
 * - GitHubRuleMatcherService: GitHub-specific event-to-deployment rule matching
 *   (Moved from core/deployment to keep provider-specific logic in feature modules)
 *
 * Dependencies:
 * - CoreModule: Provides all core services including:
 *   - GitHubService (core/github): GitHub API, App management, webhook signature verification
 *   - GithubProviderService (core/providers/github): Installation storage, repository config
 *   - DeploymentService (core/deployment): Deployment creation and triggering
 *   - And many others...
 * - WebSocketModule: Real-time deployment status updates
 *
 * Architecture Notes:
 * - This is a FEATURE module - contains controllers and provider-specific services
 * - Core GitHub logic lives in:
 *   - core/modules/github/ - Low-level GitHub API operations
 *   - core/modules/providers/github/ - Provider pattern implementation, DB storage
 * - Provider-specific deployment logic (rule matching) lives here, NOT in core/deployment
 * - Core deployment modules should be provider-agnostic
 *
 * Routes:
 * - POST /github/installations/setup - Store GitHub App credentials
 * - GET /github/install/:appSlug - Redirect to GitHub App installation
 * - GET /github/callback - Handle GitHub OAuth callback
 * - GET /github/installations - List installations
 * - GET /github/installations/:org - Get installation details
 * - GET /github/installations/:org/sync - Sync repositories
 * - POST /webhooks/github - Process GitHub webhook events
 */
@Module({
  imports: [
    forwardRef(() => CoreModule),
    WebSocketModule,
  ],
  controllers: [
    GitHubOAuthController,
    GitHubWebhookController,
  ],
  providers: [
    GitHubRuleMatcherService,
  ],
  exports: [
    GitHubRuleMatcherService,
  ],
})
export class GitHubFeatureModule {}
