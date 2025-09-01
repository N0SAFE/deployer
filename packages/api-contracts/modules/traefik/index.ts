import { oc } from '@orpc/contract';

// Import all contracts
import { 
  traefikCreateInstanceContract,
  traefikListInstancesContract,
  traefikGetInstanceContract,
  traefikStartInstanceContract,
  traefikStopInstanceContract,
  traefikHealthCheckInstanceContract,
} from './instance';

import {
  traefikCreateDomainConfigContract,
  traefikListDomainConfigsContract,
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

// Combine into main traefik contract
export const traefikContract = oc.tag("Traefik").prefix("/traefik").router({
  // Instance management
  createInstance: traefikCreateInstanceContract,
  listInstances: traefikListInstancesContract,
  getInstance: traefikGetInstanceContract,
  startInstance: traefikStartInstanceContract,
  stopInstance: traefikStopInstanceContract,
  healthCheckInstance: traefikHealthCheckInstanceContract,
  
  // Domain management
  createDomainConfig: traefikCreateDomainConfigContract,
  listDomainConfigs: traefikListDomainConfigsContract,
  
  // Route management
  createRouteConfig: traefikCreateRouteConfigContract,
  listRouteConfigs: traefikListRouteConfigsContract,
  deleteRouteConfig: traefikDeleteRouteConfigContract,
  
  // Deployment registration
  registerDeployment: traefikRegisterDeploymentContract,
  unregisterDeployment: traefikUnregisterDeploymentContract,
});

export type TraefikContract = typeof traefikContract;

// Re-export everything from individual contracts
export * from './schemas';
export * from './instance';
export * from './domain';
export * from './route';
export * from './deployment';