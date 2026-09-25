import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";

// Import all contract definitions
import { healthCheckContract } from "./check";
import { healthDetailedContract } from "./detailed";

// Combine into main health contract
export const healthContract = oc.meta(openapi({ tags: ["Health"], prefix: "/health" })).router({
  check: healthCheckContract,
  detailed: healthDetailedContract,
});

export type HealthContract = typeof healthContract;

// Re-export everything from individual contracts
export * from './check';
export * from './detailed';
