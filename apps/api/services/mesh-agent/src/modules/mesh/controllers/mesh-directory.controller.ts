import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { Effect } from "effect";

import { meshAgentContract } from "@deployer/mesh-agent-contracts";
import { EffectContextOf } from "@deployer/nest-effect";

import { serveMeshPeer } from "../../../core/orpc/serve";
import { MeshDomainModule } from "../mesh.module";
import { MeshDirectory } from "../services/directory.service";

import type { ReplicaRecord } from "../rules/replica-record";

const directory = meshAgentContract.directory;

/** The record as the contract declares it: the wire shape has a mutable `keys`, the agent's record a readonly one. */
const toReplicaDto = (record: ReplicaRecord) => ({ ...record, keys: [...record.keys] });

/**
 * The service directory, served to the services on this node and to other agents.
 *
 * Thin by design: `.effect()` resolves `MeshDirectory` from `effect/context`, and this class only maps its results to
 * the shapes the contract declares. `MeshNoReplica` is the one domain error; its kind (`not_found`) maps to the
 * declared `NOT_FOUND`.
 */
@Controller()
export class MeshDirectoryController {
  /** A replica announces itself or refreshes its lease. */
  @Implement(directory.register)
  register() {
    return implement(directory.register).use(MeshDomainModule[EffectContextOf]).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const meshDirectory = yield* MeshDirectory;
          return toReplicaDto(yield* meshDirectory.register(input));
        }),
      );
    });
  }

  /** A replica leaves, or its process is stopping. */
  @Implement(directory.unregister)
  unregister() {
    return implement(directory.unregister).use(MeshDomainModule[EffectContextOf]).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const meshDirectory = yield* MeshDirectory;
          return { removed: yield* meshDirectory.unregister(input.replicaId) };
        }),
      );
    });
  }

  /** Which replica a call should go to. */
  @Implement(directory.resolve)
  resolve() {
    return implement(directory.resolve).use(MeshDomainModule[EffectContextOf]).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const meshDirectory = yield* MeshDirectory;
          const resolution = yield* meshDirectory.resolve(input);
          return { replica: toReplicaDto(resolution.replica), reason: resolution.reason };
        }),
      );
    });
  }

  /** Every live replica this agent knows of. */
  @Implement(directory.snapshot)
  snapshot() {
    return implement(directory.snapshot).use(MeshDomainModule[EffectContextOf]).effect(function* ({ context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          const meshDirectory = yield* MeshDirectory;
          return { replicas: (yield* meshDirectory.snapshot()).map(toReplicaDto) };
        }),
      );
    });
  }
}
