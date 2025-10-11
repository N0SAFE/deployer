import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { BuilderRegistryService } from './builder-registry.service';
import { DockerfileBuilderService } from '../dockerfile/dockerfile-builder.service';
import { StaticBuilderService } from '../static/static-builder.service';

/**
 * Builder Registry Initializer
 * 
 * **PURPOSE**: Register all builder services on application startup
 * 
 * **PATTERN**: Dependency Injection + Registry Pattern
 * - Injects all IBuilder implementations
 * - Registers each in BuilderRegistryService
 * - Runs automatically via OnModuleInit lifecycle hook
 * 
 * **TO ADD A NEW BUILDER**:
 * 1. Create builder service implementing IBuilder
 * 2. Add to constructor injection
 * 3. Call registerBuilder() in onModuleInit()
 */
@Injectable()
export class BuilderRegistryInitializer implements OnModuleInit {
  private readonly logger = new Logger(BuilderRegistryInitializer.name);

  constructor(
    private readonly builderRegistry: BuilderRegistryService,
    // Inject all builder services
    private readonly dockerfileBuilder: DockerfileBuilderService,
    private readonly staticBuilder: StaticBuilderService,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing Builder Registry...');

    // Register all builders
    this.builderRegistry.registerBuilder(this.dockerfileBuilder);
    this.builderRegistry.registerBuilder(this.staticBuilder);

    const count = this.builderRegistry.getBuilderCount();
    this.logger.log(`✅ Builder Registry initialized with ${count} builders`);
  }
}
