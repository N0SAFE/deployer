/**
 * Service Contract - Service Definition and Management
 * 
 * **PURPOSE**: Comprehensive service lifecycle management within projects
 * 
 * **SCOPE**: This contract handles all service-related operations including:
 * - Service CRUD operations with Docker and runtime configurations
 * - Service dependency management and relationship tracking
 * - Deployment history and status monitoring per service
 * - Real-time service monitoring (logs, metrics, health)
 * - Service activation/deactivation for environment control
 * 
 * **FRONTEND INTEGRATION**: ✅ Core service management - Heavily used
 * - Service configuration forms and Docker setup
 * - Service dashboard with metrics and health status
 * - Deployment history and management per service
 * - Service dependency mapping and visualization
 * - Real-time log streaming and monitoring
 * 
 * **CONTRACT ORGANIZATION**:
 * - **Core CRUD**: Basic service operations (list, get, create, update, delete)
 * - **Deployments**: Service-specific deployment history and tracking
 * - **Dependencies**: Inter-service dependency management
 * - **Monitoring**: Logs, metrics, and health status (HTTP + WebSocket)
 * - **Control**: Service activation and runtime management
 * 
 * **RELATIONSHIP TO OTHER CONTRACTS**:
 * - **`project`**: Services belong to projects and inherit project configuration
 * - **`deployment`**: Deployments target specific services with versions
 * - **`environment`**: Services run in project environments with specific configurations
 * - **`orchestration`**: Service definitions are used for container orchestration
 * - **`traefik`**: Services are exposed through routing rules
 * 
 * **REAL-TIME FEATURES**:
 * - WebSocket integration for live log streaming
 * - Real-time metrics updates for service performance
 * - Health status monitoring with alerts
 * 
 * Routes: /services/*
 * WebSocket: /services/:serviceId/{logs,metrics,health}/ws
 * Status: 🟢 Production Ready - Feature-complete with real-time capabilities
 * Frontend Usage: ✅ Primary service management and monitoring interface
 * Complexity: Medium-High - Rich feature set with real-time monitoring
 * 
 * @example
 * // Create new service with Docker configuration
 * const service = await orpc.service.create({
 *   projectId: "proj_123",
 *   name: "api-server",
 *   dockerConfig: {
 *     image: "node:20-alpine",
 *     port: 3000,
 *     env: { NODE_ENV: "production" }
 *   }
 * });
 * 
 * // Get service deployment history
 * const deployments = await orpc.service.getDeployments({
 *   id: service.id,
 *   limit: 10
 * });
 * 
 * // Monitor service health
 * const health = await orpc.service.getHealth({ id: service.id });
 * 
 * // Set up service dependency
 * await orpc.service.addDependency({
 *   serviceId: service.id,
 *   dependsOnServiceId: "database_service_id"
 * });
 * 
 * @see ../../CONTRACT_ARCHITECTURE.md for detailed contract organization
 * @see ../deployment/index.ts for deployment operations targeting services
 * @see ../project/index.ts for project-level service management
 */

import { oc } from '@orpc/contract';

// Import all contracts
import { 
  serviceListByProjectContract, 
  serviceGetByIdContract,
  serviceCreateContract,
  serviceUpdateContract,
  serviceDeleteContract,
  serviceGetDeploymentsContract,
  serviceGetDependenciesContract,
  serviceAddDependencyContract,
  serviceRemoveDependencyContract,
  serviceToggleActiveContract,
  serviceAddLogContract,
  serviceGetTraefikConfigContract,
  serviceUpdateTraefikConfigContract,
  serviceSyncTraefikConfigContract,
  serviceGetProjectDependencyGraphContract,
} from './crud';

// Import additional service contracts
import { serviceGetLogsContract } from './get-logs';
import { serviceGetMetricsContract } from './get-metrics';
import { serviceGetHealthContract } from './get-health';

// Combine into main service contract
export const serviceContract = oc.tag("Service").prefix("/services").router({
  listByProject: serviceListByProjectContract,
  getById: serviceGetByIdContract,
  create: serviceCreateContract,
  update: serviceUpdateContract,
  delete: serviceDeleteContract,
  getDeployments: serviceGetDeploymentsContract,
  getDependencies: serviceGetDependenciesContract,
  addDependency: serviceAddDependencyContract,
  removeDependency: serviceRemoveDependencyContract,
  toggleActive: serviceToggleActiveContract,
  getLogs: serviceGetLogsContract,
  getMetrics: serviceGetMetricsContract,
  getHealth: serviceGetHealthContract,
  addLog: serviceAddLogContract,
  getTraefikConfig: serviceGetTraefikConfigContract,
  updateTraefikConfig: serviceUpdateTraefikConfigContract,
  syncTraefikConfig: serviceSyncTraefikConfigContract,
  getProjectDependencyGraph: serviceGetProjectDependencyGraphContract,
});

export type ServiceContract = typeof serviceContract;

// WebSocket contracts for real-time service events
export const serviceWebSocketContract = oc.router({
  // Real-time service logs
  logs: oc.route({
    method: 'GET',
    path: '/services/:serviceId/logs/ws',
    summary: 'Real-time service logs',
  }),
  
  // Real-time service metrics
  metrics: oc.route({
    method: 'GET', 
    path: '/services/:serviceId/metrics/ws',
    summary: 'Real-time service metrics',
  }),
  
  // Real-time service health status
  health: oc.route({
    method: 'GET',
    path: '/services/:serviceId/health/ws', 
    summary: 'Real-time service health updates',
  }),
});

export type ServiceWebSocketContract = typeof serviceWebSocketContract;

// Re-export everything from individual contracts
export * from './schemas';
export * from './crud';
export * from './get-logs';
export * from './get-metrics';
export * from './get-health';