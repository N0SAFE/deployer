import { Effect } from "effect";

import { MeshLocalOnly } from "../../modules/mesh/mesh.errors";

/**
 * The node's own unix socket is the only door allowed to change the node.
 *
 * The transport marks the local socket's context with `nodeDoor: true`; the HTTP surface and any peer websocket have no
 * such mark, so a handler that requires it refuses them. This is the guard behind `node.*` being a controller (and so
 * under Nest DI and the requirement audit) without being callable over the network.
 */
export const requireNodeDoor = (context: unknown): Effect.Effect<void, MeshLocalOnly> =>
  (context as { readonly nodeDoor?: boolean }).nodeDoor === true
    ? Effect.void
    : Effect.fail(new MeshLocalOnly({}));
