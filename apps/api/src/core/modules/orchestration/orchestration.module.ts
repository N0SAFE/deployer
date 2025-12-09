import { Module, Global, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { CoreDeploymentModule } from '@/core/modules/deployment/deployment.module';
import { ServiceModule } from '@/core/modules/service/service.module';
import { DatabaseModule } from '@/core/modules/database/database.module';
import { GitModule } from '@/core/modules/git/git';
import { CoreStorageModule } from '@/core/modules/storage/storage.module';

// Focused Core Modules (Step 2 SRP refactoring)
import { CoreSslModule } from '../ssl';
import { CoreHealthModule } from '../health';
import { CoreMonitoringModule } from '../monitoring';
import { CoreSwarmModule } from '../swarm';
import { JobsModule } from '../jobs';

// Remaining legacy services (to be deprecated)
import { TraefikOrchestrationService } from './services/traefik-orchestration.service';
import { TraefikRepository } from './repositories/traefik.repository';

// Event Services (stays in orchestration - coordinates events across modules)
import { DeploymentEventService } from './events/deployment-event.service';

// Re-exports for backward compatibility
export { SslCertificateService, SslCertificateRepository } from '../ssl';
export { HealthCheckService, HealthCheckRepository } from '../health';
export { ResourceMonitoringService, ResourceMonitoringRepository } from '../monitoring';
export {
  SwarmOrchestrationService,
  ResourceAllocationService,
  SwarmOrchestrationRepository,
} from '../swarm';
export {
  JobTrackingService,
  DeploymentQueueService,
  JobTrackingRepository,
} from '../jobs';

/**
 * CORE MODULE: OrchestrationModule (Facade)
 *
 * This module now acts as a FACADE that imports focused core modules.
 * Direct service providers are deprecated - use the focused modules instead.
 *
 * Focused Modules (SRP compliant):
 * - CoreSslModule: SSL certificate lifecycle management
 * - CoreHealthModule: Service health monitoring
 * - CoreMonitoringModule: Resource usage monitoring
 * - CoreSwarmModule: Docker Swarm orchestration + resource allocation
 * - JobsModule: Job tracking and deployment queue management
 *
 * Legacy Services (deprecated, to be removed):
 * - TraefikOrchestrationService: Use TraefikCoreModule instead
 * - TraefikRepository: Use TraefikCoreModule instead
 *
 * Event Services (coordination layer):
 * - DeploymentEventService: Coordinates deployment events across modules
 *
 * Architecture Note (2025-01-20):
 * - Step 2: Split into focused modules following SRP
 * - This facade maintains backward compatibility during migration
 * - New code should import focused modules directly
 *
 * @deprecated For new code, import focused modules directly:
 *   - CoreSslModule, CoreHealthModule, CoreMonitoringModule, CoreSwarmModule, JobsModule
 */
@Global()
@Module({
  imports: [
    DatabaseModule, // Required for legacy repositories
    ServiceModule, // Import to provide ServiceService for DeploymentProcessor
    GitModule, // ✅ Fixed O1: Import module instead of direct service
    CoreStorageModule, // ✅ Fixed O1: Import module instead of direct service
    forwardRef(() => CoreDeploymentModule), // ⚠️ O2: forwardRef due to circular dependency

    // Focused Core Modules (SRP refactoring)
    CoreSslModule,
    CoreHealthModule,
    CoreMonitoringModule,
    CoreSwarmModule,
    JobsModule,

    BullModule.registerQueue({
      name: 'deployment',
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 25,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    }),
  ],
  controllers: [], // NO CONTROLLERS - moved to OrchestrationControllerModule (feature)
  providers: [
    // Legacy services (deprecated)
    TraefikOrchestrationService, // @deprecated - Use TraefikCoreModule
    TraefikRepository, // @deprecated - Use TraefikCoreModule
    // Event Services (coordination layer)
    DeploymentEventService,
  ],
  exports: [
    // Re-export focused modules for backward compatibility
    CoreSslModule,
    CoreHealthModule,
    CoreMonitoringModule,
    CoreSwarmModule,
    JobsModule,

    // Legacy exports (deprecated)
    TraefikOrchestrationService, // @deprecated - Use TraefikCoreModule
    TraefikRepository, // @deprecated - Use TraefikCoreModule

    // Export BullModule to allow injecting queues in other modules
    BullModule,

    // Event Services
    DeploymentEventService,

    // Re-export from imported modules for convenience
    GitModule,
    CoreStorageModule,
  ],
})
export class OrchestrationModule {}
