import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startGossipLoop } from "./gossip-loop";

describe("startGossipLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("learns from every seed, then only runs rounds", async () => {
    const seed = vi.fn().mockResolvedValue(true);
    const round = vi.fn().mockResolvedValue(0);

    const loop = startGossipLoop({ seeds: ["ws://a", "ws://b"], seed, round, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(seed.mock.calls.map(([address]) => address)).toEqual(["ws://a", "ws://b"]);
    expect(round.mock.calls.length).toBeGreaterThanOrEqual(2);
    loop.stop();
  });

  it("keeps retrying a seed that was down until it answers", async () => {
    const seed = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);

    const loop = startGossipLoop({ seeds: ["ws://a"], seed, round: () => Promise.resolve(0), intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(seed).toHaveBeenCalledTimes(3);
    loop.stop();
  });

  it("runs rounds with no seeds at all", async () => {
    const round = vi.fn().mockResolvedValue(0);

    const loop = startGossipLoop({ seeds: [], seed: () => Promise.resolve(true), round, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(2_500);

    expect(round.mock.calls.length).toBeGreaterThanOrEqual(3);
    loop.stop();
  });

  it("stops for good", async () => {
    const round = vi.fn().mockResolvedValue(0);

    const loop = startGossipLoop({ seeds: [], seed: () => Promise.resolve(true), round, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    loop.stop();
    const after = round.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(round.mock.calls.length).toBe(after);
  });
});
