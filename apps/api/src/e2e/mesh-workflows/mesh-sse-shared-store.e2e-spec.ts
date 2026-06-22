import { describe, it, expect } from "vitest";
import { MeshConnectionRegistry } from "@/core/modules/mesh/connection/mesh-connection-registry";
import type { MeshFilterDescriptor, MeshConsumerId } from "@/core/modules/mesh/filter/mesh-filter.types";
import { isFilterSubset, unionFilters } from "@/core/modules/mesh/filter/mesh-filter-subset";

function id(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

describe("Mesh E2E: Shared SSE Stream Store", () => {
  it("reuses existing open stream for same node/entity/method and attaches new consumer", async () => {
    const registry = new MeshConnectionRegistry();

    const c1 = id("c1") as MeshConsumerId;
    const c2 = id("c2") as MeshConsumerId;
    const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

    const conn = await registry.open("node-a", "deployments", "list", c1, filter);
    const found = registry.lookup("node-a", "deployments", "list");

    expect(found?.id).toBe(conn.id);

    await registry.attach(conn.id, c2, filter);
    expect(registry.listOpen()).toHaveLength(1);
    expect(conn.consumers.size).toBe(2);
  });

  it("decides attach when incoming filter is subset", async () => {
    const registry = new MeshConnectionRegistry();
    const c1 = id("c1") as MeshConsumerId;

    const broad: MeshFilterDescriptor = { op: "in", field: "env", values: ["prod", "staging"] };
    const narrow: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

    const conn = await registry.open("node-a", "deployments", "list", c1, broad);

    const decision = registry.decidePromotion(narrow, [conn]);
    expect(decision.action).toBe("attach");
    if (decision.action === "attach") {
      expect(decision.connectionId).toBe(conn.id);
    }
  });

  it("decides promote when incoming filter is superset", async () => {
    const registry = new MeshConnectionRegistry();
    const c1 = id("c1") as MeshConsumerId;

    const narrow: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
    const broad: MeshFilterDescriptor = { op: "in", field: "env", values: ["prod", "staging"] };

    const conn = await registry.open("node-a", "deployments", "list", c1, narrow);

    const decision = registry.decidePromotion(broad, [conn]);
    expect(decision.action).toBe("promote");
    if (decision.action === "promote") {
      expect(decision.connectionId).toBe(conn.id);
      expect(decision.newFilter).toEqual(broad);
    }
  });

  it("closes stream when last consumer detaches", async () => {
    const registry = new MeshConnectionRegistry();

    const c1 = id("c1") as MeshConsumerId;
    const c2 = id("c2") as MeshConsumerId;
    const filter: MeshFilterDescriptor = { op: "always" };

    const conn = await registry.open("node-a", "deployments", "list", c1, filter);
    await registry.attach(conn.id, c2, filter);

    registry.release(conn.id, c1);
    expect(registry.listOpen()).toHaveLength(1);

    registry.release(conn.id, c2);
    expect(registry.listOpen()).toHaveLength(0);
  });

  it("validates subset + union semantics used by shared stream store", () => {
    const a: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
    const b: MeshFilterDescriptor = { op: "in", field: "env", values: ["prod", "staging"] };

    expect(isFilterSubset(a, b)).toBe(true);
    expect(isFilterSubset(b, a)).toBe(false);

    expect(unionFilters(a, b)).toEqual({
      op: "or",
      operands: [a, b],
    });
  });
});
