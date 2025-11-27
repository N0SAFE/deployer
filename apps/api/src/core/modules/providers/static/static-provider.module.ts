import { Module } from '@nestjs/common';
import { StaticProviderService } from './static-provider.service';
import { StaticFileServingService } from './services/static-file-serving.service';
import { StaticProviderRepository } from './repositories/static-provider.repository';
import { ProjectsModule } from '@/core/modules/projects/projects.module';
import { OrchestrationModule } from '@/core/modules/orchestration/orchestration.module';
import { DatabaseModule } from '@/core/modules/database/database.module';

/**
 * CORE MODULE: Static Provider
 * Manages static file deployment provider
 * 
 * This is a provider module that provides static deployment services.
 * 
 * Dependencies (direct imports):
 * - ProjectsModule: ProjectServerService for project management (forwardRef due to CoreModule aggregation)
 * - OrchestrationModule: TraefikService for routing (forwardRef due to CoreModule aggregation)
 * - DatabaseModule: Database access for repositories
 * 
 * Services:
 * - StaticProviderService: Static file deployment provider
 * - StaticFileServingService: Static file serving logic
 * - StaticProviderRepository: Database operations for static provider
 */
@Module({
  imports: [
    DatabaseModule,
    ProjectsModule,
    OrchestrationModule,
  ],
  providers: [
    StaticProviderService,
    StaticFileServingService,
    StaticProviderRepository,
  ],
  exports: [
    StaticProviderService,
    StaticFileServingService,
    StaticProviderRepository,
  ],
})
export class StaticProviderModule {}
