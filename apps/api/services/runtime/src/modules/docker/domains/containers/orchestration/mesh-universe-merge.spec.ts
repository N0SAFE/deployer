import { describe, expect, it } from "vitest";

import {
  dedupeContainersById,
  mergeContainerHealth,
  mergeContainerStatus,
  paginateList,
  resolvePeerBaseUrl,
} from "./mesh-universe-merge";

const container = (over: Record<string, unknown>) =>
  ({
    id: "c1",
    status: "running",
    health: "healthy",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  }) as never;

describe("mesh universe merge", () => {
  it("lets the worse status or health win when nodes disagree", () => {
    expect(mergeContainerStatus("running", "dead")).toBe("dead");
    expect(mergeContainerStatus("exited", "running")).toBe("exited");
    expect(mergeContainerHealth("healthy", "unhealthy")).toBe("unhealthy");
    expect(mergeContainerHealth("none", "healthy")).toBe("none");
  });

  it("dedupes by id keeping the newest body and the worst status", () => {
    const merged = dedupeContainersById([
      container({ status: "running", updatedAt: "2026-10-01T00:00:00.000Z", name: "old" }),
      container({ status: "exited", updatedAt: "2026-10-02T00:00:00.000Z", name: "new" }),
      container({ id: "c2" }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.id === "c1")).toMatchObject({ name: "new", status: "exited" });
  });

  it("pages a list and reports whether more remain", () => {
    expect(paginateList([1, 2, 3], 2, 0)).toEqual({ data: [1, 2], meta: { total: 3, limit: 2, offset: 0, hasMore: true } });
    expect(paginateList([1, 2, 3], 2, 2).meta.hasMore).toBe(false);
  });

  it("resolves a peer's base url from its endpoint when metadata names none", () => {
    expect(resolvePeerBaseUrl("https://peer.example.com/mesh", {})).toBeTypeOf("string");
    expect(resolvePeerBaseUrl("not a url", null)).toBeNull();
  });
});
