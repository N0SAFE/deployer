import { describe, it, expect, beforeEach } from "vitest";
import { MeshConnectionRegistry } from "./mesh-connection-registry";
import { ServerConnectionConsumerRegistry } from "./mesh-consumer-registry";
import { generateConsumerId, generateConnectionId } from "../filter/mesh-filter.types";
import type { MeshFilterDescriptor } from "../filter/mesh-filter.types";

describe("MeshConnectionRegistry", () => {
  let registry: MeshConnectionRegistry;

  beforeEach(() => {
    registry = new MeshConnectionRegistry();
  });

  describe("open", () => {
    it("opens a new connection", async () => {
      const consumerId = generateConsumerId();
      const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      const conn = await registry.open("node-A", "deployments", "list", consumerId, filter);

      expect(conn.nodeId).toBe("node-A");
      expect(conn.entityKey).toBe("deployments");
      expect(conn.methodName).toBe("list");
      expect(conn.serverFilter).toEqual(filter);
      expect(conn.status).toBe("connecting");
    });
  });

  describe("lookup", () => {
    it("finds existing connection by node+entity+method", async () => {
      const consumerId = generateConsumerId();
      const filter: MeshFilterDescriptor = { op: "always" };

      const conn = await registry.open("node-B", "services", "list", consumerId, filter);
      const found = registry.lookup("node-B", "services", "list");

      expect(found).toBeDefined();
      expect(found!.id).toBe(conn.id);
    });

    it("returns null when no connection exists", () => {
      const found = registry.lookup("node-X", "unknown", "list");
      expect(found).toBeNull();
    });
  });

  describe("attach", () => {
    it("attaches a consumer to existing connection", async () => {
      const consumerA = generateConsumerId();
      const consumerB = generateConsumerId();
      const filter: MeshFilterDescriptor = { op: "always" };

      const conn = await registry.open("node-C", "deployments", "list", consumerA, filter);
      await registry.attach(conn.id, consumerA, filter);
      await registry.attach(conn.id, consumerB, filter);

      expect(conn.consumers.size).toBe(2);
    });

    it("throws when connection not found", async () => {
      const fakeId = generateConnectionId();
      await expect(registry.attach(fakeId, generateConsumerId(), { op: "always" })).rejects.toThrow(
        "Connection",
      );
    });
  });

  describe("release", () => {
    it("removes consumer and keeps connection if others remain", async () => {
      const consumerA = generateConsumerId();
      const consumerB = generateConsumerId();
      const filter: MeshFilterDescriptor = { op: "always" };

      const conn = await registry.open("node-D", "deployments", "list", consumerA, filter);
      await registry.attach(conn.id, consumerB, filter);

      registry.release(conn.id, consumerA);

      expect(conn.consumers.size).toBe(1);
      expect(registry.listOpen().find((c) => c.id === conn.id)).toBeDefined();
    });

    it("closes connection when last consumer releases", async () => {
      const consumerId = generateConsumerId();
      const filter: MeshFilterDescriptor = { op: "always" };

      const conn = await registry.open("node-E", "deployments", "list", consumerId, filter);
      registry.release(conn.id, consumerId);

      const found = registry.listOpen().find((c) => c.id === conn.id);
      expect(found).toBeUndefined();
    });
  });

  describe("lifecycle events", () => {
    it("emits connection_opened event", async () => {
      const events: any[] = [];
      const sub = registry.lifecycle$.subscribe((e) => events.push(e));

      const consumerId = generateConsumerId();
      const conn = await registry.open("node-F", "deployments", "list", consumerId, { op: "always" });

      await new Promise((r) => setTimeout(r, 50));

      const opened = events.find((e) => e.type === "connection_opened" && e.connectionId === conn.id);
      expect(opened).toBeDefined();
      expect(opened.nodeId).toBe("node-F");

      registry.release(conn.id, consumerId);
      sub.unsubscribe();
    });

    it("emits consumer_attached event", async () => {
      const events: any[] = [];
      const sub = registry.lifecycle$.subscribe((e) => events.push(e));

      const consumerA = generateConsumerId();
      const consumerB = generateConsumerId();
      const conn = await registry.open("node-G", "deployments", "list", consumerA, { op: "always" });
      await registry.attach(conn.id, consumerA, { op: "always" });
      await registry.attach(conn.id, consumerB, { op: "always" });

      const attached = events.find(
        (e) => e.type === "consumer_attached" && e.connectionId === conn.id && e.consumerId === consumerB,
      );
      expect(attached).toBeDefined();
      expect(attached.consumerCount).toBe(2);

      registry.release(conn.id, consumerA);
      registry.release(conn.id, consumerB);
      sub.unsubscribe();
    });
  });

  describe("buildConsumerObservable", () => {
    it("filters events by consumerId in recipients", async () => {
      const { Subject } = await import("rxjs");
      const source$ = new Subject<any>();
      const consumerId = generateConsumerId();

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

      source$.next({
        connectionId: "conn-1",
        recipients: ["other-consumer"],
        entityKey: "deployments",
        eventType: "updated",
        payload: { id: "dep-2" },
        timestamp: new Date().toISOString(),
        sourceNodeId: "node-A",
      });

      expect(values.length).toBe(1);
      expect(values[0].id).toBe("dep-1");

      sub.unsubscribe();
    });
  });
});

