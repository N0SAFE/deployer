import { describe, it, expect, beforeEach } from "vitest";
import { MeshConnectionRegistry } from "@/core/modules/mesh/connection/mesh-connection-registry";
import { ServerConnectionConsumerRegistry } from "@/core/modules/mesh/connection/mesh-consumer-registry";
import { generateConsumerId, generateConnectionId } from "@/core/modules/mesh/filter/mesh-filter.types";
import type { MeshFilterDescriptor } from "@/core/modules/mesh/filter/mesh-filter.types";

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

describe("MeshConnectionRegistry: stream identity, promotion and lifecycle", () => {
  const prod: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
  const staging: MeshFilterDescriptor = { op: "eq", field: "env", value: "staging" };
  const prodOrStaging: MeshFilterDescriptor = { op: "in", field: "env", values: ["prod", "staging"] };

  let registry: MeshConnectionRegistry;
  beforeEach(() => {
    registry = new MeshConnectionRegistry();
  });

  /** Lets the registry's asynchronous close propagate. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  describe("stream identity (node + entity + method)", () => {
    it("keeps streams for different entities apart", async () => {
      const c1 = generateConsumerId();
      const deployments = await registry.open("node-a", "deployments", "list", c1, prod);
      const services = await registry.open("node-a", "services", "list", c1, prod);

      expect(deployments.id).not.toBe(services.id);
      expect(registry.lookup("node-a", "deployments", "list")?.id).toBe(deployments.id);
      expect(registry.lookup("node-a", "services", "list")?.id).toBe(services.id);
    });

    it("keeps streams for different nodes apart", async () => {
      const c1 = generateConsumerId();
      const a = await registry.open("node-a", "deployments", "list", c1, prod);
      const b = await registry.open("node-b", "deployments", "list", c1, prod);

      expect(a.id).not.toBe(b.id);
      expect(registry.lookup("node-a", "deployments", "list")?.id).toBe(a.id);
      expect(registry.lookup("node-b", "deployments", "list")?.id).toBe(b.id);
    });

    it("keeps streams for different methods apart", async () => {
      const c1 = generateConsumerId();
      const list = await registry.open("node-a", "deployments", "list", c1, prod);
      const stream = await registry.open("node-a", "deployments", "stream", c1, prod);

      expect(list.id).not.toBe(stream.id);
      expect(registry.lookup("node-a", "deployments", "stream")?.id).toBe(stream.id);
    });

    it("serves a second consumer from the same connection instead of opening another", async () => {
      const conn = await registry.open("node-a", "deployments", "list", generateConsumerId(), prod);
      await registry.attach(conn.id, generateConsumerId(), prod);

      expect(registry.listOpen()).toHaveLength(1);
      expect(conn.consumers.size).toBe(2);
    });
  });

  describe("decidePromotion", () => {
    it("attaches when the incoming filter is a subset of the open connection's", async () => {
      const conn = await registry.open("node-a", "deployments", "list", generateConsumerId(), prodOrStaging);

      const decision = registry.decidePromotion(prod, [conn]);

      expect(decision).toMatchObject({ action: "attach", connectionId: conn.id });
    });

    it("promotes when the incoming filter is a superset, carrying the wider filter", async () => {
      const conn = await registry.open("node-a", "deployments", "list", generateConsumerId(), prod);

      const decision = registry.decidePromotion(prodOrStaging, [conn]);

      expect(decision).toMatchObject({ action: "promote", connectionId: conn.id, newFilter: prodOrStaging });
    });

    it("opens a new connection when the filters do not overlap", async () => {
      const conn = await registry.open("node-a", "deployments", "list", generateConsumerId(), prod);

      expect(registry.decidePromotion(staging, [conn]).action).toBe("new");
    });
  });

  describe("reference-counted lifecycle", () => {
    it("tracks the consumer count as consumers attach and release", async () => {
      const c1 = generateConsumerId();
      const conn = await registry.open("node-a", "deployments", "list", c1, prod);
      expect(conn.consumers.size).toBe(1);

      await registry.attach(conn.id, generateConsumerId(), prod);
      expect(conn.consumers.size).toBe(2);

      registry.release(conn.id, c1);
      expect(conn.consumers.size).toBe(1);
    });

    it("opens a fresh connection after the last consumer closed the old one", async () => {
      const first = await registry.open("node-a", "deployments", "list", generateConsumerId(), prod);
      const [consumer] = [...first.consumers.keys()];
      registry.release(first.id, consumer!);
      await settle();
      expect(registry.listOpen().some((c) => c.id === first.id)).toBe(false);

      const second = await registry.open("node-a", "deployments", "list", generateConsumerId(), prod);

      expect(second.id).not.toBe(first.id);
      expect(registry.listOpen().some((c) => c.id === second.id)).toBe(true);
    });

    it("ignores a release for a connection or consumer it does not know", async () => {
      const conn = await registry.open("node-a", "deployments", "list", generateConsumerId(), prod);

      expect(() => { registry.release(generateConnectionId(), generateConsumerId()); }).not.toThrow();
      expect(() => { registry.release(conn.id, generateConsumerId()); }).not.toThrow();
      expect(conn.consumers.size).toBe(1);
    });
  });

  describe("lifecycle$ events", () => {
    it("emits detached and closed, with the reason, when the last consumer leaves", async () => {
      const c1 = generateConsumerId();
      const conn = await registry.open("node-a", "deployments", "list", c1, prod);
      const events: { type: string; reason?: string }[] = [];
      const sub = registry.lifecycle$.subscribe((evt) => events.push(evt));

      registry.release(conn.id, c1);
      await settle();
      sub.unsubscribe();

      expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["consumer_detached", "connection_closed"]));
      expect(events.find((e) => e.type === "connection_closed")?.reason).toBe("empty");
    });

    it("describes the connection on opened and the new count on attached", async () => {
      const events: Record<string, unknown>[] = [];
      const sub = registry.lifecycle$.subscribe((evt) => events.push(evt));

      const conn = await registry.open("node-a", "deployments", "list", generateConsumerId(), prod);
      await settle();
      await registry.attach(conn.id, generateConsumerId(), prod);
      sub.unsubscribe();

      expect(events.find((e) => e.type === "connection_opened")).toMatchObject({
        nodeId: "node-a",
        entityKey: "deployments",
      });
      expect(events.find((e) => e.type === "consumer_attached")).toMatchObject({ consumerCount: 2 });
    });
  });
});
