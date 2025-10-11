import { Controller } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { ProviderRegistryService } from '@/core/modules/providers/services/provider-registry.service';
import { BuilderRegistryService } from '@/core/modules/builders/services/builder-registry.service';
import { providerSchemaRouter } from '@repo/api-contracts/modules/provider-schema';

/**
 * Provider Schema Controller
 * Implements ORPC contracts for provider and builder schema endpoints
 * 
 * **ARCHITECTURE**: Uses separate Provider and Builder registries
 * - ProviderRegistryService: Manages provider metadata and instances
 * - BuilderRegistryService: Manages builder metadata and instances
 * - Cross-registry lookups for compatibility checking
 */
@Controller()
export class ProviderSchemaController {
  constructor(
    private readonly providerRegistry: ProviderRegistryService,
    private readonly builderRegistry: BuilderRegistryService,
  ) {}

  @Implement(providerSchemaRouter.getAllProviders)
  getAllProviders() {
    return implement(providerSchemaRouter.getAllProviders).handler(async () => {
      const providers = this.providerRegistry.getAllProviders();
      return {
        providers,
        total: providers.length,
      };
    });
  }

  @Implement(providerSchemaRouter.getProviderSchema)
  getProviderSchema() {
    return implement(providerSchemaRouter.getProviderSchema).handler(async ({ input }) => {
      const schema = this.providerRegistry.getProviderSchema(input.id);
      
      if (!schema) {
        throw new Error(`Provider ${input.id} not found`);
      }

      return schema;
    });
  }

  @Implement(providerSchemaRouter.getCompatibleBuilders)
  getCompatibleBuilders() {
    return implement(providerSchemaRouter.getCompatibleBuilders).handler(async ({ input }) => {
      // Get supported builder IDs from provider
      const builderIds = this.providerRegistry.getSupportedBuilderIds(input.providerId);
      
      // Fetch full builder metadata from builder registry
      const builders = this.builderRegistry.getAllBuilders()
        .filter(builder => builderIds.includes(builder.id));
      
      return {
        builders,
        total: builders.length,
      };
    });
  }

  @Implement(providerSchemaRouter.getAllBuilders)
  getAllBuilders() {
    return implement(providerSchemaRouter.getAllBuilders).handler(async () => {
      const builders = this.builderRegistry.getAllBuilders();
      return {
        builders,
        total: builders.length,
      };
    });
  }

  @Implement(providerSchemaRouter.getBuilderSchema)
  getBuilderSchema() {
    return implement(providerSchemaRouter.getBuilderSchema).handler(async ({ input }) => {
      const schema = this.builderRegistry.getBuilderSchema(input.id);
      
      if (!schema) {
        throw new Error(`Builder ${input.id} not found`);
      }

      return schema;
    });
  }

  @Implement(providerSchemaRouter.getCompatibleProviders)
  getCompatibleProviders() {
    return implement(providerSchemaRouter.getCompatibleProviders).handler(async ({ input }) => {
      // Get compatible provider IDs from builder
      const providerIds = this.builderRegistry.getCompatibleProviderIds(input.builderId);
      
      // Fetch full provider metadata from provider registry
      const providers = this.providerRegistry.getAllProviders()
        .filter(provider => providerIds.includes(provider.id));
      
      return {
        providers,
        total: providers.length,
      };
    });
  }

  @Implement(providerSchemaRouter.validateProviderConfig)
  validateProviderConfig() {
    return implement(providerSchemaRouter.validateProviderConfig).handler(async ({ input }) => {
      const result = await this.providerRegistry.validateProviderConfig(input.providerId, input.config);
      return result;
    });
  }

  @Implement(providerSchemaRouter.validateBuilderConfig)
  validateBuilderConfig() {
    return implement(providerSchemaRouter.validateBuilderConfig).handler(async ({ input }) => {
      const result = await this.builderRegistry.validateBuilderConfig(input.builderId, input.config);
      return result;
    });
  }
}
