import { defineInvalidations } from "@/domains/shared/helpers";
import { meshEndpoints } from "./endpoints";

export const meshInvalidations = defineInvalidations(meshEndpoints, {
  connectPeer: ({ keys }) => [
    keys.getLocalNode(),
    keys.listPeers(),
    keys.listPeerSessions(),
    keys.membershipSnapshot(),
  ],
  disconnectPeer: ({ keys }) => [
    keys.getLocalNode(),
    keys.listPeers(),
    keys.listPeerSessions(),
    keys.membershipSnapshot(),
  ],
  reconcileMembership: ({ keys }) => [
    keys.getLocalNode(),
    keys.listPeers(),
    keys.listPeerSessions(),
    keys.membershipSnapshot(),
  ],
  upsertResourceIndex: ({ keys }) => [
    keys.membershipSnapshot(),
  ],
  trustKeyringRotate: ({ keys }) => [
    keys.trustKeyringStatus(),
    keys.trustKeyringSecrets(),
    keys.trustKeyringConvergenceStatus(),
    keys.trustStrictReadiness(),
  ],
  trustStrictModeSet: ({ keys }) => [
    keys.trustStrictReadiness(),
    keys.trustStrictRolloutPlan(),
  ],
  trustStrictRollback: ({ keys }) => [
    keys.trustStrictReadiness(),
    keys.trustStrictRolloutPlan(),
  ],
  updateNodeConfig: ({ keys }) => [
    keys.getNodeConfig(),
    keys.getLocalNode(),
  ],
  regenerateNodeConfigSecret: ({ keys }) => [
    keys.getNodeConfig(),
    keys.trustKeyringStatus(),
    keys.trustKeyringSecrets(),
  ],
});
