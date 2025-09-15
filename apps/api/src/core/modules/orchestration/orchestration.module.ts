import { Module, forwardRef, Global } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
// Services
import { SwarmOrchestrationService } from './services/swarm-orchestration.service';
import { TraefikService } from './services/traefik.service';
import { ResourceAllocationService } from './services/resource-allocation.service';
import { SslCertificateService } from './services/ssl-certificate.service';
import { ResourceMonitoringService } from './services/resource-monitoring.service';
import { HealthCheckService } from './services/health-check.service';
import { JobTrackingService } from './services/job-tracking.service';
import { DeploymentQueueService } from '../../../modules/jobs/services/deployment-queue.service';
// Processors
import { DeploymentProcessor } from './processors/deployment.processor';
// Controllers
import { OrchestrationOrpcController } from './controllers/orchestration-orpc.controller';
// Modules
import { DatabaseModule } from '../db/database.module';
import { CoreModule } from '../../core.module';

@Global()
@Module({
    imports: [
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
        DatabaseModule,
        forwardRef(() => require("../../../modules/storage/storage.module").StorageModule),
        CoreModule,
        ScheduleModule.forRoot(),
    ],
    controllers: [OrchestrationOrpcController],
    providers: [
        SwarmOrchestrationService,
        TraefikService,
        ResourceAllocationService,
        SslCertificateService,
        ResourceMonitoringService,
        HealthCheckService,
        JobTrackingService,
        DeploymentProcessor,
        DeploymentQueueService,  // Move here to be in same module as Bull queue
    ],
    exports: [
        SwarmOrchestrationService,
        TraefikService,
        ResourceAllocationService,
        SslCertificateService,
        ResourceMonitoringService,
        HealthCheckService,
        JobTrackingService,
        BullModule,  // Export the Bull queue so other modules can use it
        DeploymentProcessor, // Export the processor if needed elsewhere
        DeploymentQueueService,  // Export so other modules can inject it
    ],
})
export class OrchestrationModule {
}
