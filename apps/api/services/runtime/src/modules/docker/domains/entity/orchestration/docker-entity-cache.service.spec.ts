import { beforeEach, describe, expect, it, vi } from "vitest";
import { DockerEntityCacheService } from "./docker-entity-cache.service";

describe("DockerEntityCacheService", () => {
  let service: DockerEntityCacheService;

  beforeEach(() => {
    service = new DockerEntityCacheService();
    vi.useFakeTimers();
  });

  it("returns a cache miss on the first call and a hit on the second", async () => {
    const compute = vi.fn().mockResolvedValue({ payload: [{ id: "abc" }] });

    const first = await service.getOrCompute("container", compute);
    expect(first.hit).toBe(false);
    expect(first.payload).toEqual([{ id: "abc" }]);
    expect(first.etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(compute).toHaveBeenCalledTimes(1);

    const second = await service.getOrCompute("container", compute);
    expect(second.hit).toBe(true);
    expect(second.payload).toEqual([{ id: "abc" }]);
    expect(second.etag).toBe(first.etag);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("expires entries after the TTL elapses", async () => {
    const compute = vi.fn().mockResolvedValue({
      payload: [{ id: "abc" }],
      ttlMs: 1000,
    });

    const first = await service.getOrCompute("container", compute);
    expect(first.hit).toBe(false);

    vi.advanceTimersByTime(999);
    const stillFresh = await service.getOrCompute("container", compute);
    expect(stillFresh.hit).toBe(true);

    vi.advanceTimersByTime(2);
    const expired = await service.getOrCompute("container", compute);
    expect(expired.hit).toBe(false);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("isolates entries by kind", async () => {
    const computeContainer = vi.fn().mockResolvedValue({ payload: [{ id: "c1" }] });
    const computeImage = vi.fn().mockResolvedValue({ payload: [{ id: "i1" }] });

    await service.getOrCompute("container", computeContainer);
    await service.getOrCompute("image", computeImage);
    await service.getOrCompute("container", computeContainer);
    await service.getOrCompute("image", computeImage);

    expect(computeContainer).toHaveBeenCalledTimes(1);
    expect(computeImage).toHaveBeenCalledTimes(1);
  });

  it("invalidates a single kind without touching other entries", async () => {
    await service.getOrCompute("container", () => Promise.resolve({ payload: [1] }));
    await service.getOrCompute("image", () => Promise.resolve({ payload: [2] }));

    service.invalidate("container");

    const containerAfter = await service.getOrCompute("container", () =>
      Promise.resolve({ payload: [1] }),
    );
    const imageAfter = await service.getOrCompute("image", () =>
      Promise.resolve({ payload: [2] }),
    );

    expect(containerAfter.hit).toBe(false);
    expect(imageAfter.hit).toBe(true);
  });

  it("invalidates everything when called without a kind", async () => {
    await service.getOrCompute("container", () => Promise.resolve({ payload: [1] }));
    await service.getOrCompute("image", () => Promise.resolve({ payload: [2] }));

    service.invalidate();

    const containerAfter = await service.getOrCompute("container", () =>
      Promise.resolve({ payload: [1] }),
    );
    const imageAfter = await service.getOrCompute("image", () =>
      Promise.resolve({ payload: [2] }),
    );

    expect(containerAfter.hit).toBe(false);
    expect(imageAfter.hit).toBe(false);
  });

  it("produces a stable ETag for identical payloads", async () => {
    const computeA = vi.fn().mockResolvedValue({ payload: [{ id: "abc" }] });
    const computeB = vi.fn().mockResolvedValue({ payload: [{ id: "abc" }] });

    const a = await service.getOrCompute("container", computeA);
    service.invalidate("container");
    const b = await service.getOrCompute("container", computeB);

    expect(a.etag).toBe(b.etag);
  });

  it("produces a different ETag for different payloads", async () => {
    const a = await service.getOrCompute("container", () =>
      Promise.resolve({ payload: [{ id: "abc" }] }),
    );
    const b = await service.getOrCompute("image", () =>
      Promise.resolve({ payload: [{ id: "xyz" }] }),
    );

    expect(a.etag).not.toBe(b.etag);
  });
});
