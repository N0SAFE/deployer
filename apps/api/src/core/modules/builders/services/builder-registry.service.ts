import { Injectable, Logger } from '@nestjs/common';
import type { IBuilder, BuilderMetadata, ConfigSchema } from '@/core/interfaces/provider.interface';

/**
 * Central registry for all builders
 * Manages builder configuration schemas and metadata
 * 
 * **PURPOSE**: Single source of truth for all build system implementations
 * 
 * **USAGE**: 
 * - Service creation: Fetch builder metadata and schemas
 * - Deployment execution: Get builder instances for build operations
 * - Validation: Validate builder configurations before storage
 */
@Injectable()
export class BuilderRegistryService {
  private readonly logger = new Logger(BuilderRegistryService.name);
  private builders = new Map<string, IBuilder>();

  /**
   * Register a builder
   * Called during application startup by BuilderRegistryInitializer
   */
  registerBuilder(builder: IBuilder): void {
    if (this.builders.has(builder.id)) {
      this.logger.warn(`Builder ${builder.id} already registered, overwriting`);
    }
    this.builders.set(builder.id, builder);
    this.logger.log(`Registered builder: ${builder.name} (${builder.id})`);
  }

  /**
   * Get all registered builders with metadata
   * Used for service creation UI
   */
  getAllBuilders(): BuilderMetadata[] {
    return Array.from(this.builders.values()).map(b => ({
      id: b.id,
      name: b.name,
      description: b.description,
      icon: b.icon,
      category: this.categorizeBuilder(b.id),
      compatibleProviders: b.compatibleProviders,
      tags: this.getBuilderTags(b.id),
    }));
  }

  /**
   * Get builder metadata by ID
   */
  getBuilderMetadata(id: string): BuilderMetadata | null {
    const builder = this.builders.get(id);
    if (!builder) {
      this.logger.warn(`Builder ${id} not found`);
      return null;
    }

    return {
      id: builder.id,
      name: builder.name,
      description: builder.description,
      icon: builder.icon,
      category: this.categorizeBuilder(builder.id),
      compatibleProviders: builder.compatibleProviders,
      tags: this.getBuilderTags(builder.id),
    };
  }

  /**
   * Get builder instance by ID
   * **CRITICAL**: Use this in deployment flow to get the actual builder implementation
   */
  getBuilder(id: string): IBuilder | null {
    const builder = this.builders.get(id);
    if (!builder) {
      this.logger.warn(`Builder ${id} not found`);
      return null;
    }
    return builder;
  }

  /**
   * Get builder configuration schema
   * Used for dynamic form generation
   */
  getBuilderSchema(builderId: string): ConfigSchema | null {
    const builder = this.builders.get(builderId);
    if (!builder) {
      this.logger.warn(`Builder ${builderId} not found`);
      return null;
    }
    return builder.getConfigSchema();
  }

  /**
   * Get compatible provider IDs for a builder
   * Note: Returns only IDs, not full metadata (use ProviderRegistry for full data)
   */
  getCompatibleProviderIds(builderId: string): string[] {
    const builder = this.builders.get(builderId);
    if (!builder) {
      this.logger.warn(`Builder ${builderId} not found`);
      return [];
    }
    return builder.compatibleProviders;
  }

  /**
   * Validate builder configuration
   */
  async validateBuilderConfig(builderId: string, config: any): Promise<{ valid: boolean; errors: string[] }> {
    const builder = this.builders.get(builderId);
    if (!builder) {
      return { valid: false, errors: [`Builder ${builderId} not found`] };
    }
    return builder.validateConfig(config);
  }

  /**
   * Check if a builder is registered
   */
  hasBuilder(id: string): boolean {
    return this.builders.has(id);
  }

  /**
   * Get count of registered builders
   */
  getBuilderCount(): number {
    return this.builders.size;
  }

  /**
   * Categorize builder by ID
   */
  private categorizeBuilder(id: string): 'container' | 'static' | 'serverless' | 'other' {
    if (['dockerfile', 'docker-compose', 'buildpack'].includes(id)) return 'container';
    if (['static'].includes(id)) return 'static';
    if (['nixpack', 'railpack'].includes(id)) return 'serverless';
    return 'other';
  }

  /**
   * Get builder tags
   */
  private getBuilderTags(id: string): string[] {
    const tagMap: Record<string, string[]> = {
      'dockerfile': ['container', 'custom', 'flexible'],
      'static': ['simple', 'fast', 'cdn'],
      'buildpack': ['auto-detect', 'heroku'],
      'docker-compose': ['multi-service', 'complex'],
    };
    return tagMap[id] || [];
  }
}
