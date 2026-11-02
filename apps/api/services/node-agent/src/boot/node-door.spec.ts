import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";

import { agentLink, createMeshClient, openWebSocketConnection, pooledLink } from "@deployer/mesh-client";
import { type nodeAgentContract, meshNodeContract } from "@deployer/node-agent-contracts";

import { openAgentStore } from "@/local/agent-store";

import { type BootedAgent, bootAgent, removeDataDir } from "./boot-agent";

import type { ClientContext } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";

type NodeAgentClient = ContractRouterClient<typeof nodeAgentContract>;

/** The platform node id, which only the setup flow (or a CLI) chooses — never the agent, never the environment. */
const PLATFORM_NODE_ID = "0192f5c1-8f3b-4f2e-9a4d-2b7c1d3e5f60";

/**
 * The node door, over real sockets: a node is created by writing its database, and only its own services can write it.
 */
describe("node creation through the agent's local database", () => {
  const running: BootedAgent[] = [];
  const dirs: string[] = [];

  afterAll(async () => {
    await Promise.all(running.map((agent) => agent.stop().catch(() => undefined)));
    dirs.forEach(removeDataDir);
  });

  async function boot(dataDir?: string): Promise<BootedAgent> {
    const agent = await bootAgent({ dataDir });
    running.push(agent);
    dirs.push(agent.dataDir);
    return agent;
  }

  const local = (agent: BootedAgent) =>
    createMeshClient<NodeAgentClient>(agentLink(agent.transport.localSocketPath));

  /** The operator door: configuring the node and issuing join tokens live here, not on the service socket. */
  const admin = (agent: BootedAgent) =>
    createMeshClient<NodeAgentClient>(agentLink(agent.transport.adminSocketPath));

  const stopAndForget = async (agent: BootedAgent) => {
    await agent.stop();
    running.splice(running.indexOf(agent), 1);
  };

  async function credentialOf(agent: BootedAgent): Promise<string> {
    const store = await openAgentStore(agent.dataDir);
    const { secret } = await Effect.runPromise(store.credential());
    await Effect.runPromise(store.close());
    return secret;
  }

  it("starts unconfigured and becomes a configured node when its own service writes the config", async () => {
    const agent = await boot();
    const client = local(agent);

    const fresh = await Effect.runPromise(client.node.state({}));
    expect(fresh).toEqual({ agentId: expect.stringMatching(/^node-/), configured: false, config: null });

    const configured = await Effect.runPromise(
      admin(agent).node.configure({
        nodeId: PLATFORM_NODE_ID,
        strategy: "remote",
        setupState: "setup_done",
        databaseUrl: "postgres://db",
      }),
    );
    expect(configured).toMatchObject({
      agentId: fresh.agentId,
      configured: true,
      config: { nodeId: PLATFORM_NODE_ID, strategy: "remote", setupState: "setup_done", databaseUrl: "postgres://db" },
    });
  });

  it("keeps the node's identity and configuration across a restart", async () => {
    const first = await boot();
    const client = local(first);
    const { agentId } = await Effect.runPromise(client.node.state({}));
    await Effect.runPromise(admin(first).node.configure({ nodeId: PLATFORM_NODE_ID, setupState: "setup_done" }));
    await stopAndForget(first);

    const again = await boot(first.dataDir);
    const restarted = await Effect.runPromise(local(again).node.state({}));

    expect(restarted).toMatchObject({ agentId, configured: true, config: { nodeId: PLATFORM_NODE_ID, setupState: "setup_done" } });
  });

  it("lets a dev pin name a new node, but never renames an existing one", async () => {
    const pinned = await bootAgent({ pin: { nodeId: "node-dev-pin" } });
    running.push(pinned);
    dirs.push(pinned.dataDir);
    await stopAndForget(pinned);

    // Same data directory, no pin: the node in the database wins, it is not created again.
    const unpinned = await boot(pinned.dataDir);
    const state = await Effect.runPromise(local(unpinned).node.state({}));

    expect(state.agentId).toBe("node-dev-pin");
  });

  it("is not reachable on the mesh door, even with the swarm's credential", async () => {
    const agent = await boot();
    const secret = await credentialOf(agent);
    const peer = pooledLink<ClientContext>({
      target: agent.ws,
      maxConnections: 1,
      multiplex: 4,
      idleMs: 1_000,
      open: () =>
        Promise.resolve(openWebSocketConnection({ url: `${agent.ws}?credential=${secret}`, reconnectDelayMs: 20 })),
    });

    // The mesh door does not route the node router at all, so the call has no procedure to match — with or without the
    // swarm's credential.
    await expect(Effect.runPromise(createMeshClient<NodeAgentClient>(peer).node.state({}))).rejects.toThrow(
      /No procedure matched/,
    );
    await peer.closeAll();
  });

  it("answers status and settings on the node door, and nowhere else", async () => {
    const agent = await boot();
    const client = local(agent);

    const status = await Effect.runPromise(client.node.status({}));
    expect(status).toEqual({
      agentId: expect.stringMatching(/^node-/),
      swarmId: null,
      // The address this agent advertises: the host in it is what its replicas resolve.
      advertiseAddress: agent.ws,
      load: { eventLoopLagMs: expect.any(Number), bytesPerSecond: expect.any(Number), openStreams: 0 },
      // A node that has relayed nothing yet: multi-hop is reported, and idle.
      relay: { forwarded: 0, noRoute: 0, unreachable: 0 },
      // A fresh node has no overlay yet; the interface is absent, not broken.
      interfaceUp: false,
      meshAddress: null,
      listenPort: 51_820,
      peers: [],
    });
    expect(await Effect.runPromise(client.node.settings({}))).toEqual({ settings: [] });

    const secret = await credentialOf(agent);
    const peer = pooledLink<ClientContext>({
      target: agent.ws,
      maxConnections: 1,
      multiplex: 4,
      idleMs: 1_000,
      open: () =>
        Promise.resolve(openWebSocketConnection({ url: `${agent.ws}?credential=${secret}`, reconnectDelayMs: 20 })),
    });
    const mesh = createMeshClient<NodeAgentClient>(peer);

    // Same door rule as `node.state`: the mesh door does not route the node router at all.
    await expect(Effect.runPromise(mesh.node.status({}))).rejects.toThrow(/No procedure matched/);
    await expect(Effect.runPromise(mesh.node.settings({}))).rejects.toThrow(/No procedure matched/);
    await peer.closeAll();
  });

  it("publishes this node's labels on the node door, merges them, and carries them in the roster", async () => {
    const agent = await boot();
    const client = local(agent);

    expect(await Effect.runPromise(client.node.labels({ labels: { "deployer.node-id": PLATFORM_NODE_ID } }))).toEqual({
      "deployer.node-id": PLATFORM_NODE_ID,
    });
    expect(await Effect.runPromise(client.node.labels({ labels: { environment: "prod" } }))).toEqual({
      "deployer.node-id": PLATFORM_NODE_ID,
      environment: "prod",
    });

    const view = await Effect.runPromise(client.roster.view({}));
    expect(view.self.labels).toEqual({ "deployer.node-id": PLATFORM_NODE_ID, environment: "prod" });
  });

  it("refuses to write labels on the mesh door, even with the swarm's credential", async () => {
    const agent = await boot();
    const secret = await credentialOf(agent);
    const peer = pooledLink<ClientContext>({
      target: agent.ws,
      maxConnections: 1,
      multiplex: 4,
      idleMs: 1_000,
      open: () =>
        Promise.resolve(openWebSocketConnection({ url: `${agent.ws}?credential=${secret}`, reconnectDelayMs: 20 })),
    });
    const mesh = createMeshClient<NodeAgentClient>(peer);

    // Labels are what a node says about itself: only its own services, on its own socket, may write them.
    await expect(Effect.runPromise(mesh.node.labels({ labels: { "deployer.node-id": PLATFORM_NODE_ID } }))).rejects.toThrow(
      /No procedure matched/,
    );
    await peer.closeAll();
  });

  it("still serves the mesh router on the mesh door", async () => {
    const agent = await boot();
    const secret = await credentialOf(agent);
    const peer = pooledLink<ClientContext>({
      target: agent.ws,
      maxConnections: 1,
      multiplex: 4,
      idleMs: 1_000,
      open: () =>
        Promise.resolve(openWebSocketConnection({ url: `${agent.ws}?credential=${secret}`, reconnectDelayMs: 20 })),
    });

    const view = await Effect.runPromise(createMeshClient<NodeAgentClient>(peer).roster.view({}));
    expect(view.self.nodeId).toMatch(/^node-/);
    await peer.closeAll();
  });

  it("rotates the swarm credential on the mesh door, and a peer on the old secret still gets in", async () => {
    const agent = await boot();
    const before = await credentialOf(agent);
    const open = (credential: string) =>
      pooledLink<ClientContext>({
        target: agent.ws,
        maxConnections: 1,
        multiplex: 4,
        idleMs: 1_000,
        open: () => Promise.resolve(openWebSocketConnection({ url: `${agent.ws}?credential=${credential}`, reconnectDelayMs: 20 })),
      });

    // A token minted now: it carries the secret in force, and must survive the rotation below.
    const { token } = await Effect.runPromise(admin(agent).roster.token({ ttlMs: 60_000 }));

    const peer = open(before);
    const mesh = createMeshClient<NodeAgentClient>(peer);
    expect(await Effect.runPromise(mesh.roster.credential({}))).toEqual({
      secret: before,
      validUntil: 0,
      epoch: expect.any(Number),
    });

    const rotated = await Effect.runPromise(mesh.roster.rotate({}));
    expect(rotated).toMatchObject({ rotated: true });
    expect(rotated.validUntil).toBeGreaterThan(Date.now());
    await peer.closeAll();

    const after = await credentialOf(agent);
    expect(after).not.toBe(before);

    // The grace window: a peer that has not learned the new secret still opens its connection with the old one.
    const stale = open(before);
    expect((await Effect.runPromise(createMeshClient<NodeAgentClient>(stale).roster.credential({}))).secret).toBe(after);
    await stale.closeAll();
    expect(await Effect.runPromise(local(agent).roster.check({ token }))).toEqual({ valid: true });

    // Both are roster procedures, so the node router never serves them: the node door and the mesh door stay distinct.
    expect(Object.keys(meshNodeContract)).not.toContain("rotate");
    expect(Object.keys(meshNodeContract)).not.toContain("credential");
  });

  it("keeps the node procedures off the HTTP surface entirely", async () => {
    const agent = await boot();
    const secret = await credentialOf(agent);

    // No controller mounts the node door: the provider's methods only become a router on the socket.
    const withCredential = await fetch(`${agent.http}/node/state`, {
      method: "GET",
      headers: { "x-mesh-credential": secret },
    });
    const anonymous = await fetch(`${agent.http}/node/state`, { method: "GET" });

    expect(withCredential.status).toBe(404);
    expect(anonymous.status).toBe(404);
  });

  it("never writes a config by itself: the database has no node config row on first boot", async () => {
    const agent = await boot();
    const store = await openAgentStore(agent.dataDir);

    expect(await Effect.runPromise(store.nodeConfig())).toBeNull();
    await Effect.runPromise(store.close());
  });
});
