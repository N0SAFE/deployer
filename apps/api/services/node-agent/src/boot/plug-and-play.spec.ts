import { Effect } from "effect";
import { afterAll, describe, expect, it, vi } from "vitest";

import { agentLink, createMeshClient } from "@deployer/mesh-client";
import { type nodeAgentContract } from "@deployer/node-agent-contracts";

import { openAgentStore } from "@/local/agent-store";

import { adminClient, type BootedAgent, bootAgent, peerClient, removeDataDir } from "./boot-agent";

import type { ContractRouterClient } from "@orpc/contract";

type NodeAgentClient = ContractRouterClient<typeof nodeAgentContract>;

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

  /** The door this node's own services use: joining a swarm is only possible here, never over the network. */
  const local = (agent: BootedAgent) =>
    createMeshClient<NodeAgentClient>(agentLink(agent.transport.localSocketPath));

  const stopAndForget = async (agent: BootedAgent) => {
    await agent.stop();
    running.splice(running.indexOf(agent), 1);
  };

  it("starts empty, makes up an identity of its own, and keeps it across a restart", async () => {
    const first = await boot();
    const secretBefore = await credentialOf(first);
    const registered = await Effect.runPromise(
      peerClient(first, secretBefore).directory.register({ service: "runtime", replicaId: "runtime-1", address: "ws://x" }),
    );
    const nodeId = registered.nodeId;
    await stopAndForget(first);

    const again = await boot(first.dataDir);
    const registeredAgain = await Effect.runPromise(
      peerClient(again, secretBefore).directory.register({ service: "runtime", replicaId: "runtime-1", address: "ws://x" }),
    );

    expect(nodeId).toMatch(/^node-/);
    expect(registeredAgain.nodeId).toBe(nodeId);
    expect(await credentialOf(again)).toBe(secretBefore);
  });

  it("refuses everything until it is given its credential, which only its own store holds", async () => {
    const agent = await boot();

    await expect(Effect.runPromise(peerClient(agent, "guess").directory.resolve({ service: "x" }))).rejects.toBeDefined();
    await expect(
      Effect.runPromise(peerClient(agent, await credentialOf(agent)).directory.resolve({ service: "x" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("adds a node with a token, rejoins by itself after a restart, and never saw an environment secret", async () => {
    const a = await boot();
    const b = await boot();
    const secretA = await credentialOf(a);
    const secretB = await credentialOf(b);
    expect(secretA).not.toBe(secretB);

    const aAsPeer = peerClient(a, secretA);
    await Effect.runPromise(aAsPeer.directory.register({ service: "runtime", replicaId: "runtime-a", address: "ws://ra", keys: ["stream-1"] }));
    const { token } = await Effect.runPromise(aAsPeer.roster.token({}));
    // Joining is the node's own act: B redeems the token on its own socket, never over the network.
    const joined = await Effect.runPromise(adminClient(b).roster.join({ token }));
    expect(joined).toMatchObject({ learned: true });

    // B now answers to the swarm's credential, which is A's, and learned A's replica by gossip.
    expect(await credentialOf(b)).toBe(secretA);
    await vi.waitFor(async () => {
      const learned = await Effect.runPromise(peerClient(b, secretA).directory.resolve({ service: "runtime", key: "stream-1" }));
      expect(learned).toMatchObject({ replica: { replicaId: "runtime-a" } });
    });

    // Restart B with nothing but its data directory: it is still in the swarm and finds it again alone.
    await stopAndForget(b);
    const restarted = await boot(b.dataDir);
    expect(await credentialOf(restarted)).toBe(secretA);
    await vi.waitFor(async () => {
      const found = await Effect.runPromise(peerClient(restarted, secretA).directory.resolve({ service: "runtime", key: "stream-1" }));
      expect(found).toMatchObject({ replica: { replicaId: "runtime-a" } });
    });
  });

  it("refuses a token that was not issued by a swarm agent, and leaves the node as it was", async () => {
    const agent = await boot();
    const secret = await credentialOf(agent);

    await expect(Effect.runPromise(adminClient(agent).roster.join({ token: "not-a-token" }))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await credentialOf(agent)).toBe(secret);
  });
});
