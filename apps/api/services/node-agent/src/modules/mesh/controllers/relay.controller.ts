import { Controller } from "@nestjs/common";
import { Effect } from "effect";

import { procedure } from "@deployer/nest-effect";
import { declareProcedures, MeshController } from "@deployer/nest-mesh";
import { nodeAgentContract } from "@deployer/node-agent-contracts";

import { serveMeshPeer } from "../../../core/orpc/serve";
import { MeshRelay, relayEvents } from "../services/relay.service";

const relay = nodeAgentContract.relay;

/**
 * Every call between services, as one procedure.
 *
 * Thin by design: the handler asks `MeshRelay` what the call came to and returns it as the contract's event sequence.
 * Failures are the target's own `ORPCError`s, `MESH_DIRECT` grants, or the agent's domain errors mapped by kind.
 */
@Controller()
export class RelayController extends MeshController {
  static readonly procedures = declareProcedures({
    call: { door: "peer", group: "relay", contract: relay.call },
  });

  call() {
      return procedure(relay.call).effect(function* ({ input, context }) {
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
