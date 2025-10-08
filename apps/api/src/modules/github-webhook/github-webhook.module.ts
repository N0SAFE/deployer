import { Module } from '@nestjs/common';
import { GitHubWebhookController } from './controllers/github-webhook.controller';
import { CoreModule } from '@/core/core.module';
import { WebSocketModule } from '@/modules/websocket/websocket.module';

/**
 * FEATURE MODULE: GitHub Webhook Handling
 * 
 * Handles GitHub webhook events and triggers deployments.
 * Separated from core GitHubModule to avoid circular dependency issues.
 * 
 * Controllers:
 * - GitHubWebhookController: Processes GitHub webhook events (push, PR, release, etc.)
 * 
 * Dependencies:
 * - CoreModule: Provides all core services (GitHubService, Providers, DeploymentService)
 * - WebSocketModule: Real-time deployment updates
 * 
 * Architecture Decision:
 * This module was split from GitHubModule because:
 * 1. GitHubModule (core) and ProvidersModule (core) are siblings in CoreModule
 * 2. Both importing GitHubProviderModule caused duplicate initialization
 * 3. Moving webhook handling to a feature module resolves the conflict
 * 4. Feature modules can safely import from multiple core modules
 * 5. Follows separation of concerns: core API logic vs webhook event handling
 */
@Module({
  imports: [
    CoreModule,
    WebSocketModule,
  ],
  controllers: [GitHubWebhookController],
})
export class GitHubWebhookModule {}
