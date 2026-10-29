import { createServer, type Server } from "node:http";


import { os } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MESH_WEBSOCKET_PATH } from "@deployer/mesh-agent-contracts";
import { openWebSocketConnection, pooledLink, relayLink } from "@deployer/mesh-client";
import { attachMeshWebSocket, type MeshWebSocket } from "@deployer/mesh-server";
import { MESH_CREDENTIAL_HEADER, createApiServerApp } from "@deployer/shared/server";

import type { MeshTransport } from "@/transport/mesh-transport";

import type { INestApplication } from "@nestjs/common";
import type { ClientContext } from "@orpc/client";
import type { AddressInfo } from "node:net";

const SECRET = "mesh-cluster-spec-secret-of-at-least-32-chars";

type Agent = { app: INestApplication; transport: MeshTransport; http: string; ws: string };

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => { resolve(); }));
  return port;
}

/**
 * One real agent: the real root module on a real port, serving the real websocket, gossiping for real. Each agent loads
 * its own copy of the modules, because the environment is read once when the module graph is first imported.
 */
async function bootAgent(nodeId: string, seeds: string[] = []): Promise<Agent> {
  const port = await freePort();
  const ws = `ws://127.0.0.1:${String(port)}${MESH_WEBSOCKET_PATH}`;
  Object.assign(process.env, {
    MESH_AGENT_SECRET: SECRET,
    MESH_NODE_ID: nodeId,
    MESH_ADVERTISE_URL: ws,
    MESH_SEEDS: seeds.join(","),
  });
  vi.resetModules();
  // The Effect extension patches `@orpc/server`, and a reset gives the new graph a fresh, unpatched copy.
  await import("@orpc/effect/extensions/effect");
  await import("@deployer/shared/core/orpc/context");
  const { MeshAgentServiceModule } = await import("@/app.module");
  const { startMeshTransport } = await import("@/transport/mesh-transport");
  const app = await createApiServerApp(MeshAgentServiceModule);
  await app.listen(port, "127.0.0.1");
  return { app, transport: await startMeshTransport(app, { gossipIntervalMs: 100 }), http: `http://127.0.0.1:${String(port)}`, ws };
}

const post = (agent: Agent, path: string, body: unknown) =>
  fetch(`${agent.http}${path}`, { method: "POST", headers: { "content-type": "application/json", [MESH_CREDENTIAL_HEADER]: SECRET }, body: JSON.stringify(body) });

const linkTo = (agent: Agent) =>
  pooledLink<ClientContext>({
    target: agent.ws,
    maxConnections: 1,
    multiplex: 8,
    idleMs: 1_000,
    open: () => Promise.resolve(openWebSocketConnection({ url: `${agent.ws}?credential=${SECRET}`, reconnectDelayMs: 20 })),
  });

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

    a = await bootAgent("node-a");
    const registered = await post(a, "/mesh/directory/register", { service: "runtime", replicaId: "runtime-1", address: replica.address, keys: ["stream-1"] });
    expect(registered.status).toBe(200);

    b = await bootAgent("node-b", [a.ws]);
  }, 60_000);

  afterAll(async () => {
    await Promise.all(
      [a, b].map(async (agent) => {
        await agent.transport.stop();
        await agent.app.close();
      }),
    );
    await replica.gateway.close();
    await new Promise<void>((resolve) => replica.server.close(() => { resolve(); }));
  });

  it("teaches agent B the replica registered on agent A, by gossip alone", async () => {
    await vi.waitFor(async () => {
      const response = await post(b, "/mesh/directory/resolve", { service: "runtime", key: "stream-1" });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ reason: "key-holder", replica: { replicaId: "runtime-1", nodeId: "node-a" } });
    });
  });

  it("answers a call made to agent B with the replica's own answer, relayed over real links", async () => {
    const caller = linkTo(b);

    const answer = await relayLink({ agent: caller, target: { service: "runtime", key: "stream-1" } }).call(["logs", "list"], {}, { context: {} });

    expect(answer).toEqual({ lines: 3, servedBy: "runtime-1" });
    await caller.closeAll();
  });

  it("refuses a call to an agent without the mesh credential", async () => {
    const response = await fetch(`${b.http}/mesh/directory/snapshot`);

    expect(response.status).toBe(401);
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
      const response = await post(a, "/mesh/directory/snapshot".replace("snapshot", "resolve"), { service: "runtime" });
      expect(response.status).toBe(200);
    });
    const caller = linkTo(a);

    // Agent B has no runtime replica of its own, so a call pinned to node-b has nowhere to go.
    await expect(
      relayLink({ agent: caller, target: { service: "runtime", node: "node-b" } }).call(["logs", "list"], {}, { context: {} }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await caller.closeAll();
  });
});
