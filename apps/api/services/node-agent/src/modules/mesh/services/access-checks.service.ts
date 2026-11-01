import { Context, Effect } from "effect";

import { SwarmCredential } from "../../../local/swarm-credential";
import { verifyLease } from "../rules/lease-token";

import { MeshClock } from "./mesh-clock.service";

export type AccessChecksShape = {
  /**
   * Whether what a peer presented to one of this node's services proves it belongs: the swarm's credential (an agent
   * relaying a call), or a direct grant's token that names this very replica (a caller this agent sent there).
   */
  readonly verify: (presented: string, replicaId: string) => Effect.Effect<boolean, never, SwarmCredential | MeshClock>;
};

export class AccessChecks extends Context.Service<AccessChecks, AccessChecksShape>()("node-agent/AccessChecks") {
  static readonly live: AccessChecksShape = {
    verify: Effect.fn("AccessChecks.verify")(function* (presented: string, replicaId: string) {
      const credential = yield* SwarmCredential;
      const clock = yield* MeshClock;
      return credential.verify(presented) || verifyLease(presented, credential.current(), replicaId, clock.now()).ok;
    }),
  };
}
