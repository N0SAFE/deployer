import { Effect, Fiber } from "effect";
import { describe, expect, it, vi } from "vitest";

import { replicaHeartbeat } from "./replica-heartbeat";

import type { ClientContext, ClientLink } from "@orpc/client";

type Link = ClientLink<ClientContext>;

const calls = (agent: Link) => vi.mocked(agent.call).mock.calls.length;

const options = (agent: Link, keys: () => string[] | Promise<string[]> = () => []) => ({
  agent,
  service: "runtime",
  replicaId: "runtime-1",
  address: "ws://10.0.0.1:3105/mesh/ws",
  keys,
  load: () => 0.25,
  intervalMs: 10,
  ttlMs: 50,
});

describe("replicaHeartbeat", () => {
  it("registers the replica with its address, load and current keys on every beat", async () => {
    const agent: Link = { call: vi.fn().mockResolvedValue({}) };
    let keys = ["stream-1"];

    const fiber = Effect.runFork(replicaHeartbeat(options(agent, () => keys)));
    await vi.waitFor(() => { expect(calls(agent)).toBeGreaterThanOrEqual(1); });
    keys = ["stream-1", "stream-2"];
    const before = calls(agent);
    await vi.waitFor(() => { expect(calls(agent)).toBeGreaterThan(before + 1); });
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(agent.call).toHaveBeenNthCalledWith(
      1,
      ["directory", "register"],
      { service: "runtime", replicaId: "runtime-1", address: "ws://10.0.0.1:3105/mesh/ws", load: 0.25, keys: ["stream-1"], ttlMs: 50 },
      { context: {} },
    );
    const last = vi.mocked(agent.call).mock.calls[calls(agent) - 1];
    expect(last?.[1]).toMatchObject({ keys: ["stream-1", "stream-2"] });
  });

  it("keeps beating through a failed beat", async () => {
    const agent: Link = { call: vi.fn().mockRejectedValueOnce(new Error("agent restarting")).mockResolvedValue({}) };

    const fiber = Effect.runFork(replicaHeartbeat(options(agent)));
    await vi.waitFor(() => { expect(calls(agent)).toBeGreaterThanOrEqual(3); });
    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  it("stops beating when interrupted", async () => {
    const agent: Link = { call: vi.fn().mockResolvedValue({}) };

    const fiber = Effect.runFork(replicaHeartbeat(options(agent)));
    await vi.waitFor(() => { expect(calls(agent)).toBeGreaterThan(0); });
    await Effect.runPromise(Fiber.interrupt(fiber));
    const after = calls(agent);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(calls(agent)).toBe(after);
  });

  it("waits for keys that have to be asked for, and keeps the same registration shape", async () => {
    const agent: Link = { call: vi.fn().mockResolvedValue({}) };

    const fiber = Effect.runFork(
      replicaHeartbeat(options(agent, () => new Promise<string[]>((resolve) => setTimeout(() => resolve(["container-9"]), 5)) as never)),
    );
    await vi.waitFor(() => expect(calls(agent)).toBeGreaterThan(0));
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(vi.mocked(agent.call).mock.calls[0]?.[1]).toMatchObject({ keys: ["container-9"] });
  });
});
