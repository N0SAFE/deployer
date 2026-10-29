import { afterAll, describe, expect, it, vi } from "vitest";

import { MESH_CREDENTIAL_HEADER } from "@deployer/shared/server";

import { openAgentStore } from "@/local/agent-store";

import { type BootedAgent, bootAgent, removeDataDir } from "./boot-agent";

/**
 * Nodes that are configured by nothing: no node id, no secret, no seed in any environment variable. Each agent makes up
 * its own identity and credential on first boot, a node is added with a token, and a restarted node comes back as the
 * same node, in the same swarm, by itself.
 */
describe("plug and play over real sockets", () => {
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

  /** What the operator holds on the node: its credential, read from the agent's own store. */
  async function credentialOf(agent: BootedAgent): Promise<string> {
    const store = await openAgentStore(agent.dataDir);
    const { secret } = await import("effect").then(({ Effect }) => Effect.runPromise(store.credential()));
    await import("effect").then(({ Effect }) => Effect.runPromise(store.close()));
    return secret;
  }

  const call = async (agent: BootedAgent, path: string, body: unknown, secret: string) => {
    const response = await fetch(`${agent.http}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", [MESH_CREDENTIAL_HEADER]: secret },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
  };

  const stopAndForget = async (agent: BootedAgent) => {
    await agent.stop();
    running.splice(running.indexOf(agent), 1);
  };

  it("starts empty, makes up an identity of its own, and keeps it across a restart", async () => {
    const first = await boot();
    const secretBefore = await credentialOf(first);
    const registered = await call(first, "/mesh/directory/register", { service: "runtime", replicaId: "runtime-1", address: "ws://x" }, secretBefore);
    const nodeId = (registered.body as { nodeId: string }).nodeId;
    await stopAndForget(first);

    const again = await boot(first.dataDir);
    const registeredAgain = await call(again, "/mesh/directory/register", { service: "runtime", replicaId: "runtime-1", address: "ws://x" }, secretBefore);

    expect(nodeId).toMatch(/^node-/);
    expect((registeredAgain.body as { nodeId: string }).nodeId).toBe(nodeId);
    expect(await credentialOf(again)).toBe(secretBefore);
  });

  it("refuses everything until it is given its credential, which only its own store holds", async () => {
    const agent = await boot();

    expect((await call(agent, "/mesh/directory/snapshot".replace("snapshot", "resolve"), { service: "x" }, "guess")).status).toBe(401);
    expect((await call(agent, "/mesh/directory/resolve", { service: "x" }, await credentialOf(agent))).status).toBe(404);
  });

  it("adds a node with a token, rejoins by itself after a restart, and never saw an environment secret", async () => {
    const a = await boot();
    const b = await boot();
    const secretA = await credentialOf(a);
    const secretB = await credentialOf(b);
    expect(secretA).not.toBe(secretB);

    await call(a, "/mesh/directory/register", { service: "runtime", replicaId: "runtime-a", address: "ws://ra", keys: ["stream-1"] }, secretA);
    const issued = await call(a, "/mesh/roster/token", {}, secretA);
    expect(issued.status).toBe(200);
    const joined = await call(b, "/mesh/roster/join", { token: issued.body.token }, secretB);
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ learned: true });

    // B now answers to the swarm's credential, which is A's, and learned A's replica by gossip.
    expect(await credentialOf(b)).toBe(secretA);
    await vi.waitFor(async () => {
      const learned = await call(b, "/mesh/directory/resolve", { service: "runtime", key: "stream-1" }, secretA);
      expect(learned.status).toBe(200);
      expect(learned.body).toMatchObject({ replica: { replicaId: "runtime-a" } });
    });

    // Restart B with nothing but its data directory: it is still in the swarm and finds it again alone.
    await stopAndForget(b);
    const restarted = await boot(b.dataDir);
    expect(await credentialOf(restarted)).toBe(secretA);
    await vi.waitFor(async () => {
      const found = await call(restarted, "/mesh/directory/resolve", { service: "runtime", key: "stream-1" }, secretA);
      expect(found.status).toBe(200);
    });
  });

  it("refuses a token that was not issued by a swarm agent, and leaves the node as it was", async () => {
    const agent = await boot();
    const secret = await credentialOf(agent);

    const rejected = await call(agent, "/mesh/roster/join", { token: "not-a-token" }, secret);

    expect(rejected.status).toBe(400);
    expect(await credentialOf(agent)).toBe(secret);
  });
});
