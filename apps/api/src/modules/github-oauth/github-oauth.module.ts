import { Module } from '@nestjs/common'
import { GitHubOAuthController } from './controllers/github-oauth.controller'
import { GitHubModule } from '@/core/modules/github/github.module'
import { ProvidersModule } from '@/core/modules/providers'

/**
 * FEATURE MODULE: GitHub OAuth Authentication
 * 
 * Handles GitHub App installation and OAuth authentication flow.
 * Separated from core GitHubModule because controllers belong in feature modules.
 * 
 * Architecture Decision:
 * - Core modules should ONLY provide services (no controllers, no processors)
 * - Feature modules contain controllers, processors, and application logic
 * - This module imports core services from GitHubModule and ProvidersModule
 * 
 * Controllers:
 * - GitHubOAuthController: GitHub OAuth flow, installation management
 * 
 * Dependencies:
 * - GitHubModule (core): Provides GitHubService for API operations
 * - ProvidersModule (core): Provides GitHubProviderService for installation management
 */
@Module({
  imports: [
    GitHubModule,
    ProvidersModule,
  ],
  controllers: [
    GitHubOAuthController,
  ],
})
export class GitHubOAuthModule {}
