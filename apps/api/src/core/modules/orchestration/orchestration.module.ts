import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';

// Services
import { SwarmOrchestrationService } from './services/swarm-orchestration.service';
import { TraefikService } from './services/traefik.service';
import { ResourceAllocationService } from './services/resource-allocation.service';
import { SslCertificateService } from './services/ssl-certificate.service';
import { ResourceMonitoringService } from './services/resource-monitoring.service';
import { HealthCheckService } from './services/health-check.service';
import { JobTrackingService } from './services/job-tracking.service';

// Processors
import { DeploymentProcessor } from './processors/deployment.processor';

// Controllers
import { OrchestrationOrpcController } from './controllers/orchestration-orpc.controller';

// Database
import { DatabaseModule } from '../db/database.module';

@Module({
  imports: [
    DatabaseModule,
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    }),
    BullModule.registerQueue({
      name: 'deployment-queue',
      settings: {
        stalledInterval: 30 * 1000,
        maxStalledCount: 1,
      },
    }),
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
  ],
  exports: [
    SwarmOrchestrationService,
    TraefikService,
    ResourceAllocationService,
    SslCertificateService,
    ResourceMonitoringService,
    HealthCheckService,
    JobTrackingService,
  ],
})
export class OrchestrationModule {}