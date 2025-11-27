import { Module, Global, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { CoreDeploymentModule } from '@/core/modules/deployment/deployment.module';
import { ServiceModule } from '@/core/modules/service/service.module';
import { DatabaseModule } from '@/core/modules/database/database.module';

// Services
import { SwarmOrchestrationService } from './services/swarm-orchestration.service';
import { TraefikService } from './services/traefik.service';
import { ResourceAllocationService } from './services/resource-allocation.service';
import { DeploymentQueueService } from './services/deployment-queue.service';
import { GitService } from '@/core/modules/git/services/git.service';
import { FileUploadService } from '@/core/modules/storage/services/file-upload.service';
import { SslCertificateService } from './services/ssl-certificate.service';
import { ResourceMonitoringService } from './services/resource-monitoring.service';
import { HealthCheckService } from './services/health-check.service';
import { JobTrackingService } from './services/job-tracking.service';

// Repositories
import { SslCertificateRepository } from './repositories/ssl-certificate.repository';
import { JobTrackingRepository } from './repositories/job-tracking.repository';
import { ResourceMonitoringRepository } from './repositories/resource-monitoring.repository';
import { HealthCheckRepository } from './repositories/health-check.repository';
import { SwarmOrchestrationRepository } from './repositories/swarm-orchestration.repository';
import { TraefikRepository } from './repositories/traefik.repository';

/**
 * CORE MODULE: Orchestration Services
 * 
 * Provides ONLY core orchestration services. NO controllers, NO processors.
 * 
 * Core modules should ONLY provide services (no controllers, no processors).
 * Feature modules contain controllers, processors, and application logic.
 * 
 * Services provided:
 * - SwarmOrchestrationService: Docker Swarm stack management
 * - TraefikService: Reverse proxy and load balancing configuration
 * - ResourceAllocationService: Resource quota and allocation management
 * - SslCertificateService: SSL certificate management
 * - ResourceMonitoringService: Resource usage monitoring and alerting
 * - HealthCheckService: Service health monitoring
 * - JobTrackingService: Deployment job tracking and history
 * - DeploymentQueueService: Bull queue service for deployments
 * 
 * Repositories provided:
 * - SslCertificateRepository: SSL certificate data access
 * - JobTrackingRepository: Job tracking data access
 * - ResourceMonitoringRepository: Resource metrics data access
 * - HealthCheckRepository: Health check data access
 * - SwarmOrchestrationRepository: Stack orchestration data access
 * - TraefikRepository: Traefik configuration data access
 * 
 * Controllers and Processors have been moved to OrchestrationControllerModule (feature module).
 */
@Global()
@Module({
    imports: [
        DatabaseModule,  // Required for repositories
        ServiceModule,  // Import to provide ServiceService for DeploymentProcessor
        forwardRef(() => CoreDeploymentModule),  // Use forwardRef to break circular dependency
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
        ScheduleModule.forRoot(),
    ],
    controllers: [],  // NO CONTROLLERS - moved to OrchestrationControllerModule (feature)
    providers: [
        GitService,
        FileUploadService,
        // Repositories
        SslCertificateRepository,
        JobTrackingRepository,
        ResourceMonitoringRepository,
        HealthCheckRepository,
        SwarmOrchestrationRepository,
        TraefikRepository,
        // Services
        SwarmOrchestrationService,
        TraefikService,
        ResourceAllocationService,
        SslCertificateService,
        ResourceMonitoringService,
        HealthCheckService,
        JobTrackingService,
        DeploymentQueueService,
    ],
    exports: [
        // Repositories
        SslCertificateRepository,
        JobTrackingRepository,
        ResourceMonitoringRepository,
        HealthCheckRepository,
        SwarmOrchestrationRepository,
        TraefikRepository,
        // Services
        SwarmOrchestrationService,
        TraefikService,
        ResourceAllocationService,
        SslCertificateService,
        ResourceMonitoringService,
        HealthCheckService,
        JobTrackingService,
        // Export BullModule to allow injecting queues in other modules
        BullModule,
        DeploymentQueueService,
        GitService,
        FileUploadService,
    ],
})
export class OrchestrationModule {
}
