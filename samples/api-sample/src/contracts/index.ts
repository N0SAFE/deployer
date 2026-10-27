import { authContract } from "./auth.contract";
import { demoContract } from "./demo.contract";
import { planetContract } from "./planet.contract";
import { logsContract } from "./stream.contract";

/**
 * The whole HTTP surface, composed from per-module contracts. Nothing here
 * knows about NestJS, Effect, MSW or OpenTelemetry — clients, mocks and the
 * OpenAPI document are all derived from this single object.
 */
export const contract = {
  planet: planetContract,
  auth: authContract,
  logs: logsContract,
  demo: demoContract,
} as const;

export { planetSchema, type Planet } from "./planet.contract";
export { logEventSchema } from "./stream.contract";