describe("ServerConnectionConsumerRegistry", () => {
  let registry: ServerConnectionConsumerRegistry;

  beforeEach(() => {
    registry = new ServerConnectionConsumerRegistry();
  });

  describe("computeRecipients", () => {
    it("returns matching consumer IDs", () => {
      registry.attach("consumer-A" as any, { op: "eq", field: "env", value: "prod" });
      registry.attach("consumer-B" as any, { op: "eq", field: "env", value: "staging" });

      const recipients = registry.computeRecipients({ env: "prod" });
      expect(recipients).toContain("consumer-A");
      expect(recipients).not.toContain("consumer-B");
    });

    it("returns empty array for no matches", () => {
      registry.attach("consumer-A" as any, { op: "eq", field: "env", value: "prod" });
      const recipients = registry.computeRecipients({ env: "canary" });
      expect(recipients.length).toBe(0);
    });

    it("matches multiple consumers for shared events", () => {
      registry.attach("consumer-A" as any, { op: "eq", field: "env", value: "prod" });
      registry.attach("consumer-B" as any, {
        op: "and",
        operands: [
          { op: "eq", field: "env", value: "prod" },
          { op: "eq", field: "status", value: "running" },
        ],
      });

      const recipients = registry.computeRecipients({ env: "prod", status: "running" });
      expect(recipients).toContain("consumer-A");
      expect(recipients).toContain("consumer-B");
    });
  });

  describe("getUnionFilter", () => {
    it("returns never for empty registry", () => {
      expect(registry.getUnionFilter()).toEqual({ op: "never" });
    });

    it("returns single filter for one consumer", () => {
      const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      registry.attach("consumer-A" as any, filter);
      expect(registry.getUnionFilter()).toEqual(filter);
    });

    it("returns union of multiple filters", () => {
      registry.attach("consumer-A" as any, { op: "eq", field: "env", value: "prod" });
      registry.attach("consumer-B" as any, { op: "eq", field: "env", value: "staging" });

      const union = registry.getUnionFilter();
      expect(union).toEqual({
        op: "or",
        operands: [
          { op: "eq", field: "env", value: "prod" },
          { op: "eq", field: "env", value: "staging" },
        ],
      });
    });
  });

  describe("attach/detach", () => {
    it("registers and deregisters consumers", () => {
      const consumerId = "consumer-1" as any;
      registry.attach(consumerId, { op: "always" });
      expect(registry.getConsumerCount()).toBe(1);

      registry.detach(consumerId);
      expect(registry.getConsumerCount()).toBe(0);
      expect(registry.isEmpty()).toBe(true);
    });
  });
});
