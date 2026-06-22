import { describe, it, expect } from "vitest";
import { Subject } from "rxjs";
import { MeshConnectionRegistry } from "@/core/modules/mesh/connection/mesh-connection-registry";
import { ServerConnectionConsumerRegistry } from "@/core/modules/mesh/connection/mesh-consumer-registry";
import type { MeshFilterDescriptor, MeshConsumerId } from "@/core/modules/mesh/filter/mesh-filter.types";
import { and, eq, inSet } from "@/core/modules/mesh/filter/mesh-filter";

function id(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

describe("Mesh E2E: Reactive Subquery + Shared SSE", () => {
  it("recomputes projectId filter when upstream project stream changes", () => {
    const activeProjects$ = new Subject<{ items: Array<{ data: { projectId: string } }> }>();
    const derivedFilters: MeshFilterDescriptor[] = [];

    const sub = activeProjects$.subscribe((projectsResult) => {
      const projectIds = projectsResult.items.map((i) => i.data.projectId);
      const filter = and(
        inSet("projectId", projectIds),
        eq("environment", "prod" as const),
      );
      derivedFilters.push(filter.descriptor);
    });

    activeProjects$.next({ items: [{ data: { projectId: "p1" } }, { data: { projectId: "p2" } }] });
    activeProjects$.next({ items: [{ data: { projectId: "p1" } }, { data: { projectId: "p2" } }, { data: { projectId: "p3" } }] });
    activeProjects$.next({ items: [{ data: { projectId: "p1" } }, { data: { projectId: "p3" } }] });

    sub.unsubscribe();

    expect(derivedFilters).toHaveLength(3);
    expect(derivedFilters[0]).toEqual({
      op: "and",
      operands: [
        { op: "in", field: "projectId", values: ["p1", "p2"] },
        { op: "eq", field: "environment", value: "prod" },
      ],
    });
    expect(derivedFilters[1]).toEqual({
      op: "and",
      operands: [
        { op: "in", field: "projectId", values: ["p1", "p2", "p3"] },
        { op: "eq", field: "environment", value: "prod" },
      ],
    });
    expect(derivedFilters[2]).toEqual({
      op: "and",
      operands: [
        { op: "in", field: "projectId", values: ["p1", "p3"] },
        { op: "eq", field: "environment", value: "prod" },
      ],
    });
  });

  it("shares one connection and deduplicates recipient delivery across consumers", async () => {
    const connectionRegistry = new MeshConnectionRegistry();
    const serverConsumerRegistry = new ServerConnectionConsumerRegistry();

    const cA = id("consumer-A") as MeshConsumerId;
    const cB = id("consumer-B") as MeshConsumerId;

    const filterA: MeshFilterDescriptor = { op: "eq", field: "environment", value: "prod" };
    const filterB: MeshFilterDescriptor = {
      op: "and",
      operands: [
        { op: "eq", field: "environment", value: "prod" },
        { op: "eq", field: "status", value: "running" },
      ],
    };

    const conn = await connectionRegistry.open("node-1", "deployments", "list", cA, filterA);
    await connectionRegistry.attach(conn.id, cB, filterB);

    expect(connectionRegistry.listOpen()).toHaveLength(1);
    expect(conn.consumers.size).toBe(2);

    serverConsumerRegistry.attach(cA, filterA);
    serverConsumerRegistry.attach(cB, filterB);

    const stream$ = new Subject<any>();
    const a$ = connectionRegistry.buildConsumerObservable(stream$, cA);
    const b$ = connectionRegistry.buildConsumerObservable(stream$, cB);

    const receivedA: string[] = [];
    const receivedB: string[] = [];
    const subA = a$.subscribe((payload) => receivedA.push(payload.deploymentId));
    const subB = b$.subscribe((payload) => receivedB.push(payload.deploymentId));

    // Event matches both filters => single wire event, dual recipients
    const recipients1 = serverConsumerRegistry.computeRecipients({
      deploymentId: "d1",
      environment: "prod",
      status: "running",
    });
    stream$.next({
      connectionId: conn.id,
      recipients: recipients1,
      entityKey: "deployments",
      eventType: "updated",
      payload: { deploymentId: "d1" },
      timestamp: new Date().toISOString(),
      sourceNodeId: "node-1",
    });

    // Event matches only A
    const recipients2 = serverConsumerRegistry.computeRecipients({
      deploymentId: "d2",
      environment: "prod",
      status: "stopped",
    });
    stream$.next({
      connectionId: conn.id,
      recipients: recipients2,
      entityKey: "deployments",
      eventType: "updated",
      payload: { deploymentId: "d2" },
      timestamp: new Date().toISOString(),
      sourceNodeId: "node-1",
    });

    expect(receivedA).toEqual(["d1", "d2"]);
    expect(receivedB).toEqual(["d1"]);

    subA.unsubscribe();
    subB.unsubscribe();

    connectionRegistry.release(conn.id, cA);
    connectionRegistry.release(conn.id, cB);
    expect(connectionRegistry.listOpen()).toHaveLength(0);
  });
});
