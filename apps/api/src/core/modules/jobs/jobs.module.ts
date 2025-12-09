import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';

import { DatabaseModule } from '../database/database.module';

import { JobTrackingService } from './services/job-tracking.service';
import { DeploymentQueueService } from './services/deployment-queue.service';
import { JobTrackingRepository } from './repositories/job-tracking.repository';

/**
 * Global Jobs Module (CoreJobsModule)
 *
 * This module provides job and queue management infrastructure including:
 * - Base job infrastructure for type-safe Bull queue processing
 * - Deployment job tracking
 * - Queue management and processing
 * - Job status persistence
 * - Background task scheduling
 *
 * Feature-specific processor services should be registered in their respective modules.
 *
 * Usage:
 * 1. Import JobsModule in your feature module
 * 2. Register BullModule.registerQueue() for your queue
 * 3. Create a processor service extending BaseProcessorService
 * 4. Define job contracts using jobContractBuilder()
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     JobsModule,
 *     BullModule.registerQueue({ name: 'deployment' }),
 *   ],
 *   providers: [DeploymentProcessorService],
 *   exports: [DeploymentProcessorService],
 * })
 * export class DeploymentModule {}
 * ```
 */
@Global()
@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({
      name: 'deployment',
    }),
    ScheduleModule.forRoot(),
  ],
  providers: [JobTrackingService, DeploymentQueueService, JobTrackingRepository],
  exports: [JobTrackingService, DeploymentQueueService, JobTrackingRepository],
})
export class JobsModule {}

// Alias for consistency with other core modules
export { JobsModule as CoreJobsModule };
