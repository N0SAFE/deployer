import { Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { makeMeshNamespace, resolveExpectedResponders } from "./mesh-namespace";

type Published = { topic: string; payload: Record<string, unknown> };

/** A topic handle backed by one Subject per topic, recording what is published. */
function fakeHandle() {
  const subjects = new Map<string, Subject<unknown>>();
  const subject = (topic: string) => {
    let existing = subjects.get(topic);
    if (!existing) {
      existing = new Subject<unknown>();
      subjects.set(topic, existing);
    }
    return existing;
  };
  const published: Published[] = [];
  return {
    published,
    emit: (topic: string, value: unknown) => subject(topic).next(value),
    handle: {
      observe$: (topic: string) => subject(topic).asObservable(),
      publish: (topic: string, _input: unknown, payload: Record<string, unknown>) => {
        published.push({ topic, payload });
      },
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

const setup = (peers: number | null = null) => {
  const fake = fakeHandle();
  const topics = { registerNamespace: vi.fn(() => fake.handle as never) };
  const topology = {
    getLocalNode: () => ({ nodeId: "local" }),
    ...(peers === null ? {} : { listPeerSessions: () => ({ items: Array.from({ length: peers }, () => ({ state: "connected" })) }) }),
  };
  const logger = { error: vi.fn() };
  const namespace = makeMeshNamespace({ topics, topology, namespace: "docker", contracts: {} as never, logger });
  namespace.initialize();
  return { fake, namespace, logger, topics };
};

describe("makeMeshNamespace", () => {
  it("expects this node plus every connected peer to answer", () => {
    expect(resolveExpectedResponders({ getLocalNode: () => ({ nodeId: "a" }) })).toBeNull();
    expect(resolveExpectedResponders({ getLocalNode: () => ({ nodeId: "a" }), listPeerSessions: () => ({ items: [{ state: "connected" }, { state: "down" }] }) })).toBe(2);
  });

  it("refuses to call before it is initialized and after it is torn down", async () => {
    const { namespace } = setup();
    namespace.teardown();
    await expect(namespace.callMany("req", "res", "cancel", {})).rejects.toThrow(/not initialized/);
  });

  it("skips a namespace the topic service already registered", () => {
    const namespace = makeMeshNamespace({
      topics: { registerNamespace: () => { throw new Error("namespace 'docker' already registered"); } },
      topology: { getLocalNode: () => ({ nodeId: "local" }) },
      namespace: "docker",
      contracts: {} as never,
      logger: { error: vi.fn() },
    });
    expect(() => namespace.initialize()).not.toThrow();
    expect(namespace.handle).toBeNull();
  });

  it("collects answers until every expected node has replied, then cancels the rest", async () => {
    const { fake, namespace } = setup(1);
    const call = namespace.callMany<{ q: number }, { n: number }>("req", "res", "cancel", { q: 1 }, { timeoutMs: 5000 });
    const request = fake.published[0]!;
    expect(request.topic).toBe("req");
    const correlationId = request.payload.correlationId as string;

    fake.emit("res", { correlationId, responderNodeId: "a", payload: { n: 1 }, emittedAt: new Date().toISOString() });
    fake.emit("res", { correlationId, responderNodeId: "b", payload: { n: 2 }, emittedAt: new Date().toISOString() });

    const result = await call;
    expect(result.responses).toEqual([{ n: 1 }, { n: 2 }]);
    expect(result.stoppedEarly).toBe(true);
    expect(result.reason).toBe("killer_switch");
    expect(result.metrics).toMatchObject({ expectedResponders: 2, receivedResponses: 2 });
    expect(fake.published.some((entry) => entry.topic === "cancel")).toBe(true);
  });

  it("times out with what it has and counts a repeated responder as a retry", async () => {
    const { fake, namespace } = setup();
    const call = namespace.callMany<unknown, { n: number }>("req", "res", "cancel", {}, { timeoutMs: 20 });
    const correlationId = fake.published[0]!.payload.correlationId as string;
    fake.emit("res", { correlationId, responderNodeId: "a", payload: { n: 1 }, emittedAt: new Date().toISOString() });
    fake.emit("res", { correlationId, responderNodeId: "a", payload: { n: 2 }, emittedAt: new Date().toISOString() });

    const result = await call;
    expect(result.metrics).toMatchObject({ timedOut: true, retryResponses: 1, receivedResponses: 2 });
    expect(result.reason).toBe("timeout");
  });

  it("answers a request with the handler's payload and ignores a cancelled one", async () => {
    const { fake, namespace } = setup();
    namespace.registerCallHandler("req", "res", "cancel", ({ payload }: { payload: { q: number } }) => ({ payload: { doubled: payload.q * 2 } }));

    fake.emit("req", { correlationId: "c1", callerNodeId: "peer", payload: { q: 4 }, emittedAt: "x" });
    await flush();
    const response = fake.published.find((entry) => entry.topic === "res");
    expect(response?.payload).toMatchObject({ correlationId: "c1", responderNodeId: "local", payload: { doubled: 8 } });

    fake.emit("cancel", { correlationId: "c2", callerNodeId: "peer", reason: "caller_stop", emittedAt: "x" });
    fake.emit("req", { correlationId: "c2", callerNodeId: "peer", payload: { q: 1 }, emittedAt: "x" });
    await flush();
    expect(fake.published.filter((entry) => entry.topic === "res")).toHaveLength(1);
  });

  it("logs a handler failure instead of crashing", async () => {
    const { fake, namespace, logger } = setup();
    namespace.registerCallHandler("req", "res", "cancel", () => { throw new Error("boom"); });
    fake.emit("req", { correlationId: "c1", callerNodeId: "peer", payload: {}, emittedAt: "x" });
    await flush();
    expect(logger.error).toHaveBeenCalled();
  });
});
