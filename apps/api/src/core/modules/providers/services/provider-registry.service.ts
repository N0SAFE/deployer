import { Injectable, Logger } from '@nestjs/common';
import type { IProvider, ProviderMetadata, ConfigSchema } from '@/core/interfaces/provider.interface';

/**
 * Central registry for all providers
 * Manages provider configuration schemas and metadata
 * 
 * **PURPOSE**: Single source of truth for all deployment source providers
 * 
 * **USAGE**: 
 * - Service creation: Fetch provider metadata and schemas
 * - Deployment execution: Get provider instances for source fetching
 * - Validation: Validate provider configurations before storage
 */
@Injectable()
export class ProviderRegistryService {
  private readonly logger = new Logger(ProviderRegistryService.name);
  private providers = new Map<string, IProvider>();

  /**
   * Register a provider
   * Called during application startup by ProviderRegistryInitializer
   */
  registerProvider(provider: IProvider): void {
    if (this.providers.has(provider.id)) {
      this.logger.warn(`Provider ${provider.id} already registered, overwriting`);
    }
    this.providers.set(provider.id, provider);
    this.logger.log(`Registered provider: ${provider.name} (${provider.id})`);
  }

  /**
   * Get all registered providers with metadata
   * Used for service creation UI
   */
  getAllProviders(): ProviderMetadata[] {
    return Array.from(this.providers.values()).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      category: this.categorizeProvider(p.id),
      supportedBuilders: p.supportedBuilders,
      tags: this.getProviderTags(p.id),
    }));
  }

  /**
   * Get provider metadata by ID
   */
  getProviderMetadata(id: string): ProviderMetadata | null {
    const provider = this.providers.get(id);
    if (!provider) {
      this.logger.warn(`Provider ${id} not found`);
      return null;
    }

    return {
      id: provider.id,
      name: provider.name,
      description: provider.description,
      icon: provider.icon,
      category: this.categorizeProvider(provider.id),
      supportedBuilders: provider.supportedBuilders,
      tags: this.getProviderTags(provider.id),
    };
  }

  /**
   * Get provider instance by ID
   * **CRITICAL**: Use this in deployment flow to get the actual provider implementation
   */
  getProvider(id: string): IProvider | null {
    const provider = this.providers.get(id);
    if (!provider) {
      this.logger.warn(`Provider ${id} not found`);
      return null;
    }
    return provider;
  }

  /**
   * Get provider configuration schema
   * Used for dynamic form generation
   */
  getProviderSchema(providerId: string): ConfigSchema | null {
    const provider = this.providers.get(providerId);
    if (!provider) {
      this.logger.warn(`Provider ${providerId} not found`);
      return null;
    }
    return provider.getConfigSchema();
  }

  /**
   * Get supported builder IDs for a provider
   * Note: Returns only IDs, not full metadata (use BuilderRegistry for full data)
   */
  getSupportedBuilderIds(providerId: string): string[] {
    const provider = this.providers.get(providerId);
    if (!provider) {
      this.logger.warn(`Provider ${providerId} not found`);
      return [];
    }
    return provider.supportedBuilders;
  }

  /**
   * Validate provider configuration
   */
  async validateProviderConfig(providerId: string, config: any): Promise<{ valid: boolean; errors: string[] }> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return { valid: false, errors: [`Provider ${providerId} not found`] };
    }
    return provider.validateConfig(config);
  }

  /**
   * Check if a provider is registered
   */
  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  /**
   * Get count of registered providers
   */
  getProviderCount(): number {
    return this.providers.size;
  }

  /**
   * Categorize provider by ID
   */
  private categorizeProvider(id: string): 'git' | 'registry' | 'storage' | 'manual' | 'other' {
    if (['github', 'gitlab', 'bitbucket', 'gitea'].includes(id)) return 'git';
    if (['docker-registry', 'ghcr', 'ecr'].includes(id)) return 'registry';
    if (['s3', 'gcs', 'azure-blob'].includes(id)) return 'storage';
    if (['manual', 'static'].includes(id)) return 'manual';
    return 'other';
  }

  /**
   * Get provider tags
   */
  private getProviderTags(id: string): string[] {
    const tagMap: Record<string, string[]> = {
      'github': ['git', 'popular', 'ci-cd'],
      'gitlab': ['git', 'ci-cd', 'self-hosted'],
      'static': ['simple', 'manual'],
      'docker-registry': ['container', 'private'],
    };
    return tagMap[id] || [];
  }
}
