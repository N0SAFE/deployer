import { createServer, type Server } from "node:http";

import { os } from "@orpc/server";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { agentLink, createMeshClient, openWebSocketConnection, pooledLink, relayLink } from "@deployer/mesh-client";
import { attachMeshWebSocket, type MeshWebSocket } from "@deployer/mesh-server";
import { MESH_WEBSOCKET_PATH, type nodeAgentContract } from "@deployer/node-agent-contracts";

import { adminClient, type BootedAgent, bootAgent, peerClient, removeDataDir } from "./boot-agent";

import type { ClientContext } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import type { AddressInfo } from "node:net";

const SECRET = "mesh-cluster-spec-secret-of-at-least-32-chars";

type Agent = BootedAgent;

/** A dev agent: its credential is pinned, so the test needs no join. */
const bootAgentNamed = (nodeId: string, seeds: string[] = []) => bootAgent({ pin: { nodeId, secret: SECRET, seeds } });

const linkTo = (agent: Agent) =>
  pooledLink<ClientContext>({
    target: agent.ws,
    maxConnections: 1,
    multiplex: 8,
    idleMs: 1_000,
    open: () => Promise.resolve(openWebSocketConnection({ url: `${agent.ws}?credential=${SECRET}`, reconnectDelayMs: 20 })),
  });

/** The node's own door: the only one a join is allowed on. */
const local = (agent: Agent) =>
  createMeshClient<ContractRouterClient<typeof nodeAgentContract>>(agentLink(agent.transport.localSocketPath));

/**
 * A mesh of two real agents and one real replica, all on real sockets.
 *
 * The replica registers with agent A only. Agent B learns of it by gossip alone, and a caller that talks to agent B
 * reaches the replica through B's relay, over pooled persistent links, with the mesh credential checked at every hop.
 */
describe("mesh cluster over real sockets", () => {
  let a: Agent;
  let b: Agent;
  let replica: { server: Server; gateway: MeshWebSocket; address: string };

  beforeAll(async () => {
    const server = createServer((_request, response) => response.writeHead(404).end());
    const gateway = attachMeshWebSocket({
      server,
      path: MESH_WEBSOCKET_PATH,
      router: { logs: { list: os.handler(() => ({ lines: 3, servedBy: "runtime-1" })) } } as never,
      verify: (credential) => credential === SECRET,
      context: () => ({}),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    replica = { server, gateway, address: `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}${MESH_WEBSOCKET_PATH}` };

    a = await bootAgentNamed("node-a");
    const registered = await Effect.runPromise(
      peerClient(a, SECRET).directory.register({ service: "runtime", replicaId: "runtime-1", address: replica.address, keys: ["stream-1"] }),
    );
    expect(registered).toMatchObject({ replicaId: "runtime-1", nodeId: "node-a" });

    b = await bootAgentNamed("node-b", [a.ws]);
  }, 60_000);

  afterAll(async () => {
    await Promise.all([a, b].map((agent) => agent.stop()));
    [a, b].forEach((agent) => { removeDataDir(agent.dataDir); });
    await replica.gateway.close();
    await new Promise<void>((resolve) => replica.server.close(() => { resolve(); }));
  });

  it("teaches agent B the replica registered on agent A, by gossip alone", async () => {
    await vi.waitFor(async () => {
      const resolved = await Effect.runPromise(peerClient(b, SECRET).directory.resolve({ service: "runtime", key: "stream-1" }));
      expect(resolved).toMatchObject({ reason: "key-holder", replica: { replicaId: "runtime-1", nodeId: "node-a" } });
    });
  });

  it("answers a call made to agent B with the replica's own answer, relayed over real links", async () => {
    const caller = linkTo(b);

    const answer = await relayLink({ agent: caller, target: { service: "runtime", key: "stream-1" } }).call(["logs", "list"], {}, { context: {} });

    expect(answer).toEqual({ lines: 3, servedBy: "runtime-1" });
    await caller.closeAll();
  });

  it("refuses a call to an agent without the mesh credential", async () => {
    await expect(Effect.runPromise(peerClient(b).directory.snapshot({}))).rejects.toBeDefined();
  });

  it("answers a heavy call with a grant, and the caller reaches the replica directly", async () => {
    const caller = linkTo(b);

    const { grantFollowingLink } = await import("@deployer/mesh-client");
    const link = grantFollowingLink({
      agent: relayLink({ agent: caller, target: { service: "runtime", key: "stream-1", heavy: true } }),
      direct: (grant) =>
        pooledLink<ClientContext>({
          target: grant.replicaId,
          maxConnections: 1,
          multiplex: 8,
          idleMs: 1_000,
          open: () => Promise.resolve(openWebSocketConnection({ url: `${grant.address}?credential=${SECRET}`, reconnectDelayMs: 20 })),
        }),
    });

    await expect(link.call(["logs", "list"], {}, { context: {} })).resolves.toEqual({ lines: 3, servedBy: "runtime-1" });
    await caller.closeAll();
  });

  it("forwards a call pinned to another node to that node's agent, which serves its own node only", async () => {
    await vi.waitFor(async () => {
      await Effect.runPromise(peerClient(a, SECRET).directory.resolve({ service: "runtime" }));
    });
    const caller = linkTo(a);

    // Agent B has no runtime replica of its own, so a call pinned to node-b has nowhere to go.
    await expect(
      relayLink({ agent: caller, target: { service: "runtime", node: "node-b" } }).call(["logs", "list"], {}, { context: {} }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await caller.closeAll();
  });

  it("starts alone and fully working, then joins the swarm later without redoing anything", async () => {
    const c = await bootAgentNamed("node-c");
    try {
      const peerC = peerClient(c, SECRET);
      await Effect.runPromise(peerC.directory.register({ service: "billing", replicaId: "billing-1", address: replica.address, load: 0.6 }));
      await Effect.runPromise(peerC.directory.register({ service: "billing", replicaId: "billing-2", address: replica.address, load: 0.1 }));

      // Alone: no seed, no peer, and it still serves both replicas of its own node from memory.
      const alone = await Effect.runPromise(peerC.directory.resolve({ service: "billing" }));
      expect(alone).toMatchObject({ reason: "local-node", replica: { replicaId: "billing-2", nodeId: "node-c" } });
      await expect(Effect.runPromise(peerC.directory.resolve({ service: "runtime" }))).rejects.toMatchObject({ code: "NOT_FOUND" });

      // Later: it is pointed at the swarm. What it held reaches the swarm, and what the swarm knows reaches it. A join is
      // the node's own act, so it happens on C's local socket, never over the network.
      const { token } = await Effect.runPromise(peerClient(a, SECRET).roster.token({}));
      const joined = await Effect.runPromise(adminClient(c).roster.join({ token }));
      expect(joined).toMatchObject({ learned: true });

      await vi.waitFor(async () => {
        const learned = await Effect.runPromise(peerC.directory.resolve({ service: "runtime", key: "stream-1" }));
        expect(learned).toMatchObject({ replica: { replicaId: "runtime-1", nodeId: "node-a" } });

        const announced = await Effect.runPromise(peerClient(a, SECRET).directory.resolve({ service: "billing" }));
        expect(announced).toMatchObject({ replica: { nodeId: "node-c" } });
      });
    } finally {
      await c.stop();
      removeDataDir(c.dataDir);
    }
  });

  it("has no HTTP surface for the mesh procedures", async () => {
    const response = await fetch(`${a.http}/mesh/roster/token`, { method: "POST" });

    expect(response.status).toBe(404);
  });
});
