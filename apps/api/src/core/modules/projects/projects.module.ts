import { Module } from '@nestjs/common';
import { ProjectServerService } from './services/project-server.service';
import { TraefikCoreModule } from '@/core/modules/traefik/traefik.module';

/**
 * CORE MODULE: Projects
 * Provides project infrastructure services
 * 
 * This is a CORE module - it provides project-related infrastructure services.
 * 
 * Services exported:
 * - ProjectServerService: Per-project HTTP server management
 * 
 * Dependencies:
 * - DockerService: Injected from global DockerModule (no import needed)
 * - TraefikTemplateService: Imported from TraefikCoreModule
 */
@Module({
  imports: [
    TraefikCoreModule,
  ],
  providers: [
    ProjectServerService,
  ],
  exports: [
    ProjectServerService,
  ],
})
export class ProjectsModule {}
