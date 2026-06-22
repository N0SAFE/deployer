import { describe, it, expect } from "vitest";
import { MeshConnectionRegistry } from "./connection/mesh-connection-registry";
import { ServerConnectionConsumerRegistry } from "./connection/mesh-consumer-registry";
import { eq, and, or, inSet } from "./filter/mesh-filter";
import { reconstructFilter } from "./filter/mesh-filter-evaluator";
import { isFilterSubset, unionFilters } from "./filter/mesh-filter-subset";
import type { MeshFilterDescriptor } from "./filter/mesh-filter.types";
import { compileParamsToFilterDescriptor } from "./params/mesh-params-compiler";
import { Subject } from "rxjs";

function makeId(): string {
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

describe("Mesh Small", () => {
  it("eq filter", () => {
    const filter = eq("env", "prod" as const);
    expect(filter.evaluate({ env: "prod" } as any)).toBe(true);
    expect(filter.evaluate({ env: "staging" } as any)).toBe(false);
    expect(reconstructFilter(filter.descriptor)({ env: "prod" })).toBe(true);
  });

  it("and filter", () => {
    const filter = and(eq("env", "prod" as const), eq("status", "running" as const));
    expect(filter.evaluate({ env: "prod", status: "running" } as any)).toBe(true);
    expect(filter.evaluate({ env: "prod", status: "stopped" } as any)).toBe(false);
  });

  it("or filter", () => {
    const filter = or(eq("env", "prod" as const), eq("env", "staging" as const));
    expect(filter.evaluate({ env: "prod" } as any)).toBe(true);
    expect(filter.evaluate({ env: "canary" } as any)).toBe(false);
  });

  it("inSet filter", () => {
    const filter = inSet("status", ["running", "pending"] as const);
    expect(filter.evaluate({ status: "running" } as any)).toBe(true);
    expect(filter.evaluate({ status: "stopped" } as any)).toBe(false);
  });

  it("subset detection", () => {
    const a: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
    const b: MeshFilterDescriptor = { op: "in", field: "env", values: ["prod", "staging"] };
    expect(isFilterSubset(a, b)).toBe(true);
    expect(isFilterSubset(b, a)).toBe(false);
  });

  it("union filters", () => {
    const a: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
    const b: MeshFilterDescriptor = { op: "eq", field: "env", value: "staging" };
    expect(unionFilters(a, b)).toEqual({ op: "or", operands: [a, b] });
  });

  it("compile params", () => {
    const descriptor = compileParamsToFilterDescriptor({ env: "prod", status: "running" });
    expect(descriptor).toEqual({
      op: "and",
      operands: [
        { op: "eq", field: "env", value: "prod" },
        { op: "eq", field: "status", value: "running" },
      ],
    });
  });

  it("connection registry open", async () => {
    const registry = new MeshConnectionRegistry();
    const consumerId = makeId() as any;
    const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
    const conn = await registry.open("node-A", "deployments", "list", consumerId, filter);
    expect(conn.nodeId).toBe("node-A");
    registry.release(conn.id, consumerId);
  });

  it("consumer registry recipients", () => {
    const registry = new ServerConnectionConsumerRegistry();
    registry.attach("c1" as any, { op: "eq", field: "env", value: "prod" });
    registry.attach("c2" as any, { op: "eq", field: "env", value: "staging" });
    expect(registry.computeRecipients({ env: "prod" })).toContain("c1");
    expect(registry.computeRecipients({ env: "prod" })).not.toContain("c2");
  });

  it("consumer observable", () => {
    const registry = new MeshConnectionRegistry();
    const source$ = new Subject<any>();
    const consumerId = "consumer-A" as any;
    const obs = registry.buildConsumerObservable(source$, consumerId);
    const values: any[] = [];
    const sub = obs.subscribe((v) => values.push(v));

    source$.next({
      connectionId: "conn-1",
      recipients: [consumerId],
      entityKey: "deployments",
      eventType: "updated",
      payload: { id: "dep-1" },
      timestamp: new Date().toISOString(),
      sourceNodeId: "node-A",
    });

    expect(values.length).toBe(1);
    expect(values[0].id).toBe("dep-1");
    sub.unsubscribe();
  });
});
