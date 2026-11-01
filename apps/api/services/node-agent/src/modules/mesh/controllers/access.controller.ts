import { Controller } from "@nestjs/common";
import { Effect } from "effect";

import { nodeAgentContract } from "@deployer/node-agent-contracts";
import { declareProcedures, MeshController } from "@deployer/nest-mesh";
import { procedure } from "@deployer/nest-effect";

import { serveMeshPeer } from "../../../core/orpc/serve";
import { AccessChecks } from "../services/access-checks.service";

const access = nodeAgentContract.access;

/** What a service asks its agent about a peer that connects to it: the service never holds the swarm's credential. */
@Controller()
export class AccessController extends MeshController {
  static readonly procedures = declareProcedures({
    verify: { door: "peer", group: "access", contract: access.verify },
  });

  verify() {
      return procedure(access.verify).effect(function* ({ input, context }) {
        return yield* serveMeshPeer(context)(
            Effect.gen(function* () {
          const checks = yield* AccessChecks;
          return { ok: yield* checks.verify(input.presented, input.replicaId) };
            }),
        );
      });
  }
}
