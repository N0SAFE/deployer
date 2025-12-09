// Module
export { CoreSwarmModule } from './swarm.module';

// Services
export { SwarmOrchestrationService } from './services/swarm-orchestration.service';
export { ResourceAllocationService } from './services/resource-allocation.service';

// Repositories
export { SwarmOrchestrationRepository } from './repositories/swarm-orchestration.repository';

// Types from services
export type {
  ResourceQuota,
  ResourceCapacityCheck,
  ResourceAllocation,
  SystemResourceSummary,
} from './services/resource-allocation.service';
