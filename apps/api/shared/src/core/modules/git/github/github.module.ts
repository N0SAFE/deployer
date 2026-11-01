import { createModuleContext } from "@deployer/nest-effect";
import { GitHubService } from "./services/github.service";

/**
 * CORE MODULE: GitHub API Integration
 *
 * Provides ONLY core GitHub API services. NO controllers, NO processors.
 * All controllers (OAuth, Webhooks) have been moved to feature modules.
 *
 * Services:
 * - GitHubService: GitHub API client, repository operations
 *
 *
 * Architecture Notes:
 * - This is a CORE module - it should ONLY provide services, NO controllers
 * - GitHubOAuthController moved to GitHubOAuthModule (feature module)
 * - GitHubWebhookController moved to GitHubWebhookModule (feature module)
 * - Core modules are imported by CoreModule and made available to all feature modules
 * - Feature modules import CoreModule or specific core modules they need
 */
export class GitHubModule extends createModuleContext({
  providers: [GitHubService],
  exports: [GitHubService],
}) {}
