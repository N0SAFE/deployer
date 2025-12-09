// Module (Facade)
export { OrchestrationModule } from './orchestration.module';

// Re-export Focused Modules for convenience
export { CoreSslModule, SslCertificateService, SslCertificateRepository } from '../ssl';
export { CoreHealthModule, HealthCheckService, HealthCheckRepository } from '../health';
export {
  CoreMonitoringModule,
  ResourceMonitoringService,
  ResourceMonitoringRepository,
} from '../monitoring';
export {
  CoreSwarmModule,
  SwarmOrchestrationService,
  ResourceAllocationService,
  SwarmOrchestrationRepository,
} from '../swarm';
export type {
  ResourceQuota,
  ResourceCapacityCheck,
  ResourceAllocation,
  SystemResourceSummary,
} from '../swarm';
export {
  JobsModule,
  CoreJobsModule,
  JobTrackingService,
  DeploymentQueueService,
  JobTrackingRepository,
} from '../jobs';
export type {
  JobTrackingInfo,
  JobStatusSummary,
  JobHistoryQuery,
} from '../jobs';

// Legacy Services (deprecated - use focused modules)
export { TraefikOrchestrationService } from './services/traefik-orchestration.service';
export { TraefikRepository } from './repositories/traefik.repository';

// Events (coordination layer)
export { DeploymentEventService } from './events/deployment-event.service';

// Types
export * from './types';
