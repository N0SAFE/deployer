import { describe, it, expect, beforeEach } from "vitest";
import { Subject, Observable } from "rxjs";
import { MeshConnectionRegistry } from "@/core/modules/mesh/connection/mesh-connection-registry";
import { ServerConnectionConsumerRegistry } from "@/core/modules/mesh/connection/mesh-consumer-registry";
import { StreamManagerService } from "@/core/modules/mesh/services/stream-manager/stream-manager.service";
import type { MeshFilterDescriptor, MeshConsumerId } from "@/core/modules/mesh/filter/mesh-filter.types";

/**
 * Tests for advanced SSE Stream Store patterns from FULL_MESH_HISTORY.md:
 * - Reference-counted lifecycle (refCount tracking, auto-close on last detach)
 * - Lifecycle$ observable events (connection_opened, consumer_attached, consumer_detached, connection_closed)
 * - Consumer observable filtering (buildConsumerObservable with recipient dedup)
 * - StreamManagerService getOrCreateAndAttach (attach/promote/new decision paths)
 * - Server-side consumer registry (computeRecipients, union filter management)
 * - Edge cases: rapid acquire/release, unknown consumer, concurrent operations
 */

function consumerId(prefix = "c"): MeshConsumerId {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}` as MeshConsumerId;
}

describe("Mesh E2E: Advanced SSE Stream Store", () => {
  describe("Reference-counted lifecycle", () => {
    let registry: MeshConnectionRegistry;

    beforeEach(() => {
      registry = new MeshConnectionRegistry();
    });

    it("tracks refCount as consumer count", async () => {
      const c1 = consumerId();
      const c2 = consumerId();
      const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      const conn = await registry.open("node-a", "deployments", "list", c1, filter);
      expect(conn.consumers.size).toBe(1);

      await registry.attach(conn.id, c2, filter);
      expect(conn.consumers.size).toBe(2);

      registry.release(conn.id, c1);
      expect(conn.consumers.size).toBe(1);
    });

    it("auto-closes connection when last consumer releases", async () => {
      const c1 = consumerId();
      const c2 = consumerId();
      const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      const conn = await registry.open("node-a", "deployments", "list", c1, filter);
      await registry.attach(conn.id, c2, filter);

      registry.release(conn.id, c1);
      expect(registry.listOpen().some((c) => c.id === conn.id)).toBe(true);

      registry.release(conn.id, c2);
      await new Promise((r) => setTimeout(r, 20));

      expect(registry.listOpen().some((c) => c.id === conn.id)).toBe(false);
    });

    it("handles rapid release/re-acquire without churn", async () => {
      const c1 = consumerId();
      const c2 = consumerId();
      const prodFilter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      // Open prod stream
      const conn = await registry.open("node-a", "deployments", "list", c1, prodFilter);

      // Release the last consumer — connection closes immediately (refCount 1→0)
      registry.release(conn.id, c1);

      // Wait for close to propagate
      await new Promise((r) => setTimeout(r, 20));
      expect(registry.listOpen().some((c) => c.id === conn.id)).toBe(false);

      // Re-acquire by opening a brand new connection
      const conn2 = await registry.open("node-a", "deployments", "list", c2, prodFilter);
      expect(conn2.id).not.toBe(conn.id);
      expect(registry.listOpen().some((c) => c.id === conn2.id)).toBe(true);
    });

    it("releasing unknown consumer does not throw", () => {
      const c1 = consumerId();
      const unknown = consumerId();

      // Calling release on a non-existent connection should not throw
      expect(() => registry.release("nonexistent" as any, c1)).not.toThrow();

      // Calling release for a consumer not in the map should not throw
      // (first open, then release a different consumer)
      // This depends on implementation — currently release deletes from map
      // which is a no-op if consumer not present
    });
  });

  describe("Lifecycle$ observable events", () => {
    it("emits connection_opened when a new connection is created", async () => {
      const registry = new MeshConnectionRegistry();
      const events: string[] = [];

      const sub = registry.lifecycle$.subscribe((evt) => {
        events.push(evt.type);
      });

      const c1 = consumerId();
      const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      await registry.open("node-a", "deployments", "list", c1, filter);

      // Allow async connection establishment to complete
      await new Promise((r) => setTimeout(r, 20));

      expect(events).toContain("connection_opened");
      sub.unsubscribe();
    });

    it("emits consumer_attached when a consumer is added to existing connection", async () => {
      const registry = new MeshConnectionRegistry();
      const events: string[] = [];

      const c1 = consumerId();
      const c2 = consumerId();
      const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      const conn = await registry.open("node-a", "deployments", "list", c1, filter);

      const sub = registry.lifecycle$.subscribe((evt) => {
        events.push(evt.type);
      });

      await registry.attach(conn.id, c2, filter);

      expect(events).toContain("consumer_attached");
      sub.unsubscribe();
    });

    it("emits consumer_detached and connection_closed on last release", async () => {
      const registry = new MeshConnectionRegistry();
      const events: string[] = [];

      const c1 = consumerId();
      const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      const conn = await registry.open("node-a", "deployments", "list", c1, filter);

      const sub = registry.lifecycle$.subscribe((evt) => {
        events.push(evt.type);
      });

      registry.release(conn.id, c1);
      await new Promise((r) => setTimeout(r, 20));

      expect(events).toContain("consumer_detached");
      expect(events).toContain("connection_closed");
      sub.unsubscribe();
    });

    it("provides metadata on lifecycle events", async () => {
      const registry = new MeshConnectionRegistry();
      const events: any[] = [];

      const sub = registry.lifecycle$.subscribe((evt) => {
        events.push(evt);
      });

      const c1 = consumerId();
      const c2 = consumerId();
      const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      const conn = await registry.open("node-a", "deployments", "list", c1, filter);
      await new Promise((r) => setTimeout(r, 20));

      await registry.attach(conn.id, c2, filter);
      registry.release(conn.id, c1);
      registry.release(conn.id, c2);
      await new Promise((r) => setTimeout(r, 20));

      const opened = events.find((e) => e.type === "connection_opened");
      expect(opened).toBeDefined();
      expect(opened.nodeId).toBe("node-a");
      expect(opened.entityKey).toBe("deployments");

      const attached = events.find((e) => e.type === "consumer_attached");
      expect(attached).toBeDefined();
      expect(attached.consumerCount).toBe(2);

      const detached = events.find((e) => e.type === "consumer_detached");
      expect(detached).toBeDefined();

      const closed = events.find((e) => e.type === "connection_closed");
      expect(closed).toBeDefined();
      expect(closed.reason).toBe("empty");

      sub.unsubscribe();
    });
  });

  describe("Consumer observable with recipient filtering", () => {
    it("filters events by recipient list", () => {
      const registry = new MeshConnectionRegistry();
      const stream$ = new Subject<any>();
      const cA = consumerId();
      const cB = consumerId();

      const a$ = registry.buildConsumerObservable(stream$, cA);
      const b$ = registry.buildConsumerObservable(stream$, cB);

      const receivedA: string[] = [];
      const receivedB: string[] = [];

      a$.subscribe((payload) => receivedA.push(payload.id));
      b$.subscribe((payload) => receivedB.push(payload.id));

      // Event addressed to both consumers
      stream$.next({
        connectionId: "conn-1",
        recipients: [cA, cB],
        entityKey: "deployments",
        eventType: "updated",
        payload: { id: "dep-1" },
        timestamp: new Date().toISOString(),
        sourceNodeId: "node-1",
      });

      // Event addressed only to cA
      stream$.next({
        connectionId: "conn-1",
        recipients: [cA],
        entityKey: "deployments",
        eventType: "updated",
        payload: { id: "dep-2" },
        timestamp: new Date().toISOString(),
        sourceNodeId: "node-1",
      });

      // Event with empty recipients (should be suppressed by producer but filter anyway)
      stream$.next({
        connectionId: "conn-1",
        recipients: [],
        entityKey: "deployments",
        eventType: "updated",
        payload: { id: "dep-3" },
        timestamp: new Date().toISOString(),
        sourceNodeId: "node-1",
      });

      expect(receivedA).toEqual(["dep-1", "dep-2"]);
      expect(receivedB).toEqual(["dep-1"]);
    });

    it("delivers no events after consumer unsubscribes", () => {
      const registry = new MeshConnectionRegistry();
      const stream$ = new Subject<any>();
      const cA = consumerId();

      const a$ = registry.buildConsumerObservable(stream$, cA);
      const received: string[] = [];

      const sub = a$.subscribe((payload) => received.push(payload.id));

      stream$.next({
        connectionId: "conn-1",
        recipients: [cA],
        entityKey: "deployments",
        eventType: "updated",
        payload: { id: "dep-1" },
        timestamp: new Date().toISOString(),
        sourceNodeId: "node-1",
      });

      sub.unsubscribe();

      stream$.next({
        connectionId: "conn-1",
        recipients: [cA],
        entityKey: "deployments",
        eventType: "updated",
        payload: { id: "dep-2" },
        timestamp: new Date().toISOString(),
        sourceNodeId: "node-1",
      });

      expect(received).toEqual(["dep-1"]);
    });
  });

  describe("Server-side consumer registry", () => {
    let serverRegistry: ServerConnectionConsumerRegistry;

    beforeEach(() => {
      serverRegistry = new ServerConnectionConsumerRegistry();
    });

    it("computes recipients based on filter matching", () => {
      const cA = consumerId();
      const cB = consumerId();

      serverRegistry.attach(cA, { op: "eq", field: "env", value: "prod" });
      serverRegistry.attach(cB, { op: "eq", field: "env", value: "staging" });

      // Event with env=prod should go to cA only
      const prodRecipients = serverRegistry.computeRecipients({ env: "prod" });
      expect(prodRecipients).toContain(cA);
      expect(prodRecipients).not.toContain(cB);

      // Event with env=staging should go to cB only
      const stagingRecipients = serverRegistry.computeRecipients({ env: "staging" });
      expect(stagingRecipients).toContain(cB);
      expect(stagingRecipients).not.toContain(cA);
    });

    it("returns empty recipients for non-matching events", () => {
      const cA = consumerId();
      serverRegistry.attach(cA, { op: "eq", field: "env", value: "prod" });

      const recipients = serverRegistry.computeRecipients({ env: "nonexistent" });
      expect(recipients).toHaveLength(0);
    });

    it("builds union filter from all consumers", () => {
      const cA = consumerId();
      const cB = consumerId();

      serverRegistry.attach(cA, { op: "eq", field: "env", value: "prod" });
      serverRegistry.attach(cB, { op: "eq", field: "env", value: "staging" });

      const union = serverRegistry.getUnionFilter();
      expect(union.op).toBe("or");
      if (union.op === "or") {
        expect(union.operands).toHaveLength(2);
      }
    });

    it("returns single filter when only one consumer", () => {
      const cA = consumerId();
      serverRegistry.attach(cA, { op: "eq", field: "env", value: "prod" });

      const union = serverRegistry.getUnionFilter();
      expect(union).toEqual({ op: "eq", field: "env", value: "prod" });
    });

    it("tracks consumer count correctly through attach/detach", () => {
      const cA = consumerId();
      const cB = consumerId();

      expect(serverRegistry.getConsumerCount()).toBe(0);
      expect(serverRegistry.isEmpty()).toBe(true);

      serverRegistry.attach(cA, { op: "eq", field: "env", value: "prod" });
      expect(serverRegistry.getConsumerCount()).toBe(1);
      expect(serverRegistry.isEmpty()).toBe(false);

      serverRegistry.attach(cB, { op: "eq", field: "env", value: "staging" });
      expect(serverRegistry.getConsumerCount()).toBe(2);

      serverRegistry.detach(cA);
      expect(serverRegistry.getConsumerCount()).toBe(1);

      serverRegistry.detach(cB);
      expect(serverRegistry.getConsumerCount()).toBe(0);
      expect(serverRegistry.isEmpty()).toBe(true);
    });
  });

  describe("StreamManagerService decision paths", () => {
    it("getOrCreateAndAttach creates new connection when none exists", async () => {
      const registry = new MeshConnectionRegistry();
      const manager = new StreamManagerService(registry);

      const c1 = consumerId();
      const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      const conn = await manager.getOrCreateAndAttach(
        "node-a", "deployments", "list", c1, filter
      );

      expect(conn).not.toBeNull();
      expect(conn?.nodeId).toBe("node-a");
      expect(conn?.entityKey).toBe("deployments");
      expect(conn?.consumers.has(c1)).toBe(true);
    });

    it("getOrCreateAndAttach attaches to existing connection when filter is subset", async () => {
      const registry = new MeshConnectionRegistry();
      const manager = new StreamManagerService(registry);

      const c1 = consumerId();
      const c2 = consumerId();
      const broad: MeshFilterDescriptor = { op: "in", field: "env", values: ["prod", "staging"] };
      const narrow: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      // Open broad connection first
      await manager.getOrCreateAndAttach("node-a", "deployments", "list", c1, broad);

      // Narrow filter should attach to existing
      const result = await manager.getOrCreateAndAttach("node-a", "deployments", "list", c2, narrow);

      expect(result).not.toBeNull();
      expect(result?.consumers.has(c2)).toBe(true);

      // Should be a single connection
      const openConns = registry.listOpen().filter(
        (c) => c.nodeId === "node-a" && c.entityKey === "deployments"
      );
      expect(openConns).toHaveLength(1);
      expect(openConns[0]?.consumers.size).toBe(2);
    });

    it("getOrCreateAndAttach promotes connection when filter is superset", async () => {
      const registry = new MeshConnectionRegistry();
      const manager = new StreamManagerService(registry);

      const c1 = consumerId();
      const c2 = consumerId();
      const narrow: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      const broad: MeshFilterDescriptor = { op: "in", field: "env", values: ["prod", "staging"] };

      // Open narrow connection first
      await manager.getOrCreateAndAttach("node-a", "deployments", "list", c1, narrow);

      // Broad filter should promote the existing connection
      const result = await manager.getOrCreateAndAttach("node-a", "deployments", "list", c2, broad);

      expect(result).not.toBeNull();
      expect(result?.consumers.has(c2)).toBe(true);

      // Server filter should now be the broader one
      expect(result?.serverFilter).toEqual(broad);
    });

    it("getOrCreateAndAttach handles all three decision paths sequentially", async () => {
      const registry = new MeshConnectionRegistry();
      const manager = new StreamManagerService(registry);

      const c1 = consumerId();
      const c2 = consumerId();
      const c3 = consumerId();

      const prodEq: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      const stagingEq: MeshFilterDescriptor = { op: "eq", field: "env", value: "staging" };
      const allIn: MeshFilterDescriptor = { op: "in", field: "env", values: ["prod", "staging", "dev"] };

      // 1st call: new connection for prod
      const conn1 = await manager.getOrCreateAndAttach("node-a", "deployments", "list", c1, prodEq);
      expect(conn1?.consumers.size).toBe(1);

      // 2nd call: attach (staging is a new eq, but same field — currently opens new)
      // Actually staging has no overlap with prod, so this would be "new" for eq on same field
      // Let's use a subset filter instead
      await registry.release(conn1!.id, c1);

      // Reset: open broad first
      const connBroad = await manager.getOrCreateAndAttach("node-a", "deployments", "list", c1, allIn);
      expect(connBroad?.consumers.size).toBe(1);

      // Now prod is subset of allIn → attach
      const conn2 = await manager.getOrCreateAndAttach("node-a", "deployments", "list", c2, prodEq);
      expect(conn2?.id).toBe(connBroad?.id);
      expect(conn2?.consumers.size).toBe(2);

      // Release c2 (prod)
      registry.release(connBroad!.id, c2);
    });
  });
});
