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
});
