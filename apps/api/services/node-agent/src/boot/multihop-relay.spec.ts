import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { os } from "@orpc/server";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { nodeDoor, openWebSocketConnection, pooledLink, relayLink } from "@deployer/mesh-client";
import { attachMeshWebSocket, type MeshWebSocket } from "@deployer/mesh-server";
import { MESH_WEBSOCKET_PATH } from "@deployer/node-agent-contracts";


import type { NodeAgentsShape } from "@/modules/mesh/services/node-agents.service";

import { type BootedAgent, bootAgent, peerClient, removeDataDir } from "./boot-agent";

import type { ClientContext, ClientLink } from "@orpc/client";
import type { AddressInfo } from "node:net";

const SECRET = "mesh-multihop-spec-secret-of-at-least-32-chars";

type Agent = BootedAgent;

const linkTo = (agent: Agent) =>
  pooledLink<ClientContext>({
    target: agent.ws,
    maxConnections: 1,
    multiplex: 8,
    idleMs: 1_000,
    open: () => Promise.resolve(openWebSocketConnection({ url: `${agent.ws}?credential=${SECRET}`, reconnectDelayMs: 20 })),
  });

/** A link that never opens: the partial partition this test needs, since gossip makes every address symmetric. */
const deadLink: ClientLink<ClientContext> = {
  call: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:1")),
};

/**
 * A's roster, with its link to C replaced: A cannot dial C, and everyone else can.
 *
 * A proxy, not a spread: `base` is a class instance whose methods live on the prototype, so `{ ...base }` would copy the
 * state fields and none of the methods.
 */
const cannotReach = (nodeId: string) => (base: NodeAgentsShape): NodeAgentsShape =>
  new Proxy(base, {
    get: (target, key) =>
      key === "linkTo"
        ? (id: string) => (id === nodeId ? Effect.succeed(deadLink) : target.linkTo(id))
        : Reflect.get(target, key) as unknown,
  });

/**
 * A three-agent partition, on real sockets: A can reach B, B can reach C, and A cannot reach C at all.
 *
 * A caller names C and talks to A. A's direct link fails, so A hands the call to B — the agent that taught A about C —
 * and B serves it from C's own replica. A reports the forwarding in `node.status.relay`, which is what an operator
 * watching a partition reads.
 */
describe("multi-hop relay over real sockets", () => {
  let a: Agent;
  let b: Agent;
  let c: Agent;
  let replica: { server: Server; gateway: MeshWebSocket };

  const boot = async (nodeId: string, seeds: readonly string[], extra: { readonly nodeAgents?: (base: NodeAgentsShape) => NodeAgentsShape } = {}) =>
    bootAgent({
      pin: { nodeId, secret: SECRET, seeds: [...seeds] },
      socketPath: join(tmpdir(), `${nodeId}-${String(Date.now())}-${String(Math.random()).slice(2)}.sock`),
      ...extra,
    });

  beforeAll(async () => {
    const server = createServer((_request, response) => response.writeHead(404).end());
    const gateway = attachMeshWebSocket({
      server,
      path: MESH_WEBSOCKET_PATH,
      router: { logs: { list: os.handler(() => ({ lines: 3, servedBy: "runtime-c" })) } } as never,
      verify: (credential) => credential === SECRET,
      context: () => ({}),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    replica = { server, gateway };
    const address = `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}${MESH_WEBSOCKET_PATH}`;

    c = await boot("node-c", []);
    const registered = await Effect.runPromise(
      peerClient(c, SECRET).directory.register({ service: "runtime", replicaId: "runtime-c", address }),
    );
    expect(registered).toMatchObject({ replicaId: "runtime-c", nodeId: "node-c" });

    b = await boot("node-b", [c.ws]);
    a = await boot("node-a", [b.ws], { nodeAgents: cannotReach("node-c") });
  }, 60_000);

  afterAll(async () => {
    await Promise.all([a, b, c].map((agent) => agent.stop().catch(() => undefined)));
    [a, b, c].forEach((agent) => { removeDataDir(agent.dataDir); });
    await replica.gateway.close();
    await new Promise<void>((resolve) => replica.server.close(() => { resolve(); }));
  });

  it("answers a call pinned to C through B, and reports the forwarding on A", async () => {
    // Gossip first: A must know C's replica and the peer that taught it about C, both of which arrive through B.
    await vi.waitFor(async () => {
      const resolved = await Effect.runPromise(peerClient(a, SECRET).directory.resolve({ service: "runtime" }));
      expect(resolved).toMatchObject({ replica: { replicaId: "runtime-c", nodeId: "node-c" } });
    }, { timeout: 20_000, interval: 100 });

    const caller = linkTo(a);
    try {
      const answer = await relayLink({ agent: caller, target: { service: "runtime", node: "node-c" } }).call(["logs", "list"], {}, { context: {} });
      expect(answer).toEqual({ lines: 3, servedBy: "runtime-c" });
    } finally {
      await caller.closeAll();
    }

    const status = await nodeDoor({ socketPath: a.transport.localSocketPath }).status();
    expect(status?.relay).toEqual({ forwarded: 1, noRoute: 0, unreachable: 1 });
  }, 60_000);
});
