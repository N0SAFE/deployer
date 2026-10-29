import { orpc } from "@/lib/orpc";

/**
 * Mesh domain endpoints
 *
 * Control-plane bindings for fleet mesh operations.
 */
export const meshEndpoints = {
  getLocalNode: orpc.mesh.getLocalNode,
  listPeers: orpc.mesh.listPeers,
  listPeerSessions: orpc.mesh.listPeerSessions,
  listEventStreams: orpc.mesh.listEventStreams,
  findEventStreamById: orpc.mesh.findEventStreamById,
  subscribeEventStream: orpc.mesh.subscribeEventStream,
  membershipSnapshot: orpc.mesh.membershipSnapshot,
  lookupResource: orpc.mesh.lookupResource,
  issueJoinToken: orpc.mesh.issueJoinToken,
  streamTopology: orpc.mesh.streamTopology,


  // ─── Node Configuration ─────────────────────────────────────────
  getNodeConfig: orpc.mesh.getNodeConfig,
  updateNodeConfig: orpc.mesh.updateNodeConfig,
  regenerateNodeConfigSecret: orpc.mesh.regenerateNodeConfigSecret,
  testNodeConfigDb: orpc.mesh.testNodeConfigDb,
} as const;

export type MeshEndpoints = typeof meshEndpoints;