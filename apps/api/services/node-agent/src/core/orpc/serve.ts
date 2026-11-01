import { Cause, Effect } from "effect";

import { Actor } from "@deployer/effect-core";
import { handle, provideRequest, type RequestContextInput } from "@deployer/effect-orpc";

/**
 * The node-agent's request boundary.
 *
 * A mesh request is authenticated by its credential before any handler runs (see `createMeshOrpcModule`), so there is
 * no user to derive: the caller acts as the `mesh-peer` system actor. Domain errors are mapped by kind and defects
 * are hidden behind the correlation id, as in every service.
 */
export const serveMeshPeer =
  (context: RequestContextInput) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      handle((cause, correlationId) => {
        console.error(`[svc-node-agent] defect ${correlationId}`, Cause.pretty(cause));
      }),
      provideRequest(context, () => Effect.succeed(Actor.system("mesh-peer"))),
    );
