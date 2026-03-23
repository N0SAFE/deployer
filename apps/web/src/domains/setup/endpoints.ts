import { orpc } from "@/lib/orpc";

export const setupEndpoints = {
  getStatus: orpc.setup.getStatus,
  getStateMachine: orpc.setup.getStateMachine,
  initialize: orpc.setup.initialize,
  configureDatabase: orpc.setup.configureDatabase,
  getNodeStatus: orpc.setup.getNodeStatus,
} as const;

export type SetupEndpoints = typeof setupEndpoints;
