import { Module } from '@nestjs/common';
import { GitHubProviderModule } from './github/github-provider.module';
import { StaticProviderModule } from './static/static-provider.module';
import { ProviderRegistryService } from './services/provider-registry.service';

/**
 * Providers Module
 * Central module that exports deployment provider services
 * 
 * This module aggregates all provider modules for easy import by feature modules.
 * Core modules (like GitHubModule) should import provider modules directly to avoid
 * circular dependencies within CoreModule.
 * 
 * Uses forwardRef() to handle circular dependencies:
 * - CoreModule → ProvidersModule → StaticProviderModule → (potential circulars)
 * 
 * IMPORTANT: This module re-exports provider modules so they're available to feature modules
 * that import ProvidersModule (like StaticFileModule, StorageModule).
 * 
 * NOTE: GitHubProviderModule is exported here for feature modules, but GitHubModule
 * (in core) imports it directly to avoid sibling module conflicts.
 */
@Module({
  imports: [
    GitHubProviderModule,
    StaticProviderModule
  ],
  providers: [
    ProviderRegistryService
  ],
  exports: [
    GitHubProviderModule,
    StaticProviderModule,
    ProviderRegistryService
  ],
})
export class ProvidersModule {}

