import { Module } from '@nestjs/common';
import { StaticProviderService } from './static-provider.service';
import { StaticFileServingService } from './services/static-file-serving.service';
import { ProjectsModule } from '@/core/modules/projects/projects.module';
import { OrchestrationModule } from '@/core/modules/orchestration/orchestration.module';

/**
 * CORE MODULE: Static Provider
 * Manages static file deployment provider
 * 
 * This is a provider module that provides static deployment services.
 * 
 * Dependencies (direct imports):
 * - ProjectsModule: ProjectServerService for project management (forwardRef due to CoreModule aggregation)
 * - OrchestrationModule: TraefikService for routing (forwardRef due to CoreModule aggregation)
 * 
 * Services:
 * - StaticProviderService: Static file deployment provider
 * - StaticFileServingService: Static file serving logic
 */
@Module({
  imports: [
    ProjectsModule,
    OrchestrationModule,
  ],
  providers: [
    StaticProviderService,
    StaticFileServingService,
  ],
  exports: [
    StaticProviderService,
    StaticFileServingService,
  ],
})
export class StaticProviderModule {}
