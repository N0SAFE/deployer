import { ORPCError, type ClientContext, type ClientLink } from "@orpc/client";
import { describe, expect, it, vi } from "vitest";

import { type MeshRelayEvent, type MeshRelayInput, grantDirect, readDirectGrant, redirectTo } from "@deployer/mesh-agent-contracts";

import { verifyLease } from "../rules/lease-token";
import { LEASE_SECRET, meshFixture, replicaRecord } from "../testing/mesh.fixtures";

import { MeshRelay, relayEvents } from "./relay.service";

type Link = ClientLink<ClientContext>;

const request = (overrides: Partial<MeshRelayInput> = {}): MeshRelayInput => ({
  service: "runtime",
  path: ["logs", "list"],
  input: { id: 1 },
  ...overrides,
});

const runtime = (replicaId: string, nodeId: string, overrides = {}) => replicaRecord({ service: "runtime", replicaId, nodeId, ...overrides });
const answering = (value: unknown): Link => ({ call: vi.fn().mockResolvedValue(value) });

async function* streamOf<T>(...values: T[]): AsyncGenerator<T> {
  for (const value of values) {
    await Promise.resolve();
    yield value;
  }
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const item of source) {
    all.push(item);
  }
  return all;
}

describe("MeshRelay", () => {
  describe("brokering", () => {
    it("calls the replica on its own node with the procedure's path and input, and returns its answer", async () => {
      const local = answering({ lines: 3 });
      const remote = answering("never");
      const mesh = meshFixture({ nodeId: "A", replicas: { "runtime-1": local, "runtime-2": remote } });
      await mesh.seed(runtime("runtime-1", "A"), runtime("runtime-2", "B"));

      const result = await mesh.settle(MeshRelay.live.relay(request()));

      expect(result).toEqual({ value: { kind: "value", value: { lines: 3 } } });
      expect(local.call).toHaveBeenCalledWith(["logs", "list"], { id: 1 }, { context: {} });
      expect(remote.call).not.toHaveBeenCalled();
    });

    it("answers a redirect itself and replays the call on the replica it names", async () => {
      const first = { call: vi.fn().mockRejectedValue(redirectTo("runtime-3", "holds stream-1")) };
      const owner = answering("served by runtime-3");
      const mesh = meshFixture({ nodeId: "A", replicas: { "runtime-1": first, "runtime-3": owner } });
      await mesh.seed(runtime("runtime-1", "A"), runtime("runtime-3", "C"));

      const result = await mesh.settle(MeshRelay.live.relay(request({ key: "stream-1" })));

      expect(result).toEqual({ value: { kind: "value", value: "served by runtime-3" } });
      expect(first.call).toHaveBeenCalledTimes(1);
      expect(owner.call).toHaveBeenCalledTimes(1);
    });

    it("keeps a stream a stream and counts it as open until it ends", async () => {
      const mesh = meshFixture({ replicas: { "runtime-1": answering(streamOf(1, 2)) } });
      await mesh.seed(runtime("runtime-1", "A"));

      const result = await mesh.run(MeshRelay.live.relay(request()));
      expect(result.kind).toBe("stream");

      const events = await collect(relayEvents(result));
      expect(events).toEqual([{ kind: "stream" }, { kind: "item", value: 1 }, { kind: "item", value: 2 }]);
    });

    it("passes the target's own error through with its code and data", async () => {
      const failing: Link = { call: vi.fn().mockRejectedValue(new ORPCError("NOT_FOUND", { message: "no such stream" })) };
      const mesh = meshFixture({ replicas: { "runtime-1": failing } });
      await mesh.seed(runtime("runtime-1", "A"));

      const result = await mesh.settle(MeshRelay.live.relay(request()));

      expect(result).toMatchObject({ error: { code: "NOT_FOUND", message: "no such stream" } });
    });

    it("answers a transport failure as BAD_GATEWAY", async () => {
      const mesh = meshFixture({});
      await mesh.seed(runtime("runtime-1", "A"));

      const result = await mesh.settle(MeshRelay.live.relay(request()));

      expect(result).toMatchObject({ error: { code: "BAD_GATEWAY" } });
    });

    it("fails with the service when no replica is known", async () => {
      const mesh = meshFixture();

      const result = await mesh.settle(MeshRelay.live.relay(request({ service: "ghost" })));

      expect(result).toMatchObject({ error: { _tag: "MeshNoReplica", service: "ghost" } });
    });
  });

  describe("node pinning", () => {
    it("forwards a call pinned to another node to that node's agent, and passes its events through", async () => {
      const remoteAgent = answering(streamOf<MeshRelayEvent>({ kind: "value", value: "from node B" }));
      const mesh = meshFixture({ nodeId: "A", nodes: { B: remoteAgent } });

      const outcome = await mesh.run(MeshRelay.live.relay(request({ node: "B" })));

      expect(remoteAgent.call).toHaveBeenCalledWith(["relay", "call"], expect.objectContaining({ node: "B", service: "runtime" }), { context: {} });
      expect(await collect(relayEvents(outcome))).toEqual([{ kind: "value", value: "from node B" }]);
    });

    it("fails when the agent has no link to the node", async () => {
      const mesh = meshFixture({ nodeId: "A" });

      const result = await mesh.settle(MeshRelay.live.relay(request({ node: "Z" })));

      expect(result).toMatchObject({ error: { _tag: "MeshNoNode", nodeId: "Z" } });
    });

    it("serves a call pinned to this node from this node only", async () => {
      const mesh = meshFixture({ nodeId: "A", replicas: { "runtime-2": answering("remote") } });
      await mesh.seed(runtime("runtime-2", "B"));

      const result = await mesh.settle(MeshRelay.live.relay(request({ node: "A" })));

      expect(result).toMatchObject({ error: { _tag: "MeshNoReplica" } });
    });
  });

  describe("direct leases", () => {
    const grantOf = (settled: { error?: unknown }) => readDirectGrant(settled.error);

    it.each([
      ["a heavy procedure", { heavy: true }, {}],
      ["a caller that asks for a direct link", { direct: true }, {}],
      ["an overloaded agent", {}, { eventLoopLagMs: 500 }],
    ])("answers %s with a grant instead of relaying", async (_name, flags, load) => {
      const replica = answering("never called");
      const mesh = meshFixture({ nodeId: "A", now: 1_000, load, replicas: { "runtime-1": replica } });
      await mesh.seed(runtime("runtime-1", "A", { address: "ws://10.0.0.1:3105" }));

      const settled = await mesh.settle(MeshRelay.live.relay(request({ key: "stream-1", ...flags })));
      const grant = grantOf(settled as { error?: unknown });

      expect(grant).toMatchObject({ replicaId: "runtime-1", address: "ws://10.0.0.1:3105", expiresAt: 31_000 });
      expect(replica.call).not.toHaveBeenCalled();
      expect(verifyLease(grant?.token ?? "", LEASE_SECRET, "runtime-1", 2_000)).toMatchObject({ ok: true });
    });

    it("grants the replica that holds the key, even when another one is local", async () => {
      const mesh = meshFixture({ nodeId: "A" });
      await mesh.seed(runtime("runtime-1", "A"), runtime("runtime-3", "C", { keys: ["stream-1"] }));

      const settled = await mesh.settle(MeshRelay.live.relay(request({ key: "stream-1", heavy: true })));

      expect(readDirectGrant((settled as { error?: unknown }).error)?.replicaId).toBe("runtime-3");
    });

    it("grants a pair that is calling too fast", async () => {
      const mesh = meshFixture({ replicas: { "runtime-1": answering("ok") } });
      await mesh.seed(runtime("runtime-1", "A"));

      for (let call = 0; call < 200; call += 1) {
        await mesh.settle(MeshRelay.live.relay(request()));
      }
      const settled = await mesh.settle(MeshRelay.live.relay(request()));

      expect(readDirectGrant((settled as { error?: unknown }).error)).toMatchObject({ replicaId: "runtime-1" });
    });

    it("fails with the service when the grant has no replica to name", async () => {
      const mesh = meshFixture();

      const settled = await mesh.settle(MeshRelay.live.relay(request({ heavy: true })));

      expect(settled).toMatchObject({ error: { _tag: "MeshNoReplica" } });
    });

    it("builds the same error a caller's grant follower reads", () => {
      expect(readDirectGrant(grantDirect({ replicaId: "r", address: "a", token: "t", expiresAt: 1 }))).toBeDefined();
    });
  });
});
