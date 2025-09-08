import { oc } from '@orpc/contract';

// Import all contracts
import {
  traefikCreateInstanceContract,
  traefikListInstancesContract,
  traefikGetInstanceContract,
  traefikStartInstanceContract,
  traefikStopInstanceContract,
  traefikHealthCheckInstanceContract,
  traefikListTemplatesContract,
  traefikGetTemplateContract,
  traefikCreateInstanceFromTemplateContract,
} from './instance';

import {
  traefikCreateDomainConfigContract,
  traefikListDomainConfigsContract,
  traefikCheckDNSContract,
  traefikValidateDomainDNSContract,
} from './domain';

import {
  traefikCreateRouteConfigContract,
  traefikListRouteConfigsContract,
  traefikDeleteRouteConfigContract,
} from './route';

import {
  traefikRegisterDeploymentContract,
  traefikUnregisterDeploymentContract,
} from './deployment';

import {
  traefikGetInstanceConfigsContract,
  traefikGetConfigSyncStatusContract,
  traefikForceSyncConfigsContract,
  traefikCleanupOrphanedFilesContract,
  traefikValidateConfigFilesContract,
  traefikGetInstanceStatusContract,
  traefikSyncSingleConfigContract,
  traefikValidateSingleConfigContract,
} from './config';

// Combine into main traefik contract
export const traefikContract = oc.tag("Traefik").prefix("/traefik").router({
  // Instance management
  createInstance: traefikCreateInstanceContract,
  listInstances: traefikListInstancesContract,
  getInstance: traefikGetInstanceContract,
  startInstance: traefikStartInstanceContract,
  stopInstance: traefikStopInstanceContract,
  healthCheckInstance: traefikHealthCheckInstanceContract,
  
  // Template management
  listTemplates: traefikListTemplatesContract,
  getTemplate: traefikGetTemplateContract,
  createInstanceFromTemplate: traefikCreateInstanceFromTemplateContract,
  
  // Domain management
  createDomainConfig: traefikCreateDomainConfigContract,
  listDomainConfigs: traefikListDomainConfigsContract,
  checkDNS: traefikCheckDNSContract,
  validateDomainDNS: traefikValidateDomainDNSContract,
  
  // Route management
  createRouteConfig: traefikCreateRouteConfigContract,
  listRouteConfigs: traefikListRouteConfigsContract,
  deleteRouteConfig: traefikDeleteRouteConfigContract,
  
  // Deployment registration
  registerDeployment: traefikRegisterDeploymentContract,
  unregisterDeployment: traefikUnregisterDeploymentContract,

  // Configuration management
  getInstanceConfigs: traefikGetInstanceConfigsContract,
  getConfigSyncStatus: traefikGetConfigSyncStatusContract,
  forceSyncConfigs: traefikForceSyncConfigsContract,
  cleanupOrphanedFiles: traefikCleanupOrphanedFilesContract,
  validateConfigFiles: traefikValidateConfigFilesContract,
  getInstanceStatus: traefikGetInstanceStatusContract,
  syncSingleConfig: traefikSyncSingleConfigContract,
  validateSingleConfig: traefikValidateSingleConfigContract,
});

export type TraefikContract = typeof traefikContract;

// Re-export everything from individual contracts
export * from './schemas';
export * from './instance';
export * from './domain';
export * from './route';
export * from './deployment';
export * from './config';