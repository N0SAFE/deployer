import { Controller } from "@nestjs/common";
import { Effect } from "effect";

import { nodeAgentContract } from "@deployer/node-agent-contracts";
import { declareProcedures, MeshController } from "@deployer/nest-mesh";
import { procedure } from "@deployer/nest-effect";

import { serveMeshPeer } from "../../../core/orpc/serve";
import { MeshDirectory } from "../services/directory.service";

import type { ReplicaRecord } from "../rules/replica-record";

const directory = nodeAgentContract.directory;

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
export class DirectoryController extends MeshController {
  static readonly procedures = declareProcedures({
    register: { door: "peer", group: "directory", contract: directory.register },
    unregister: { door: "peer", group: "directory", contract: directory.unregister },
    resolve: { door: "peer", group: "directory", contract: directory.resolve },
    snapshot: { door: "peer", group: "directory", contract: directory.snapshot },
  });

  /** A replica announces itself or refreshes its lease. */
  register() {
      return procedure(directory.register).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
          Effect.gen(function* () {
        const meshDirectory = yield* MeshDirectory;
        return toReplicaDto(yield* meshDirectory.register(input));
          }),
      );
      });
  }

  /** A replica leaves, or its process is stopping. */
  unregister() {
      return procedure(directory.unregister).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
          Effect.gen(function* () {
        const meshDirectory = yield* MeshDirectory;
        return { removed: yield* meshDirectory.unregister(input.replicaId) };
          }),
      );
      });
  }

  /** Which replica a call should go to. */
  resolve() {
      return procedure(directory.resolve).effect(function* ({ input, context }) {
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
  snapshot() {
      return procedure(directory.snapshot).effect(function* ({ context }) {
      return yield* serveMeshPeer(context)(
          Effect.gen(function* () {
        const meshDirectory = yield* MeshDirectory;
        return { replicas: (yield* meshDirectory.snapshot()).map(toReplicaDto) };
          }),
      );
      });
  }
}
