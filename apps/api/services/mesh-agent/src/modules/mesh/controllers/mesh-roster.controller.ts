import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { Effect } from "effect";

import { meshAgentContract } from "@deployer/mesh-agent-contracts";
import { EffectContextOf } from "@deployer/nest-effect";

import { serveMeshPeer } from "../../../core/orpc/serve";
import { MeshDomainModule } from "../mesh.module";
import { RosterGossip } from "../services/roster-gossip.service";

const roster = meshAgentContract.roster;

/** The gossip between agents: a peer says what it knows and is answered with what this agent knows. */
@Controller()
export class MeshRosterController {
  @Implement(roster.exchange)
  exchange() {
    return implement(roster.exchange).use(MeshDomainModule[EffectContextOf]).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const gossip = yield* RosterGossip;
          return yield* gossip.exchange(input);
        }),
      );
    });
  }

  /** Points the agent at one agent of the swarm. It can be called at any time: the agent works alone until it is. */
  @Implement(roster.join)
  join() {
    return implement(roster.join).use(MeshDomainModule[EffectContextOf]).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const gossip = yield* RosterGossip;
          const { learned, agents } = yield* gossip.join(input.address);
          return { learned, agents: [...agents] };
        }),
      );
    });
  }
}
