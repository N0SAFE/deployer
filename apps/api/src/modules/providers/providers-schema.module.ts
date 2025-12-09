import { Module, forwardRef } from '@nestjs/common';
import { CoreModule } from '@/core/core.module';
import { ProviderRegistryService } from '@/core/modules/providers/services/provider-registry.service';
import { ProviderRegistryInitializer } from '@/core/modules/providers/services/provider-registry-initializer.service';
import { BuilderRegistryService } from '@/core/modules/builders/services/builder-registry.service';
import { BuilderRegistryInitializer } from '@/core/modules/builders/services/builder-registry-initializer.service';
import { ProviderSchemaController } from './controllers/provider-schema.controller';
import { GitHubProviderModule } from '@/core/modules/providers/github/github-provider.module';
import { StaticProviderModule } from '@/core/modules/providers/static/static-provider.module';
import { DockerfileBuilderModule } from '@/core/modules/builders/dockerfile/dockerfile-builder.module';
import { StaticBuilderModule } from '@/core/modules/builders/static/static-builder.module';

/**
 * Provider Schema Module
 * 
 * **PURPOSE**: Expose provider and builder configuration schemas via HTTP endpoints
 * 
 * **ARCHITECTURE**: Separate Provider and Builder Registries
 * - ProviderRegistryService: Manages provider instances and metadata
 * - BuilderRegistryService: Manages builder instances and metadata
 * - Cross-registry lookups for compatibility checking
 * 
 * This module:
 * - Registers all providers on startup (ProviderRegistryInitializer)
 * - Registers all builders on startup (BuilderRegistryInitializer)
 * - Exposes ORPC endpoints for fetching schemas and metadata
 * - Enables dynamic form generation in the frontend
 * 
 * **ORPC Endpoints**:
 * - GET /providers - List all providers with metadata
 * - GET /providers/:id/schema - Get provider configuration schema
 * - GET /providers/:providerId/builders - Get compatible builders
 * - GET /builders - List all builders with metadata
 * - GET /builders/:id/schema - Get builder configuration schema
 * - GET /builders/:builderId/providers - Get compatible providers
 * - POST /providers/:providerId/validate - Validate provider config
 * - POST /builders/:builderId/validate - Validate builder config
 */
@Module({
  imports: [
    forwardRef(() => CoreModule),
    GitHubProviderModule,
    StaticProviderModule,
    DockerfileBuilderModule,
    StaticBuilderModule,
  ],
  controllers: [ProviderSchemaController],
  providers: [
    // Provider Registry
    ProviderRegistryService,
    ProviderRegistryInitializer,
    // Builder Registry
    BuilderRegistryService,
    BuilderRegistryInitializer,
  ],
  exports: [
    ProviderRegistryService,
    BuilderRegistryService,
  ],
})
export class ProvidersSchemaModule {}
