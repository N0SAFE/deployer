import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ProviderRegistryService } from './provider-registry.service';
import { GithubProviderService } from '../github/github-provider.service';
import { StaticProviderService } from '../static/static-provider.service';

/**
 * Provider Registry Initializer
 * 
 * **PURPOSE**: Register all provider services on application startup
 * 
 * **PATTERN**: Dependency Injection + Registry Pattern
 * - Injects all IProvider implementations
 * - Registers each in ProviderRegistryService
 * - Runs automatically via OnModuleInit lifecycle hook
 * 
 * **TO ADD A NEW PROVIDER**:
 * 1. Create provider service implementing IProvider
 * 2. Add to constructor injection
 * 3. Call registerProvider() in onModuleInit()
 */
@Injectable()
export class ProviderRegistryInitializer implements OnModuleInit {
  private readonly logger = new Logger(ProviderRegistryInitializer.name);

  constructor(
    private readonly providerRegistry: ProviderRegistryService,
    // Inject all provider services
    private readonly githubProvider: GithubProviderService,
    private readonly staticProvider: StaticProviderService,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing Provider Registry...');

    // Register all providers
    this.providerRegistry.registerProvider(this.githubProvider);
    this.providerRegistry.registerProvider(this.staticProvider);

    const count = this.providerRegistry.getProviderCount();
    this.logger.log(`✅ Provider Registry initialized with ${count} providers`);
  }
}
