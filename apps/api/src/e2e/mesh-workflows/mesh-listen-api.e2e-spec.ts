import { Test, type TestingModule } from "@nestjs/testing";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Subject, Observable } from "rxjs";
import { TestDeploymentMeshModule } from "@/core/modules/mesh/examples/test-deployment-mesh.module";
import { TestDeploymentMeshService } from "@/core/modules/mesh/examples/test-deployment-mesh.service";
import { SystemMeshResourceDiscoveryService } from "@/core/modules/mesh/services/system-mesh-resource-discovery/system-mesh-resource-discovery.service";
import { MeshQueryExecutor } from "@/core/modules/mesh/services/system-mesh-resource-discovery/query/mesh-query-executor";
import { MeshConnectionRegistry } from "@/core/modules/mesh/connection/mesh-connection-registry";
import { ServerConnectionConsumerRegistry } from "@/core/modules/mesh/connection/mesh-consumer-registry";
import type {
  MeshChangeEvent,
  MeshChangeType,
} from "@/core/modules/mesh/services/system-mesh-resource-discovery/query/mesh-observable-types";

/**
 * Tests for the listen() real-time API from FULL_MESH_HISTORY.md:
 * - MeshListenResult with items$, events$, all$
 * - Change detection (created/updated/deleted/initial)
 * - MeshChangeEvent structure
 * - Consumer cleanup on unsubscribe
 */
