import { Controller } from "@nestjs/common";
import { Effect } from "effect";

import { procedure } from "@deployer/nest-effect";
import { declareProcedures, MeshController } from "@deployer/nest-mesh";
import { nodeAgentContract } from "@deployer/node-agent-contracts";

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
 * A controller without the controller's HTTP surface — a method per procedure, `procedure(contract).effect(...)` and the
 * shared Effect context — and a `static procedures` map saying which method serves which node contract procedure. The
 * transport module's resolver builds the node router from that map (the requirement gate audits the methods because they
 * are controllers), and the guard is the second lock: the socket marks its context `nodeDoor`.
 */
@Controller()
export class NodeDoorController extends MeshController {
  static readonly procedures = declareProcedures({
    state: { door: "node", group: "node", key: "state", contract: node.state },
    configure: { door: "node", group: "node", key: "configure", contract: node.configure },
    status: { door: "node", group: "node", key: "status", contract: node.status },
    settings: { door: "node", group: "node", key: "settings", contract: node.settings },
    labels: { door: "node", group: "node", key: "labels", contract: node.labels },
  });

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
