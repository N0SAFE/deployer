import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { MeshRosterView } from "@deployer/node-agent-contracts";

import { AgentStore } from "../../../local/agent-store";
import { OVERLAY_SELF_SECRET } from "../../../network/overlay";
import { NodeLabels } from "../../node/services/node-labels.service";
import { meshFixture, replicaRecord, LEASE_SECRET } from "../testing/mesh.fixtures";

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

const readSetting = (mesh: ReturnType<typeof meshFixture>, key: string) =>
	mesh.run(Effect.flatMap(AgentStore, (store) => store.setting(key)));

describe("RosterGossip", () => {
	it("replicates settings to a peer, newest stamp wins", async () => {
		const b = meshFixture({ nodeId: "B", advertise: "ws://b" });
		const a = meshFixture({ nodeId: "A", addresses: { "ws://b": linkInto(b) } });

		await a.run(Effect.flatMap(AgentStore, (store) => store.putSetting("node.doors", '{"v":1}', 1_000)));
		await a.run(RosterGossip.live.seed("ws://b"));
		expect(await readSetting(b, "node.doors")).toBe('{"v":1}');

		// An older stamp must not overwrite the newer local one.
		await b.run(Effect.flatMap(AgentStore, (store) => store.putSetting("node.doors", '{"v":2}', 2_000)));
		await a.run(RosterGossip.live.seed("ws://b"));
		expect(await readSetting(b, "node.doors")).toBe('{"v":2}');

		// A newer one does, in either direction.
		await a.run(Effect.flatMap(AgentStore, (store) => store.putSetting("node.doors", '{"v":3}', 3_000)));
		await a.run(RosterGossip.live.seed("ws://b"));
		expect(await readSetting(b, "node.doors")).toBe('{"v":3}');
	});

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

  it("skips a peer whose exchange outlives the call timeout, and warns once a minute rather than every round", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hung: Link = { call: vi.fn(() => new Promise<never>(() => undefined)) };
    const a = meshFixture({ nodeId: "A", nodes: { Q: hung }, gossip: { callTimeoutMs: 10 } });

    expect(await a.run(RosterGossip.live.round())).toBe(0);
    expect(await a.run(RosterGossip.live.round())).toBe(0);

    expect(warn.mock.calls.filter(([message]) => String(message).includes("gossip with Q"))).toHaveLength(1);
    warn.mockRestore();
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

  describe("overlays", () => {
    const overlay = { wireguardKey: "k", meshAddress: "10.88.1.2", endpoint: "a:51820", listenPort: 51_820 };
    /** An empty exchange sent to `mesh`, as a peer that knows nobody would: what it answers is its whole view. */
    const view = (mesh: ReturnType<typeof meshFixture>, nodeId: string) =>
      mesh.run(
        RosterGossip.live.exchange({
          from: { nodeId, address: `ws://${nodeId.toLowerCase()}`, overlay: null, labels: {} },
          replicas: [],
          agents: [],
          settings: [],
          credentialEpoch: 0,
        }),
      );
    const knownWithOverlay = async (mesh: ReturnType<typeof meshFixture>) =>
      (await mesh.run(Effect.flatMap(NodeAgents, (agents) => agents.known()))).map(({ nodeId, address, overlay: own, labels }) => ({
        nodeId,
        address,
        overlay: own,
        labels,
      }));

    it("advertises the overlay it stored, in its own entry and in the agents it lists", async () => {
      const b = meshFixture({ nodeId: "B", advertise: "ws://B" });
      const a = meshFixture({ nodeId: "A", advertise: "ws://a", nodes: { B: linkInto(b) } });
      await Effect.runPromise(a.store.putSecret(OVERLAY_SELF_SECRET, JSON.stringify(overlay)));

      const advertised = await view(a, "A");

      expect(advertised.from).toEqual({ nodeId: "A", address: "ws://a", overlay, labels: {} });
      expect(advertised.agents).toContainEqual({ nodeId: "A", address: "ws://a", overlay, labels: {} });
      expect(advertised.agents).toContainEqual({ nodeId: "B", address: "ws://B", overlay: null, labels: {} });
    });

    it("teaches a peer the agent with its overlay, and reads the peer's overlay back", async () => {
      const b = meshFixture({ nodeId: "B", advertise: "ws://b" });
      const a = meshFixture({
        nodeId: "A",
        advertise: "ws://a",
        nodes: { B: linkInto(b) },
        overlays: { B: overlay },
      });
      await Effect.runPromise(a.store.putSecret(OVERLAY_SELF_SECRET, JSON.stringify(overlay)));

      // The fixture's `overlays` is what this agent already knows of its peer; the store is what it advertises of itself.
      expect((await view(a, "A")).agents).toContainEqual({ nodeId: "B", address: "ws://B", overlay, labels: {} });

      await a.run(RosterGossip.live.round());

      expect(await knownWithOverlay(b)).toEqual([{ nodeId: "A", address: "ws://a", overlay, labels: {} }]);
    });

    it("advertises no overlay when the stored one is malformed, and gossips anyway", async () => {
      const a = meshFixture({ nodeId: "A", advertise: "ws://a" });
      const b = meshFixture({ nodeId: "B", advertise: "ws://b", addresses: { "ws://a": linkInto(a) } });
      await Effect.runPromise(a.store.putSecret(OVERLAY_SELF_SECRET, "{not-json"));

      expect((await view(a, "A")).from.overlay).toBeNull();
      expect(await b.run(RosterGossip.live.seed("ws://a"))).toEqual({ reached: true, learned: true });
      expect(await knownWithOverlay(b)).toEqual([{ nodeId: "A", address: "ws://a", overlay: null, labels: {} }]);
    });

    it("gossips with peers that have no overlay at all", async () => {
      const b = meshFixture({ nodeId: "B", advertise: "ws://b" });
      await b.seed(runtime("runtime-b", "B"));
      const a = meshFixture({ nodeId: "A", advertise: "ws://a", addresses: { "ws://b": linkInto(b) } });

      expect(await a.run(RosterGossip.live.seed("ws://b"))).toEqual({ reached: true, learned: true });
      expect(await knownWithOverlay(a)).toEqual([{ nodeId: "B", address: "ws://b", overlay: null, labels: {} }]);
      expect(await knownWithOverlay(b)).toEqual([{ nodeId: "A", address: "ws://a", overlay: null, labels: {} }]);
      expect(await resolve(a)).toMatchObject({ value: { replica: { replicaId: "runtime-b" } } });
    });
  });

  describe("labels", () => {
    const probe = (mesh: ReturnType<typeof meshFixture>, nodeId: string) =>
      mesh.run(
        RosterGossip.live.exchange({
          from: { nodeId, address: `ws://${nodeId.toLowerCase()}`, overlay: null, labels: {} },
          replicas: [],
          agents: [],
          settings: [],
          credentialEpoch: 0,
        }),
      );

    it("publishes the node's own labels in its view, and teaches them to a peer", async () => {
      const b = meshFixture({ nodeId: "B", advertise: "ws://b" });
      await b.run(Effect.flatMap(NodeLabels, (labels) => labels.merge({ "deployer.node-id": "node-platform" })));
      const a = meshFixture({ nodeId: "A", advertise: "ws://a", addresses: { "ws://b": linkInto(b) } });

      // A probe that names the agent itself is not learned as a new node: only `from` is under assertion here.
      expect((await probe(b, "B")).from.labels).toEqual({ "deployer.node-id": "node-platform" });

      await a.run(RosterGossip.live.seed("ws://b"));

      expect(await knownNodes(a)).toEqual(["B"]);
      expect(await a.run(Effect.flatMap(NodeAgents, (agents) => agents.known()))).toMatchObject([
        { nodeId: "B", labels: { "deployer.node-id": "node-platform" } },
      ]);
    });
  });

  describe("blocked nodes", () => {
    const selfView = (mesh: ReturnType<typeof meshFixture>, nodeId: string) =>
      mesh.run(
        RosterGossip.live.exchange({
          from: { nodeId, address: `ws://${nodeId.toLowerCase()}`, overlay: null, labels: {} },
          replicas: [],
          agents: [],
          settings: [],
          credentialEpoch: 0,
        }),
      );

    it("absorbs nothing from a blocked node, omits it from the view, and takes it back on unblock", async () => {
      const b = meshFixture({ nodeId: "B", advertise: "ws://b" });
      await b.seed(runtime("runtime-b", "B"));
      const a = meshFixture({ nodeId: "A", advertise: "ws://a", addresses: { "ws://b": linkInto(b) } });

      // Revocation is per node, not per join token: B keeps gossiping with a valid credential, and nothing of it lands.
      await Effect.runPromise(a.store.blockNode("B"));
      expect(await a.run(RosterGossip.live.seed("ws://b"))).toEqual({ reached: true, learned: false });
      expect(await knownNodes(a)).toEqual([]);
      expect(await a.run(MeshDirectory.live.snapshot())).toEqual([]);
      expect((await selfView(a, "A")).agents.map((agent) => agent.nodeId)).toEqual(["A"]);

      await Effect.runPromise(a.store.unblockNode("B"));
      await a.run(Effect.flatMap(NodeAgents, (agents) => agents.forget("B")));
      expect(await a.run(RosterGossip.live.seed("ws://b"))).toEqual({ reached: true, learned: true });
      expect(await knownNodes(a)).toEqual(["B"]);
      expect(await resolve(a)).toMatchObject({ value: { replica: { replicaId: "runtime-b" } } });
    });

    it("does not let a blocked node teach this agent the nodes it knows", async () => {
      const c = meshFixture({ nodeId: "C", advertise: "ws://c" });
      const b = meshFixture({ nodeId: "B", advertise: "ws://b", addresses: { "ws://c": linkInto(c) } });
      await b.run(RosterGossip.live.seed("ws://c"));
      const a = meshFixture({ nodeId: "A", advertise: "ws://a", addresses: { "ws://b": linkInto(b) } });
      await Effect.runPromise(a.store.blockNode("B"));

      await a.run(RosterGossip.live.seed("ws://b"));

      expect(await knownNodes(a)).toEqual([]);
    });
  });

  describe("gossip fan-out", () => {
    /** One recording fake transport per node: each round's calls land in `calls`, in the order they were made. */
    const recordingNodes = (nodeIds: readonly string[]) => {
      const calls: string[] = [];
      const nodes: Record<string, Link> = {};
      for (const nodeId of nodeIds) {
        nodes[nodeId] = {
          call: () => {
            calls.push(nodeId);
            return Promise.reject(new Error(`${nodeId} is offline`));
          },
        };
      }
      return { calls, nodes };
    };

    it("exchanges with only `fanout` peers per round, rotating the window", async () => {
      const { calls, nodes } = recordingNodes(["B", "C", "D", "E", "F"]);
      const a = meshFixture({ nodeId: "A", nodes, gossip: { fanout: 2 } });

      await a.run(RosterGossip.live.round());
      expect(calls).toEqual(["B", "C"]);

      calls.length = 0;
      await a.run(RosterGossip.live.round());
      expect(calls).toEqual(["D", "E"]);

      calls.length = 0;
      await a.run(RosterGossip.live.round());
      expect(calls).toEqual(["F", "B"]);

      // Three more rounds start at C, E and B: every peer has been reached.
      calls.length = 0;
      for (let round = 0; round < 3; round += 1) {
        await a.run(RosterGossip.live.round());
      }
      expect(new Set(calls)).toEqual(new Set(["B", "C", "D", "E", "F"]));
    });

    it("keeps reaching every peer when the fan-out is zero, the old behaviour", async () => {
      const { calls, nodes } = recordingNodes(["B", "C", "D"]);
      const a = meshFixture({ nodeId: "A", nodes, gossip: { fanout: 0 } });

      await a.run(RosterGossip.live.round());

      expect(calls).toEqual(["B", "C", "D"]);
    });

    it("converges on a replica held by a non-neighbour in three rounds of one peer each", async () => {
      const c = meshFixture({ nodeId: "C", advertise: "ws://c" });
      const b = meshFixture({ nodeId: "B", advertise: "ws://b", addresses: { "ws://c": linkInto(c) } });
      await b.run(RosterGossip.live.seed("ws://c"));
      // Registered only now, so B's own copy cannot be what teaches A: A has to reach C itself.
      await c.seed(runtime("runtime-c", "C"));
      const a = meshFixture({
        nodeId: "A",
        advertise: "ws://a",
        addresses: { "ws://b": linkInto(b), "ws://c": linkInto(c) },
        gossip: { fanout: 1 },
      });

      await a.run(RosterGossip.live.seed("ws://b"));
      expect((await a.run(MeshDirectory.live.snapshot())).map((record) => record.replicaId)).toEqual([]);

      let rounds = 0;
      while ((await a.run(MeshDirectory.live.snapshot())).length === 0 && rounds < 3) {
        await a.run(RosterGossip.live.round());
        rounds += 1;
      }

      expect(rounds).toBeGreaterThan(0);
      expect(rounds).toBeLessThanOrEqual(3);
      expect(await resolve(a)).toMatchObject({ value: { replica: { replicaId: "runtime-c", nodeId: "C" } } });
      expect((await knownNodes(a)).sort()).toEqual(["B", "C"]);
    });
  });

  describe("alone first, then joined", () => {    const replicaIds = async (mesh: ReturnType<typeof meshFixture>) =>
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

  describe("credential rotation convergence", () => {
    const viewOf = (from: string, epoch: number): MeshRosterView => ({
      from: { nodeId: from, address: `ws://${from.toLowerCase()}`, overlay: null, labels: {} },
      replicas: [],
      agents: [],
      settings: [],
      credentialEpoch: epoch,
    });

    /** A peer that answers gossip with its view, its credential on `roster.credential`, and records the paths. */
    const peerWith = (from: string, epoch: number, rotation: { secret: string; validUntil: number; epoch: number }) => {
      const calls: string[] = [];
      const link: Link = {
        call: (path) => {
          calls.push(path.join("."));
          return Promise.resolve(path.join(".") === "roster.credential" ? rotation : viewOf(from, epoch));
        },
      };
      return { link, calls };
    };

    it("fetches and adopts the credential of a peer whose epoch is ahead", async () => {
      const validUntil = Date.now() + 60_000;
      const peer = peerWith("B", 5_000, { secret: "rotated-secret", validUntil, epoch: 5_000 });
      const a = meshFixture({ nodeId: "A", advertise: "ws://a", addresses: { "ws://b": peer.link } });

      await a.run(RosterGossip.live.exchange(viewOf("B", 5_000)));

      expect(peer.calls).toContain("roster.credential");
      expect(a.credential.current()).toBe("rotated-secret");
      expect(a.credential.previous()).toBe(LEASE_SECRET);
      expect(a.credential.epoch()).toBe(5_000);
      expect(a.credential.verify("rotated-secret")).toBe(true);
      expect(await a.run(Effect.flatMap(AgentStore, (store) => store.credential()))).toMatchObject({ secret: "rotated-secret" });
    });

    it("does nothing when the peer's epoch is equal or behind", async () => {
      const peer = peerWith("B", 0, { secret: "rotated-secret", validUntil: 1, epoch: 1 });
      const a = meshFixture({ nodeId: "A", advertise: "ws://a", addresses: { "ws://b": peer.link } });
      // The fixture's clock is 1 000, so this puts A's epoch there: one equal view and one behind must both no-op.
      await a.run(a.credential.rotateTo("local-secret", Date.now() + 60_000, Date.now()));

      await a.run(RosterGossip.live.exchange(viewOf("B", 1_000)));
      await a.run(RosterGossip.live.exchange(viewOf("B", 999)));

      expect(peer.calls).toEqual([]);
      expect(a.credential.current()).toBe("local-secret");
    });

    it("keeps gossiping when the credential fetch fails", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const link: Link = {
        call: (path) =>
          path.join(".") === "roster.credential"
            ? Promise.reject(new Error("unreachable"))
            : Promise.resolve(viewOf("B", 5_000)),
      };
      const a = meshFixture({ nodeId: "A", advertise: "ws://a", addresses: { "ws://b": link } });

      const answered = await a.run(RosterGossip.live.exchange(viewOf("B", 5_000)));

      expect(answered.from.nodeId).toBe("A");
      expect(a.credential.current()).toBe(LEASE_SECRET);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("credential"));
      warn.mockRestore();
    });
  });
});
