import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database/database.module';
import { ResourceMonitoringService } from './services/resource-monitoring.service';
import { ResourceMonitoringRepository } from './repositories/resource-monitoring.repository';

/**
 * CORE MODULE: Resource Monitoring
 * 
 * Provides resource usage monitoring including:
 * - CPU, memory, storage tracking
 * - Resource alerts and thresholds
 * - Metrics collection and aggregation
 * - Stack resource summaries
 * 
 * Services:
 * - ResourceMonitoringService: Resource metrics and alerting
 * 
 * Repositories:
 * - ResourceMonitoringRepository: Metrics data access
 * 
 * Dependencies:
 * - DatabaseModule: For metrics storage
 * - BullModule: For async alert processing
 * - ScheduleModule: For periodic metrics collection
 */
@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({ name: 'deployment' }),
    ScheduleModule.forRoot(),
  ],
  providers: [
    ResourceMonitoringService,
    ResourceMonitoringRepository,
  ],
  exports: [
    ResourceMonitoringService,
    ResourceMonitoringRepository,
  ],
})
export class CoreMonitoringModule {}
