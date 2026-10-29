import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { MeshRosterView } from "@deployer/mesh-agent-contracts";

import { meshFixture, replicaRecord } from "../testing/mesh.fixtures";

import { MeshDirectory } from "./directory.service";
import { NodeAgents } from "./node-agents.service";
import { PendingSeeds } from "./pending-seeds.service";
import { RosterGossip } from "./roster-gossip.service";

import type { ClientContext, ClientLink } from "@orpc/client";

type Link = ClientLink<ClientContext>;

/** A link that delivers an exchange to another agent, as the websocket would. */
const linkInto = (mesh: ReturnType<typeof meshFixture>): Link => ({
  call: (_path, input) => mesh.run(RosterGossip.live.exchange(input as MeshRosterView)),
});

const runtime = (replicaId: string, nodeId: string, overrides = {}) => replicaRecord({ service: "runtime", replicaId, nodeId, ...overrides });
const resolve = (mesh: ReturnType<typeof meshFixture>, service = "runtime") => mesh.settle(MeshDirectory.live.resolve({ service }));
const knownNodes = async (mesh: ReturnType<typeof meshFixture>) =>
  (await mesh.run(Effect.flatMap(NodeAgents, (agents) => agents.known()))).map((agent) => agent.nodeId);

describe("RosterGossip", () => {
  it("teaches both sides in one exchange: the replicas and the agents each one knows", async () => {
    const b = meshFixture({ nodeId: "B", advertise: "ws://b" });
    await b.seed(runtime("runtime-b", "B"));
    const a = meshFixture({ nodeId: "A", advertise: "ws://a", addresses: { "ws://b": linkInto(b) } });
    await a.seed(runtime("runtime-a", "A"));

    await a.run(RosterGossip.live.seed("ws://b"));

    expect(await resolve(a)).toMatchObject({ value: { replica: { replicaId: "runtime-a" } } });
    expect((await a.run(MeshDirectory.live.snapshot())).map((record) => record.replicaId).sort()).toEqual(["runtime-a", "runtime-b"]);
    expect((await b.run(MeshDirectory.live.snapshot())).map((record) => record.replicaId).sort()).toEqual(["runtime-a", "runtime-b"]);
    expect(await knownNodes(a)).toEqual(["B"]);
    expect(await knownNodes(b)).toEqual(["A"]);
  });

  it("reports whether a seed answered and whether it taught the agent anything", async () => {
    const b = meshFixture({ nodeId: "B", advertise: "ws://b" });
    const a = meshFixture({ nodeId: "A", addresses: { "ws://b": linkInto(b) } });

    expect(await a.run(RosterGossip.live.seed("ws://b"))).toEqual({ reached: true, learned: true });
    expect(await a.run(RosterGossip.live.seed("ws://b"))).toEqual({ reached: true, learned: false });
    expect(await a.run(RosterGossip.live.seed("ws://nobody"))).toEqual({ reached: false, learned: false });
  });

  it("finds the whole mesh through one seed", async () => {
    const c = meshFixture({ nodeId: "C", advertise: "ws://c" });
    await c.seed(runtime("runtime-c", "C"));
    const b = meshFixture({ nodeId: "B", advertise: "ws://b", addresses: { "ws://c": linkInto(c) } });
    await b.run(RosterGossip.live.seed("ws://c"));
    const a = meshFixture({ nodeId: "A", advertise: "ws://a", addresses: { "ws://b": linkInto(b), "ws://c": linkInto(c) } });

    await a.run(RosterGossip.live.seed("ws://b"));
    await a.run(RosterGossip.live.round());

    expect((await knownNodes(a)).sort()).toEqual(["B", "C"]);
    expect(await resolve(a)).toMatchObject({ value: { replica: { replicaId: "runtime-c", nodeId: "C" } } });
  });

  it("never lets a peer overwrite a replica of its own node", async () => {
    const b = meshFixture({ nodeId: "B", advertise: "ws://b" });
    await b.seed(runtime("runtime-a", "A", { generation: 9, keys: ["stale"] }));
    const a = meshFixture({ nodeId: "A", advertise: "ws://a", addresses: { "ws://b": linkInto(b) } });
    await a.seed(runtime("runtime-a", "A", { generation: 2, keys: ["fresh"] }));

    await a.run(RosterGossip.live.seed("ws://b"));

    const own = (await a.run(MeshDirectory.live.snapshot())).find((record) => record.replicaId === "runtime-a");
    expect(own).toMatchObject({ generation: 2, keys: ["fresh"] });
  });

  it("ignores expired replicas a peer still carries", async () => {
    const b = meshFixture({ nodeId: "B", advertise: "ws://b", now: 1_000 });
    await b.seed(runtime("runtime-b", "B", { expiresAt: 11_000 }));
    const a = meshFixture({ nodeId: "A", advertise: "ws://a", now: 20_000, addresses: { "ws://b": linkInto(b) } });

    await a.run(RosterGossip.live.seed("ws://b"));

    expect(await a.run(MeshDirectory.live.snapshot())).toEqual([]);
  });

  it("keeps going when one peer does not answer", async () => {
    const dead: Link = { call: vi.fn().mockRejectedValue(new Error("unreachable")) };
    const b = meshFixture({ nodeId: "B", advertise: "ws://b" });
    await b.seed(runtime("runtime-b", "B"));
    const a = meshFixture({ nodeId: "A", advertise: "ws://a", nodes: { Z: dead, B: linkInto(b) } });

    const changed = await a.run(RosterGossip.live.round());

    expect(changed).toBe(1);
    expect(await resolve(a)).toMatchObject({ value: { replica: { replicaId: "runtime-b" } } });
  });

  describe("alone first, then joined", () => {
    const replicaIds = async (mesh: ReturnType<typeof meshFixture>) =>
      (await mesh.run(MeshDirectory.live.snapshot())).map((record) => record.replicaId).sort();

    it("serves two replicas of one node from memory, with no swarm and no peer at all", async () => {
      const a = meshFixture({ nodeId: "A" });
      await a.seed(runtime("runtime-1", "A", { load: 0.9 }), runtime("runtime-2", "A", { load: 0.1, keys: ["stream-7"] }));

      expect(await a.settle(MeshDirectory.live.resolve({ service: "runtime" }))).toMatchObject({ value: { replica: { replicaId: "runtime-2" } } });
      expect(await a.settle(MeshDirectory.live.resolve({ service: "runtime", key: "stream-7" }))).toMatchObject({
        value: { reason: "key-holder", replica: { replicaId: "runtime-2" } },
      });
      expect(await a.settle(MeshDirectory.live.resolve({ service: "runtime", localOnly: true, exclude: ["runtime-2"] }))).toMatchObject({
        value: { replica: { replicaId: "runtime-1" } },
      });
      expect(await a.run(RosterGossip.live.round())).toBe(0);
    });

    it("joins a swarm later and merges what it already holds with what the swarm knows, losing nothing", async () => {
      const swarm = meshFixture({ nodeId: "B", advertise: "ws://b" });
      await swarm.seed(runtime("runtime-b", "B"));
      const a = meshFixture({ nodeId: "A", advertise: "ws://a", addresses: { "ws://b": linkInto(swarm) } });
      await a.seed(runtime("runtime-1", "A"), runtime("runtime-2", "A"));
      expect(await replicaIds(a)).toEqual(["runtime-1", "runtime-2"]);

      const joined = await a.run(RosterGossip.live.join("ws://b"));

      expect(joined).toMatchObject({ reached: true, learned: true, agents: [{ nodeId: "B", address: "ws://b" }] });
      expect(await replicaIds(a)).toEqual(["runtime-1", "runtime-2", "runtime-b"]);
      expect(await replicaIds(swarm)).toEqual(["runtime-1", "runtime-2", "runtime-b"]);
    });

    it("keeps a seed that was unreachable and retries it, so joining does not need the swarm to be up yet", async () => {
      const a = meshFixture({ nodeId: "A" });

      const joined = await a.run(RosterGossip.live.join("ws://swarm-not-up-yet"));

      expect(joined).toMatchObject({ reached: false, learned: false, agents: [] });
      expect(await a.run(Effect.flatMap(PendingSeeds, (seeds) => seeds.pending()))).toEqual(["ws://swarm-not-up-yet"]);
    });

    it("forgets a seed once it answered", async () => {
      const swarm = meshFixture({ nodeId: "B", advertise: "ws://b" });
      const a = meshFixture({ nodeId: "A", addresses: { "ws://b": linkInto(swarm) } });

      await a.run(RosterGossip.live.join("ws://b"));

      expect(await a.run(Effect.flatMap(PendingSeeds, (seeds) => seeds.pending()))).toEqual([]);
    });
  });
});
