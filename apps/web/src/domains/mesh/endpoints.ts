import { orpc } from "@/lib/orpc";

/**
 * Mesh domain endpoints
 *
 * Temporary control-plane bindings for fleet mesh operations.
 */
export const meshEndpoints = {
  getLocalNode: orpc.core.mesh.getLocalNode,
  listPeers: orpc.core.mesh.listPeers,
  listPeerSessions: orpc.core.mesh.listPeerSessions,
  listEventStreams: orpc.core.mesh.listEventStreams,
  findEventStreamById: orpc.core.mesh.findEventStreamById,
  subscribeEventStream: orpc.core.mesh.subscribeEventStream,
  planStreamRoute: orpc.core.mesh.planStreamRoute,
  connectPeer: orpc.core.mesh.connectPeer,
  disconnectPeer: orpc.core.mesh.disconnectPeer,
  heartbeatPeer: orpc.core.mesh.heartbeatPeer,
  membershipSnapshot: orpc.core.mesh.membershipSnapshot,
  reconcileMembership: orpc.core.mesh.reconcileMembership,
  lookupResource: orpc.core.mesh.lookupResource,
  upsertResourceIndex: orpc.core.mesh.upsertResourceIndex,
} as const;

export type MeshEndpoints = typeof meshEndpoints;