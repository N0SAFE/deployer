import { Controller } from "@nestjs/common";
import { Effect } from "effect";

import { nodeAgentContract } from "@deployer/node-agent-contracts";
import { MeshTransport, NodeProcedure } from "@deployer/nest-mesh";
import { procedure } from "@deployer/nest-effect";

import { requireNodeDoor } from "../../core/orpc/node-door.guard";
import { serveMeshPeer } from "../../core/orpc/serve";

import { NodeLabels } from "./services/node-labels.service";
import { NodeSettings } from "./services/node-settings.service";
import { NodeState } from "./services/node-state.service";
import { NodeStatus } from "./services/node-status.service";

const node = nodeAgentContract.node;

/**
 * The node door: this node's own record and its mesh, for the services of this node.
 *
 * A Nest provider with the controller's shape — a method per procedure, `procedure(contract).effect(...)` and the
 * shared Effect context — and none of the controller's HTTP surface: `NodeProcedure` records what each method is, and
 * the transport module's resolver builds the node router from those records. The guard is the second lock: the socket
 * marks its context `nodeDoor`, so even if a route were mounted it could not answer.
 */
@MeshTransport()
@Controller()
export class NodeDoorController {
  @NodeProcedure(node.state)
  state() {
    return procedure(node.state).effect(function* ({ context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          yield* requireNodeDoor(context);
          const service = yield* NodeState;
          return yield* service.state();
        }),
      );
    });
  }

  @NodeProcedure(node.configure)
  configure() {
    return procedure(node.configure).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          yield* requireNodeDoor(context);
          const service = yield* NodeState;
          return yield* service.configure(input);
        }),
      );
    });
  }

  @NodeProcedure(node.status)
  status() {
    return procedure(node.status).effect(function* ({ context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          yield* requireNodeDoor(context);
          const service = yield* NodeStatus;
          return yield* service.status();
        }),
      );
    });
  }

  @NodeProcedure(node.settings)
  settings() {
    return procedure(node.settings).effect(function* ({ context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          yield* requireNodeDoor(context);
          const service = yield* NodeSettings;
          return yield* service.all();
        }),
      );
    });
  }

  @NodeProcedure(node.labels)
  labels() {
    return procedure(node.labels).effect(function* ({ input, context }) {
      return yield* serveMeshPeer(context)(
        Effect.gen(function* () {
          yield* requireNodeDoor(context);
          const service = yield* NodeLabels;
          return yield* service.merge(input.labels);
        }),
      );
    });
  }
}
