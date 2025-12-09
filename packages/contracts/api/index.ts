import { oc } from "@orpc/contract";
import { 
  userContract, 
  healthContract, 
  domainContract,
  projectContract,
  serviceContract,
  deploymentContract,
  environmentContract,
  orchestrationContract,
  analyticsContract,
  ciCdContract,
  storageContract,
  traefikContract,
  setupContract,
  staticFileContract,
} from "./modules/index";

// Main app contract that combines all feature contracts
export const appContract = oc.router({
  // Core contracts
  user: userContract,
  health: healthContract,
  domain: domainContract,
  
  // Feature contracts
  project: projectContract,
  service: serviceContract,
  deployment: deploymentContract,
  environment: environmentContract,
  orchestration: orchestrationContract,
  analytics: analyticsContract,
  ciCd: ciCdContract,
  storage: storageContract,
  traefik: traefikContract,
  setup: setupContract,
  staticFile: staticFileContract,
});

export type AppContract = typeof appContract;

// Re-export individual contracts and schemas
export * from "./modules/index";
