import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { Effect } from "effect";

import { meshAgentContract } from "@deployer/mesh-agent-contracts";
import { EffectContextOf } from "@deployer/nest-effect";

import { serveMeshPeer } from "../../../core/orpc/serve";
import { MeshDomainModule } from "../mesh.module";
import { AccessChecks } from "../services/access-checks.service";

const access = meshAgentContract.access;

/** What a service asks its agent about a peer that connects to it: the service never holds the swarm's credential. */
@Controller()
export class MeshAccessController {
  @Implement(access.verify)
  verify() {
    return implement(access.verify).use(MeshDomainModule[EffectContextOf]).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const checks = yield* AccessChecks;
          return { ok: yield* checks.verify(input.presented, input.replicaId) };
        }),
      );
    });
  }
}
