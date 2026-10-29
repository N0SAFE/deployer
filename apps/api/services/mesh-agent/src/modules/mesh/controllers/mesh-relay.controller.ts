import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { Effect } from "effect";

import { meshAgentContract } from "@deployer/mesh-agent-contracts";
import { EffectContextOf } from "@deployer/nest-effect";

import { serveMeshPeer } from "../../../core/orpc/serve";
import { MeshDomainModule } from "../mesh.module";
import { MeshRelay, relayEvents } from "../services/relay.service";

const relay = meshAgentContract.relay;

/**
 * Every call between services, as one procedure.
 *
 * Thin by design: the handler asks `MeshRelay` what the call came to and returns it as the contract's event sequence.
 * Failures are the target's own `ORPCError`s, `MESH_DIRECT` grants, or the agent's domain errors mapped by kind.
 */
@Controller()
export class MeshRelayController {
  @Implement(relay.call)
  call() {
    return implement(relay.call).use(MeshDomainModule[EffectContextOf]).effect(function* ({ input, context }) {
      const outcome = yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const meshRelay = yield* MeshRelay;
          return yield* meshRelay.relay(input);
        }),
      );
      return relayEvents(outcome);
    });
  }
}
