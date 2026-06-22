import { orpc } from "@/lib/orpc";

/**
 * Mesh domain endpoints
 *
 * Control-plane bindings for fleet mesh operations.
 */
export const meshEndpoints = {
  getLocalNode: orpc.mesh.getLocalNode,
  streamEvents: orpc.mesh.streamEvents,
  listPeers: orpc.mesh.listPeers,
  listPeerSessions: orpc.mesh.listPeerSessions,
  listEventStreams: orpc.mesh.listEventStreams,
  findEventStreamById: orpc.mesh.findEventStreamById,
  subscribeEventStream: orpc.mesh.subscribeEventStream,
  planStreamRoute: orpc.mesh.planStreamRoute,
  connectPeer: orpc.mesh.connectPeer,
  disconnectPeer: orpc.mesh.disconnectPeer,
  heartbeatPeer: orpc.mesh.heartbeatPeer,
  membershipSnapshot: orpc.mesh.membershipSnapshot,
  reconcileMembership: orpc.mesh.reconcileMembership,
  lookupResource: orpc.mesh.lookupResource,
  upsertResourceIndex: orpc.mesh.upsertResourceIndex,

  // ─── Trust & Security ──────────────────────────────────────────────
  trustKeyringStatus: orpc.mesh.trustKeyringStatus,
  trustKeyringSecrets: orpc.mesh.trustKeyringSecrets,
  trustKeyringRotate: orpc.mesh.trustKeyringRotate,
  trustKeyringConvergenceStatus: orpc.mesh.trustKeyringConvergenceStatus,
  trustStrictReadiness: orpc.mesh.trustStrictReadiness,
  trustStrictModeSet: orpc.mesh.trustStrictModeSet,
  trustStrictRolloutPlan: orpc.mesh.trustStrictRolloutPlan,
  trustStrictRollback: orpc.mesh.trustStrictRollback,

  // ─── Node Configuration ─────────────────────────────────────────
  getNodeConfig: orpc.mesh.getNodeConfig,
  updateNodeConfig: orpc.mesh.updateNodeConfig,
  regenerateNodeConfigSecret: orpc.mesh.regenerateNodeConfigSecret,
  testNodeConfigDb: orpc.mesh.testNodeConfigDb,
} as const;

export type MeshEndpoints = typeof meshEndpoints;