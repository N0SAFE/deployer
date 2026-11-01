import { Context, Effect } from "effect";

import type { MeshNodeStatus } from "@deployer/node-agent-contracts";

import { AgentStore, type AgentStoreError } from "../../../local/agent-store";
import { SwarmCredential } from "../../../local/swarm-credential";
import { DEFAULT_WIREGUARD_PORT, OVERLAY_SELF_SECRET, parseOverlaySelf } from "../../../network/overlay";
import { HostCommands, WireguardDriver, WireguardPaths } from "../../../network/wireguard.service";
import { AgentLoad } from "../../mesh/services/agent-load.service";
import { NodeAgents } from "../../mesh/services/node-agents.service";
import { NodeIdentity } from "../../mesh/services/node-identity.service";
import { RelayMetrics } from "../../mesh/services/relay-metrics.service";
import { AdvertisedAddress } from "../../mesh/services/roster-gossip.service";

export type NodeStatusShape = {
  /** This node's mesh, read from the kernel and the roster at ask time. */
  readonly status: () => Effect.Effect<
    MeshNodeStatus,
    AgentStoreError,
    | AgentStore
    | NodeIdentity
    | NodeAgents
    | WireguardDriver
    | HostCommands
    | WireguardPaths
    | SwarmCredential
    | AgentLoad
    | RelayMetrics
    | AdvertisedAddress
  >;
};

/**
 * The node's mesh, as its own agent sees it: the answer the old control API gave on `/v1/status`.
 *
 * The overlay interface is a kernel fact, so a node whose interface is absent answers `interfaceUp: false` rather than
 * failing: it is running, it just has no overlay yet. The peers come from the roster, so a peer with no overlay is
 * listed with nulls instead of disappearing from the answer.
 */
export class NodeStatus extends Context.Service<NodeStatus, NodeStatusShape>()("node-agent/NodeStatus") {
  static readonly live: NodeStatusShape = {
    status: Effect.fn("NodeStatus.status")(function* () {
      const store = yield* AgentStore;
      const identity = yield* NodeIdentity;
      const agents = yield* NodeAgents;
      const driver = yield* WireguardDriver;
      const credential = yield* SwarmCredential;
      const load = (yield* AgentLoad).sample();
      const relay = yield* (yield* RelayMetrics).snapshot();
      const advertised = yield* AdvertisedAddress;

      // An unreadable overlay is an absent one: the node still answers about itself.
      const overlay = parseOverlaySelf(
        yield* store.secret(OVERLAY_SELF_SECRET).pipe(Effect.catch(() => Effect.succeed(undefined))),
      );
      const dump = yield* driver.dump();
      const known = yield* agents.known();

      return {
        agentId: identity.nodeId,
        swarmId: credential.swarmId(),
        advertiseAddress: advertised.address,
        load,
        relay,
        interfaceUp: dump !== null,
        meshAddress: overlay?.meshAddress ?? null,
        listenPort: overlay?.listenPort ?? DEFAULT_WIREGUARD_PORT,
        peers: known.map((agent) => ({
          nodeId: agent.nodeId,
          meshAddress: agent.overlay?.meshAddress ?? null,
          endpoint: agent.overlay?.endpoint ?? null,
          latestHandshakeAt:
            agent.overlay === null ? null : (dump?.peers[agent.overlay.wireguardKey]?.latestHandshakeAt ?? null),
        })),
      };
    }),
  };
}
