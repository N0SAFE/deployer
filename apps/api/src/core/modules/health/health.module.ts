import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database/database.module';
import { DockerModule } from '../docker/docker.module';
import { HealthCheckService } from './services/health-check.service';
import { HealthCheckRepository } from './repositories/health-check.repository';

/**
 * CORE MODULE: Health Check Management
 * 
 * Provides service health monitoring including:
 * - HTTP/TCP health checks
 * - Health status tracking
 * - Uptime calculation
 * - Health alerts and notifications
 * 
 * Services:
 * - HealthCheckService: Health monitoring and status management
 * 
 * Repositories:
 * - HealthCheckRepository: Health check data access
 * 
 * Dependencies:
 * - DatabaseModule: For health data storage
 * - CoreDockerModule: For container health inspection
 * - BullModule: For async health check operations
 * - ScheduleModule: For periodic health monitoring
 */
@Module({
  imports: [
    DatabaseModule,
    DockerModule,
    BullModule.registerQueue({ name: 'deployment' }),
    ScheduleModule.forRoot(),
  ],
  providers: [
    HealthCheckService,
    HealthCheckRepository,
  ],
  exports: [
    HealthCheckService,
    HealthCheckRepository,
  ],
})
export class CoreHealthModule {}
