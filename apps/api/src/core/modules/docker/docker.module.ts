import { Module, Global, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DockerService } from './services/docker.service';
import { ZombieCleanupService } from './services/zombie-cleanup.service';
import { CoreDeploymentModule } from '@/core/modules/deployment/deployment.module';
import { ProjectModule } from '@/modules/project/project.module';
import { ServiceModule } from '@/core/modules/service/service.module';

/**
 * CORE MODULE: Docker
 * Provides Docker infrastructure services
 * 
 * This is a CORE module - it provides Docker-related infrastructure services.
 * Marked as @Global() so DockerService is available to all modules without explicit import.
 * 
 * Services exported:
 * - DockerService: Docker container management
 * - ZombieCleanupService: Automated cleanup of orphaned containers
 * 
 * Dependencies:
 * - DeploymentModule: DeploymentService for ZombieCleanupService (circular dependency resolved with forwardRef)
 */
@Global()
@Module({
  imports: [
    ScheduleModule.forRoot(), // For ZombieCleanupService cron jobs
    forwardRef(() => CoreDeploymentModule), // Use forwardRef to break circular dependency
    forwardRef(() => ProjectModule), // For ProjectService (cross-layer dependency)
    ServiceModule, // For ServiceService
  ],
  providers: [
    DockerService,
    ZombieCleanupService,
  ],
  exports: [
    DockerService,
    ZombieCleanupService,
  ],
})
export class DockerModule {}
