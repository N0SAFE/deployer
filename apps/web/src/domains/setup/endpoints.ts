import { orpc } from "@/lib/orpc";

/**
 * Setup contract endpoints — matches the canonical setupContract from @repo/api-contracts.
 *
 * Available endpoints:
 * - getState              → SetupStateSnapshot (check if setup is needed)
 * - getNodeStatus         → Node status info
 * - probeDatabase         → Test a PostgreSQL URL (no side effects)
 * - probeMesh             → Test a mesh URL reachability
 * - remoteAuth            → Authenticate against a remote mesh (returns authToken)
 * - triggerInitialize     → POST — start initialization in the background
 * - getInitializeStream   → GET observable — SSE stream of setup progress events
 */
export const setupEndpoints = {
  getState: orpc.setup.getState,
  getNodeStatus: orpc.setup.getNodeStatus,
  probeDatabase: orpc.setup.probeDatabase,
  probeMesh: orpc.setup.probeMesh,
  remoteAuth: orpc.setup.remoteAuth,
  triggerInitialize: orpc.setup.triggerInitialize,
  getInitializeStream: orpc.setup.getInitializeStream,
} as const;

export type SetupEndpoints = typeof setupEndpoints;
