import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';

import { DatabaseModule } from '../database/database.module';
import { DockerModule } from '../docker/docker.module';

import { SwarmOrchestrationService } from './services/swarm-orchestration.service';
import { ResourceAllocationService } from './services/resource-allocation.service';
import { SwarmOrchestrationRepository } from './repositories/swarm-orchestration.repository';

/**
 * CoreSwarmModule
 *
 * Handles Docker Swarm orchestration including:
 * - Service deployment to swarm
 * - Node management
 * - Swarm cluster operations
 * - Resource allocation across swarm nodes
 *
 * Part of the core infrastructure layer.
 */
@Module({
  imports: [
    DatabaseModule,
    DockerModule,
    BullModule.registerQueue({
      name: 'deployment',
    }),
    ScheduleModule.forRoot(),
  ],
  providers: [
    SwarmOrchestrationService,
    ResourceAllocationService,
    SwarmOrchestrationRepository,
  ],
  exports: [
    SwarmOrchestrationService,
    ResourceAllocationService,
    SwarmOrchestrationRepository,
  ],
})
export class CoreSwarmModule {}
