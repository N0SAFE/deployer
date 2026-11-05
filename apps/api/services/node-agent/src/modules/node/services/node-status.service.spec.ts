import { DatabaseSync } from "node:sqlite";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { AgentStore, agentStoreOver } from "../../../local/agent-store";
import { SwarmCredential, swarmCredentialFrom } from "../../../local/swarm-credential";
import { OVERLAY_SELF_SECRET } from "../../../network/overlay";
import { type WireguardDump } from "../../../network/wireguard";
import { HostCommands, WireguardDriver, WireguardPaths } from "../../../network/wireguard.service";
import { AgentLoad } from "../../mesh/services/agent-load.service";
import { NodeAgents, type KnownAgent } from "../../mesh/services/node-agents.service";
import { NodeIdentity } from "../../mesh/services/node-identity.service";
import { RelayMetrics } from "../../mesh/services/relay-metrics.service";
import { AdvertisedAddress } from "../../mesh/services/roster-gossip.service";

import { NodeStatus } from "./node-status.service";

const ADVERTISED = "ws://10.0.0.7:3106/mesh/ws";

const ourOverlay = {
  wireguardKey: "our-key",
  meshAddress: "10.88.0.1",
  endpoint: "198.51.100.1:51820",
  listenPort: 51_820,
};

const dump = (latestHandshakeAt: number | null): WireguardDump => ({
  publicKey: "our-key",
  listenPort: 51_820,
  peers: {
    "peer-a-key": {
      publicKey: "peer-a-key",
      endpoint: "203.0.113.9:51820",
      allowedIps: ["10.88.0.2/32"],
      latestHandshakeAt,
      rxBytes: 1,
      txBytes: 2,
    },
  },
});

const agent = (nodeId: string, overlay: KnownAgent["overlay"]): KnownAgent => ({
  nodeId,
  address: `ws://${nodeId}.example:4000`,
  overlay,
  labels: {},
});

/** A node with a real (in-memory) store; the kernel and the roster are the two things a test replaces. */
function statusFixture(options: { readonly dump?: WireguardDump | null; readonly agents?: readonly KnownAgent[] } = {}) {
  const store = agentStoreOver(new DatabaseSync(":memory:") as never);
  const agents = new NodeAgents.live(new Map((options.agents ?? []).map((known) => [known.nodeId, known])));
  const driver = { dump: () => Effect.succeed(options.dump ?? null) } as unknown as WireguardDriver["Service"];

  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
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
    >,
  ) => {
    const provided = effect.pipe(Effect.provideService(AgentStore, store), Effect.provideService(NodeIdentity, { nodeId: "node-a" }));
    // The fake driver never runs a host command, but the driver's type carries the ports it would use.
    const withPorts = provided.pipe(
      Effect.provideService(NodeAgents, agents),
      Effect.provideService(WireguardDriver, driver),
      Effect.provideService(HostCommands, new HostCommands.live()),
      Effect.provideService(WireguardPaths, new WireguardPaths.live()),
      Effect.provideService(SwarmCredential, swarmCredentialFrom({ secret: "swarm-secret", swarmId: "swarm-1" })),
      Effect.provideService(AgentLoad, new AgentLoad.live({ now: () => 0, eventLoopLagMs: () => 3 })),
      Effect.provideService(RelayMetrics, new RelayMetrics.live()),
      Effect.provideService(AdvertisedAddress, { address: ADVERTISED }),
    );
    return Effect.runPromise(withPorts);
  };

  return { store, run };
}

describe("NodeStatus", () => {
  it("answers with the interface down and the roster's peers when the overlay interface is absent", async () => {
    const node = statusFixture({ agents: [agent("node-b", { wireguardKey: "peer-a-key", meshAddress: "10.88.0.2", endpoint: "203.0.113.9:51820", listenPort: 51_820 })] });

    const status = await node.run(new NodeStatus.live().status());

    expect(status).toEqual({
      agentId: "node-a",
      swarmId: "swarm-1",
      advertiseAddress: ADVERTISED,
      load: { eventLoopLagMs: 3, bytesPerSecond: 0, openStreams: 0 },
      relay: { forwarded: 0, noRoute: 0, unreachable: 0 },
      interfaceUp: false,
      meshAddress: null,
      listenPort: 51_820,
      peers: [{ nodeId: "node-b", meshAddress: "10.88.0.2", endpoint: "203.0.113.9:51820", latestHandshakeAt: null }],
    });
  });

  it("reads this node's overlay address and the peer's handshake, by public key, from a live interface", async () => {
    const node = statusFixture({
      dump: dump(1_700_000_000_000),
      agents: [agent("node-b", { wireguardKey: "peer-a-key", meshAddress: "10.88.0.2", endpoint: "203.0.113.9:51820", listenPort: 51_820 })],
    });
    await Effect.runPromise(node.store.putSecret(OVERLAY_SELF_SECRET, JSON.stringify(ourOverlay)));

    const status = await node.run(new NodeStatus.live().status());

    expect(status).toMatchObject({
      interfaceUp: true,
      meshAddress: "10.88.0.1",
      listenPort: 51_820,
      peers: [{ nodeId: "node-b", latestHandshakeAt: 1_700_000_000_000 }],
    });
  });

  it("lists a peer with no overlay as nulls instead of hiding it, and no peer as an empty list", async () => {
    const node = statusFixture({ dump: dump(null), agents: [agent("node-b", null)] });

    const withPeer = await node.run(new NodeStatus.live().status());
    expect(withPeer.peers).toEqual([{ nodeId: "node-b", meshAddress: null, endpoint: null, latestHandshakeAt: null }]);

    const alone = statusFixture();
    expect((await alone.run(new NodeStatus.live().status())).peers).toEqual([]);
  });
});
