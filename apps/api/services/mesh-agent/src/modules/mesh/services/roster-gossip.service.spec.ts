import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { MeshRosterView } from "@deployer/mesh-agent-contracts";

import { meshFixture, replicaRecord } from "../testing/mesh.fixtures";

import { MeshDirectory } from "./directory.service";
import { NodeAgents } from "./node-agents.service";
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

  it("reports whether a seed taught the agent anything", async () => {
    const b = meshFixture({ nodeId: "B", advertise: "ws://b" });
    const a = meshFixture({ nodeId: "A", addresses: { "ws://b": linkInto(b) } });

    expect(await a.run(RosterGossip.live.seed("ws://b"))).toBe(true);
    expect(await a.run(RosterGossip.live.seed("ws://b"))).toBe(false);
    expect(await a.run(RosterGossip.live.seed("ws://nobody"))).toBe(false);
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
});
