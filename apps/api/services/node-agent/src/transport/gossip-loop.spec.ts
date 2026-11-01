import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startGossipLoop } from "./gossip-loop";

/** A seed list the way the agent keeps it: addresses are added at any time and removed once they answered. */
function seedList(...initial: string[]) {
  const addresses = new Set(initial);
  return {
    add: (address: string) => void addresses.add(address),
    pending: () => Promise.resolve([...addresses]),
    reached: (address: string) => {
      addresses.delete(address);
      return Promise.resolve();
    },
  };
}

describe("startGossipLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("learns from every pending seed, then only runs rounds", async () => {
    const seeds = seedList("ws://a", "ws://b");
    const seed = vi.fn().mockResolvedValue({ reached: true });
    const round = vi.fn().mockResolvedValue(0);

    const loop = startGossipLoop({ ...seeds, seed, round, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(seed.mock.calls.map(([address]) => address)).toEqual(["ws://a", "ws://b"]);
    expect(round.mock.calls.length).toBeGreaterThanOrEqual(2);
    loop.stop();
  });

  it("keeps retrying a seed that was down until it answers", async () => {
    const seeds = seedList("ws://a");
    const seed = vi
      .fn()
      .mockResolvedValueOnce({ reached: false })
      .mockResolvedValueOnce({ reached: false })
      .mockResolvedValue({ reached: true });

    const loop = startGossipLoop({ ...seeds, seed, round: () => Promise.resolve(0), intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(seed).toHaveBeenCalledTimes(3);
    loop.stop();
  });

  it("works alone with no seed at all, and joins a swarm the moment a seed is added", async () => {
    const seeds = seedList();
    const seed = vi.fn().mockResolvedValue({ reached: true });
    const round = vi.fn().mockResolvedValue(0);

    const loop = startGossipLoop({ ...seeds, seed, round, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(seed).not.toHaveBeenCalled();
    expect(round.mock.calls.length).toBeGreaterThanOrEqual(3);

    seeds.add("ws://swarm");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(seed).toHaveBeenCalledWith("ws://swarm");
    loop.stop();
  });

  it("stops for good", async () => {
    const round = vi.fn().mockResolvedValue(0);

    const loop = startGossipLoop({ ...seedList(), seed: () => Promise.resolve({ reached: true }), round, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    loop.stop();
    const after = round.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(round.mock.calls.length).toBe(after);
  });

  it("goes on after a round that failed, and reports it", async () => {
    const round = vi.fn().mockRejectedValueOnce(new Error("runtime hiccup")).mockResolvedValue(0);
    const onError = vi.fn();

    const loop = startGossipLoop({ ...seedList(), seed: () => Promise.resolve({ reached: true }), round, onError, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(3_000);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(round.mock.calls.length).toBeGreaterThanOrEqual(3);
    loop.stop();
  });

  it("does not report a round that was cut short by stopping", async () => {
    let fail: (error: Error) => void = () => undefined;
    const round = vi.fn(() => new Promise<number>((_resolve, reject) => { fail = reject; }));
    const onError = vi.fn();

    const loop = startGossipLoop({ ...seedList(), seed: () => Promise.resolve({ reached: true }), round, onError, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    loop.stop();
    fail(new Error("All fibers interrupted"));
    await vi.advanceTimersByTimeAsync(10);

    expect(onError).not.toHaveBeenCalled();
  });
});
