import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ZombieCleanupService } from './services/zombie-cleanup.service';
import { CoreDeploymentModule } from '@/core/modules/deployment/deployment.module';
import { ProjectModule } from '@/modules/project/project.module';
import { ServiceModule } from '@/core/modules/service/service.module';

/**
 * FEATURE MODULE: Cleanup
 * Handles automated cleanup and reconciliation of Docker containers.
 * 
 * This module was created to fix the inverted dependency issue in DockerModule.
 * Previously, DockerModule (core) was importing business modules (Project, Service, Deployment),
 * which violated the architecture rule: core modules should not depend on feature modules.
 * 
 * Architecture Note:
 * - This is a FEATURE module - it provides scheduled cleanup services
 * - DockerModule is @Global(), so DockerService is available without explicit import
 * - Imports business modules (Project, Service, Deployment) needed for cleanup logic
 * 
 * Services:
 * - ZombieCleanupService: Handles zombie container cleanup and reconciliation
 *   - Resume incomplete deployments after API restart/crash
 *   - Clean up orphaned containers from deleted projects
 *   - Reconcile symlinks for static file deployments
 *   - Clean up helper containers (deployer-vol-*, deployer-copy-*)
 * 
 * Cron Jobs:
 * - EVERY_HOUR: autoCleanup() - Full cleanup cycle
 * 
 * Dependencies:
 * - ScheduleModule: For cron jobs
 * - CoreDeploymentModule: DeploymentService for deployment operations
 * - ProjectModule: ProjectService for project lookups
 * - ServiceModule: ServiceService for service lookups
 * - DockerModule (implicit): DockerService via @Global()
 * 
 * @see CRITICAL-ISSUES.md D1, D2 for the architectural fix this module represents
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    CoreDeploymentModule,
    ProjectModule,
    ServiceModule,
    // DockerModule is @Global() - DockerService available implicitly
  ],
  providers: [ZombieCleanupService],
  exports: [ZombieCleanupService],
})
export class CleanupModule {}
