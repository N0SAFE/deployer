import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { Effect } from "effect";

import { meshAgentContract } from "@deployer/mesh-agent-contracts";
import { EffectContextOf } from "@deployer/nest-effect";

import { serveMeshPeer } from "../../../core/orpc/serve";
import { MeshDomainModule } from "../mesh.module";
import { JoinTokens } from "../services/join-tokens.service";
import { NodeIdentity } from "../services/node-identity.service";
import { AdvertisedAddress } from "../services/roster-gossip.service";
import { NodeAgents } from "../services/node-agents.service";
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

  /** Joins the swarm a token names. It can be called at any time: the agent works alone until it is. */
  @Implement(roster.join)
  join() {
    return implement(roster.join).use(MeshDomainModule[EffectContextOf]).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const tokens = yield* JoinTokens;
          const { learned } = yield* tokens.redeem(input.token);
          const known = yield* (yield* NodeAgents).known();
          return { learned, agents: known.map(({ nodeId, address }) => ({ nodeId, address })) };
        }),
      );
    });
  }

  /** Issues a token for a new node to join this agent's swarm. */
  @Implement(roster.token)
  token() {
    return implement(roster.token).use(MeshDomainModule[EffectContextOf]).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const tokens = yield* JoinTokens;
          return yield* tokens.issue(input.ttlMs);
        }),
      );
    });
  }

  /** What this agent knows of the swarm, for the dashboard. Read-only. */
  @Implement(roster.view)
  view() {
    return implement(roster.view).use(MeshDomainModule[EffectContextOf]).effect(function* ({ context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const self = yield* NodeIdentity;
          const advertised = yield* AdvertisedAddress;
          const known = yield* (yield* NodeAgents).known();
          return {
            self: { nodeId: self.nodeId, address: advertised.address },
            agents: known.map(({ nodeId, address }) => ({ nodeId, address })),
          };
        }),
      );
    });
  }
}
