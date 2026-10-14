import { describe, it, expect } from "vitest";
import { MeshConnectionRegistry } from "./connection/mesh-connection-registry";
import { ServerConnectionConsumerRegistry } from "./connection/mesh-consumer-registry";
import { eq } from "./filter/mesh-filter";
import type { MeshFilterDescriptor } from "./filter/mesh-filter.types";
import { Subject } from "rxjs";

function makeId(): string {
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

describe("Mesh Async", () => {
  it("async test with connection registry", async () => {
    const registry = new MeshConnectionRegistry();
    const consumerId = makeId() as any;
    const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

    const conn = await registry.open("node-A", "deployments", "list", consumerId, filter);
    expect(conn.nodeId).toBe("node-A");
    registry.release(conn.id, consumerId);
  });

  it("async test with consumer registry", async () => {
    const registry = new ServerConnectionConsumerRegistry();
    registry.attach("consumer-A" as any, { op: "eq", field: "env", value: "prod" });
    const recipients = registry.computeRecipients({ env: "prod" });
    expect(recipients).toContain("consumer-A");
  });

  it("async test with Subject", async () => {
    const subj = new Subject<number>();
    const values: number[] = [];
    const subscription = subj.subscribe((v) => values.push(v));
    subj.next(1);
    subj.next(2);
    expect(values).toEqual([1, 2]);
    subscription.unsubscribe();
  });
});
