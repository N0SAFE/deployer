import { oc } from "@orpc/contract";
import { userContract, healthContract, deploymentContract, traefikContract, projectContract, serviceContract } from "./modules/index";

// Main app contract that combines all feature contracts
export const appContract = oc.router({
  user: userContract,
  health: healthContract,
  deployment: deploymentContract,
  traefik: traefikContract,
  project: projectContract,
  service: serviceContract,
});

export type AppContract = typeof appContract;

// Re-export individual contracts and schemas
export * from "./modules/index";
