import "@orpc/effect/extensions/effect";

import { type ClientContext, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { describe, expect, it, vi } from "vitest";

import { redirectTo } from "@deployer/node-agent-contracts";
import { grantFollowingLink, relayLink } from "@deployer/mesh-client";
import { effectContext } from "@deployer/nest-effect/testing";


import { meshFixture, replicaRecord } from "../testing/mesh.fixtures";

import { RelayController } from "./relay.controller";

/**
 * The relay over real oRPC RPC peers (in-memory ports instead of sockets): the caller's `relayLink` talks to the
 * procedures class exactly as a service talks to its local agent, so what the contract's event sequence does on the wire is
 * what is asserted here, not what the types promise.
 */
const runtime = (replicaId: string, nodeId: string, overrides = {}) => replicaRecord({ service: "runtime", replicaId, nodeId, ...overrides });

async function* streamOf<T>(...values: T[]): AsyncGenerator<T> {
  for (const value of values) {
    await Promise.resolve();
    yield value;
  }
}

function agentFor(mesh: ReturnType<typeof meshFixture>) {
  const { port1, port2 } = new MessageChannel();
  const procedures = new RelayController();
  new RPCHandler({ relay: { call: procedures.call() } }, { interceptors: [onError((error) => { console.error("SERVER", error); })] }).upgrade(port1, {
    // The host fills `request` and `auth`; the relay reads neither, so the test supplies only what it uses.
    context: effectContext(mesh.context) as never,
  });
  port1.start();
  port2.start();
  return new RPCLink<ClientContext>({ port: port2 });
}

const target = { service: "runtime" };

describe("RelayController over the wire", () => {
  it("answers a unary call with the replica's value", async () => {
    const replica = { call: vi.fn().mockResolvedValue({ lines: 3 }) };
    const mesh = meshFixture({ replicas: { "runtime-1": replica } });
    await mesh.seed(runtime("runtime-1", "A"));

    const link = relayLink({ agent: agentFor(mesh), target });

    await expect(link.call(["logs", "list"], { id: 1 }, { context: {} })).resolves.toEqual({ lines: 3 });
    expect(replica.call).toHaveBeenCalledWith(["logs", "list"], { id: 1 }, { context: { headers: {} } });
  });

  it("streams a replica's stream element by element", async () => {
    const mesh = meshFixture({ replicas: { "runtime-1": { call: () => Promise.resolve(streamOf("a", "b", "c")) } } });
    await mesh.seed(runtime("runtime-1", "A"));

    const stream = (await relayLink({ agent: agentFor(mesh), target }).call(["logs", "stream"], {}, { context: {} })) as AsyncIterable<string>;
    const received: string[] = [];
    for await (const item of stream) {
      received.push(item);
    }

    expect(received).toEqual(["a", "b", "c"]);
  });

  it("answers a redirect itself, so the caller only sees the final value", async () => {
    const first = { call: vi.fn().mockRejectedValue(redirectTo("runtime-3", "holds stream-1")) };
    const owner = { call: vi.fn().mockResolvedValue("served by runtime-3") };
    const mesh = meshFixture({ replicas: { "runtime-1": first, "runtime-3": owner } });
    await mesh.seed(runtime("runtime-1", "A"), runtime("runtime-3", "C"));

    const link = relayLink({ agent: agentFor(mesh), target: { ...target, key: "stream-1" } });

    await expect(link.call(["logs", "list"], {}, { context: {} })).resolves.toBe("served by runtime-3");
  });

  it("carries the target's own error to the caller with its code", async () => {
    const mesh = meshFixture({ replicas: { "runtime-1": { call: () => Promise.reject(new ORPCError("NOT_FOUND", { message: "no such stream" })) } } });
    await mesh.seed(runtime("runtime-1", "A"));

    const link = relayLink({ agent: agentFor(mesh), target });

    await expect(link.call(["logs", "list"], {}, { context: {} })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hands a heavy call a grant that the caller's follower replays on the replica", async () => {
    const replica = { call: vi.fn().mockResolvedValue("from replica, directly") };
    const mesh = meshFixture({ now: 1_000 });
    await mesh.seed(runtime("runtime-2", "B", { address: "ws://10.0.0.2:3105" }));
    const direct = vi.fn(() => replica);

    const link = grantFollowingLink({
      agent: relayLink({ agent: agentFor(mesh), target: { ...target, key: "stream-1", heavy: true } }),
      direct,
      now: () => 1_000,
    });

    await expect(link.call(["logs", "stream"], {}, { context: {} })).resolves.toBe("from replica, directly");
    expect(direct).toHaveBeenCalledWith(expect.objectContaining({ replicaId: "runtime-2", address: "ws://10.0.0.2:3105" }));
  });
});
