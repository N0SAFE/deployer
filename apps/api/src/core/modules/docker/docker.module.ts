import { Module, Global } from '@nestjs/common';
import { DockerService } from './services/docker.service';

/**
 * CORE MODULE: Docker
 * Provides Docker infrastructure services for container management.
 * 
 * This is a FOUNDATIONAL core module - it provides Docker-related infrastructure services.
 * Marked as @Global() so DockerService is available to all modules without explicit import.
 * 
 * Architecture Note:
 * - This module should NOT depend on any business/feature modules
 * - Other modules (Deployment, Cleanup, etc.) depend on this module
 * - ZombieCleanupService was moved to modules/cleanup/ to fix inverted dependency
 * 
 * Services exported:
 * - DockerService: Low-level Docker container management
 *   - Create/start/stop/remove containers
 *   - Build images
 *   - Manage volumes and networks
 *   - Execute commands in containers
 *   - Stream logs
 * 
 * Consumers:
 * - CleanupModule: Zombie container cleanup
 * - DeploymentModule: Container deployment
 * - BuildersModule: Image building
 * - OrchestrationModule: Resource management
 */
@Global()
@Module({
  providers: [DockerService],
  exports: [DockerService],
})
export class DockerModule {}