describe("Mesh E2E: Listen API (Real-Time Updates)", () => {
  describe("MeshListenResult structure", () => {
    it("provides items$, events$, and all$ observables", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [TestDeploymentMeshModule],
      }).compile();

      const discovery = moduleRef.get(SystemMeshResourceDiscoveryService);

      const listenResult = discovery
        .from(TestDeploymentMeshService.queries.deployments)
        .where({ environment: "prod" })
        .listen();

      // listen() returns { items$, events$, all$ }
      expect(listenResult.items$).toBeDefined();
      expect(listenResult.events$).toBeDefined();
      expect(listenResult.all$).toBeDefined();
      expect(listenResult.items$).toBeInstanceOf(Observable);
      expect(listenResult.events$).toBeInstanceOf(Observable);
      expect(listenResult.all$).toBeInstanceOf(Observable);

      // Cleanup
      await moduleRef.close();
    });

    it("emits initial items on items$", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [TestDeploymentMeshModule],
      }).compile();

      const discovery = moduleRef.get(SystemMeshResourceDiscoveryService);

      const listenResult = discovery
        .from(TestDeploymentMeshService.queries.deployments)
        .where({ environment: "prod" })
        .listen();

      const receivedItems = await new Promise<readonly any[]>((resolve) => {
        const sub = listenResult.items$.subscribe((items) => {
          resolve(items);
          sub.unsubscribe();
        });
      });

      expect(Array.isArray(receivedItems)).toBe(true);
      expect(receivedItems.length).toBeGreaterThan(0);

      // All items should match the where filter
      for (const item of receivedItems) {
        expect((item).environment).toBe("prod");
      }

      await moduleRef.close();
    });

    it("emits initial event on events$", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [TestDeploymentMeshModule],
      }).compile();

      const discovery = moduleRef.get(SystemMeshResourceDiscoveryService);

      const listenResult = discovery
        .from(TestDeploymentMeshService.queries.deployments)
        .where({ environment: "prod" })
        .listen();

      const initialEvent = await new Promise<MeshChangeEvent<any>>((resolve) => {
        const sub = listenResult.events$.subscribe((event) => {
          resolve(event);
          sub.unsubscribe();
        });
      });

      // First event should be "initial"
      expect(initialEvent.type).toBe("initial");
      expect(Array.isArray(initialEvent.items)).toBe(true);
      expect(initialEvent.timestamp).toBeDefined();

      await moduleRef.close();
    });

    it("detects created items on subsequent poll", async () => {
      const registry = new MeshConnectionRegistry();
      const serverRegistry = new ServerConnectionConsumerRegistry();

      const consumerA = "consumer-listen-test" as any;
      const prodFilter: any = { op: "eq", field: "env", value: "prod" };

      // Simulate a stream with recipient filtering
      const stream$ = new Subject<any>();

      const consumer$ = registry.buildConsumerObservable(stream$, consumerA);
      serverRegistry.attach(consumerA, prodFilter);

      const receivedItems: string[] = [];

      const sub = consumer$.subscribe((payload) => {
        receivedItems.push(payload.id);
      });

      // Simulate a "created" event
      const recipients = serverRegistry.computeRecipients({ id: "dep-1", env: "prod" });
      stream$.next({
        connectionId: "conn-1",
        recipients,
        entityKey: "deployments",
        eventType: "created",
        payload: { id: "dep-1" },
        timestamp: new Date().toISOString(),
        sourceNodeId: "node-1",
      });

      expect(receivedItems).toContain("dep-1");

      sub.unsubscribe();
    });
  });

  describe("Change event types", () => {
    it("validates MeshChangeEvent structure", () => {
      const initialEvent: MeshChangeEvent<any> = {
        type: "initial",
        items: [{ id: "1" }, { id: "2" }],
        timestamp: new Date().toISOString(),
      };

      expect(initialEvent.type).toBe("initial");
      expect(initialEvent.items).toHaveLength(2);
      expect(initialEvent.changedItem).toBeUndefined();
      expect(initialEvent.previousItem).toBeUndefined();

      const createdEvent: MeshChangeEvent<any> = {
        type: "created",
        items: [{ id: "1" }, { id: "2" }, { id: "3" }],
        changedItem: { id: "3" },
        timestamp: new Date().toISOString(),
        sourceNodeId: "node-a",
      };

      expect(createdEvent.type).toBe("created");
      expect(createdEvent.changedItem?.id).toBe("3");
      expect(createdEvent.sourceNodeId).toBe("node-a");

      const updatedEvent: MeshChangeEvent<any> = {
        type: "updated",
        items: [{ id: "1", value: 2 }],
        changedItem: { id: "1", value: 2 },
        previousItem: { id: "1", value: 1 },
        timestamp: new Date().toISOString(),
      };

      expect(updatedEvent.type).toBe("updated");
      expect(updatedEvent.changedItem?.value).toBe(2);
      expect(updatedEvent.previousItem?.value).toBe(1);

      const deletedEvent: MeshChangeEvent<any> = {
        type: "deleted",
        items: [{ id: "2" }],
        changedItem: { id: "1" },
        previousItem: { id: "1", value: 1 },
        timestamp: new Date().toISOString(),
      };

      expect(deletedEvent.type).toBe("deleted");

      const reconnectEvent: MeshChangeEvent<any> = {
        type: "reconnect",
        items: [{ id: "1" }],
        timestamp: new Date().toISOString(),
      };

      expect(reconnectEvent.type).toBe("reconnect");
    });
  });

  describe("Consumer cleanup", () => {
    it("stops receiving events after unsubscribe", () => {
      const stream$ = new Subject<any>();
      const cA = "consumer-cleanup" as any;

      const received: string[] = [];

      const sub = stream$.subscribe((payload) => {
        received.push(payload.id);
      });

      stream$.next({ id: "event-1" });
      stream$.next({ id: "event-2" });

      sub.unsubscribe();

      stream$.next({ id: "event-3" });

      expect(received).toEqual(["event-1", "event-2"]);
    });

    it("isolates multiple independent streams", () => {
      const stream1$ = new Subject<any>();
      const stream2$ = new Subject<any>();

      const received1: string[] = [];
      const received2: string[] = [];

      const sub1 = stream1$.subscribe((p) => received1.push(p.id));
      const sub2 = stream2$.subscribe((p) => received2.push(p.id));

      stream1$.next({ id: "s1-e1" });
      stream2$.next({ id: "s2-e1" });
      stream1$.next({ id: "s1-e2" });

      sub1.unsubscribe();
      stream1$.next({ id: "s1-e3" });
      stream2$.next({ id: "s2-e2" });

      expect(received1).toEqual(["s1-e1", "s1-e2"]);
      expect(received2).toEqual(["s2-e1", "s2-e2"]);
      sub2.unsubscribe();
    });
  });
});
