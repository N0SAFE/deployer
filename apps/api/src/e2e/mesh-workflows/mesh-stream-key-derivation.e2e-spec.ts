import { describe, it, expect } from "vitest";
import { MeshConnectionRegistry } from "@/core/modules/mesh/connection/mesh-connection-registry";
import { MeshSubscriptionManager } from "@/core/modules/mesh/services/system-mesh-resource-discovery/subscription/mesh-subscription-manager";

/**
 * Tests for stream key derivation and identity concepts from FULL_MESH_HISTORY.md:
 * - Stream keys uniquely identify logical event channels via namespace:entity:source:filters
 * - MeshConnectionRegistry lookup uses nodeId+entityKey+methodName as composite key
 * - Shared stream reuse when keys match
 * - Stream isolation when keys differ
 */
describe("Mesh E2E: Stream Key Derivation & Identity", () => {
  describe("MeshConnectionRegistry as stream key store", () => {
    it("computes composite identity from nodeId+entityKey+methodName", async () => {
      const registry = new MeshConnectionRegistry();

      const c1 = "consumer-1" as any;
      const filter = { op: "eq", field: "env", value: "prod" } as any;

      // Open streams to different entity keys
      const deploymentsConn = await registry.open("node-a", "deployments", "list", c1, filter);
      const servicesConn = await registry.open("node-a", "services", "list", c1, filter);

      // Each has a unique composite key
      expect(deploymentsConn.id).not.toBe(servicesConn.id);

      // Lookup by composite key returns correct stream
      const foundDeployments = registry.lookup("node-a", "deployments", "list");
      expect(foundDeployments?.id).toBe(deploymentsConn.id);

      const foundServices = registry.lookup("node-a", "services", "list");
      expect(foundServices?.id).toBe(servicesConn.id);

      // Non-existent composite key returns null
      const notFound = registry.lookup("node-b", "deployments", "list");
      expect(notFound).toBeNull();
    });

    it("isolates streams by nodeId (same entity, different nodes)", async () => {
      const registry = new MeshConnectionRegistry();

      const c1 = "consumer-1" as any;
      const filter = { op: "eq", field: "env", value: "prod" } as any;

      const nodeAConn = await registry.open("node-a", "deployments", "list", c1, filter);
      const nodeBConn = await registry.open("node-b", "deployments", "list", c1, filter);

      expect(nodeAConn.id).not.toBe(nodeBConn.id);

      // Each node lookup returns the correct connection
      expect(registry.lookup("node-a", "deployments", "list")?.id).toBe(nodeAConn.id);
      expect(registry.lookup("node-b", "deployments", "list")?.id).toBe(nodeBConn.id);
    });

    it("isolates streams by methodName (same node+entity, different methods)", async () => {
      const registry = new MeshConnectionRegistry();

      const c1 = "consumer-1" as any;
      const filter = { op: "eq", field: "env", value: "prod" } as any;

      const listConn = await registry.open("node-a", "deployments", "list", c1, filter);
      const streamConn = await registry.open("node-a", "deployments", "stream", c1, filter);

      expect(listConn.id).not.toBe(streamConn.id);
      expect(registry.lookup("node-a", "deployments", "list")?.id).toBe(listConn.id);
      expect(registry.lookup("node-a", "deployments", "stream")?.id).toBe(streamConn.id);
    });

    it("reuses same stream for identical composite key", async () => {
      const registry = new MeshConnectionRegistry();

      const c1 = "consumer-1" as any;
      const c2 = "consumer-2" as any;
      const filter = { op: "eq", field: "env", value: "prod" } as any;

      const conn = await registry.open("node-a", "deployments", "list", c1, filter);
      await registry.attach(conn.id, c2, filter);

      // Should be the same connection (single stream entry)
      const openConnections = registry.listOpen();
      const deploymentConns = openConnections.filter(
        (c) => c.nodeId === "node-a" && c.entityKey === "deployments"
      );
      expect(deploymentConns).toHaveLength(1);
      expect(deploymentConns[0]?.consumers.size).toBe(2);
    });
  });

  describe("filter-aware stream identity (subset/superset decisions)", () => {
    it("decides to attach when incoming filter is subset of existing", async () => {
      const registry = new MeshConnectionRegistry();

      const c1 = "consumer-1" as any;
      const broad: any = { op: "in", field: "env", values: ["prod", "staging"] };
      const narrow: any = { op: "eq", field: "env", value: "prod" };

      const conn = await registry.open("node-a", "deployments", "list", c1, broad);
      const decision = registry.decidePromotion(narrow, [conn]);

      expect(decision.action).toBe("attach");
      if (decision.action === "attach") {
        expect(decision.connectionId).toBe(conn.id);
      }
    });

    it("decides to promote when incoming filter is superset of existing", async () => {
      const registry = new MeshConnectionRegistry();

      const c1 = "consumer-1" as any;
      const narrow: any = { op: "eq", field: "env", value: "prod" };
      const broad: any = { op: "in", field: "env", values: ["prod", "staging"] };

      const conn = await registry.open("node-a", "deployments", "list", c1, narrow);
      const decision = registry.decidePromotion(broad, [conn]);

      expect(decision.action).toBe("promote");
      if (decision.action === "promote") {
        expect(decision.connectionId).toBe(conn.id);
        expect(decision.newFilter).toEqual(broad);
      }
    });

    it("decides new when filter has no overlap with existing", async () => {
      const registry = new MeshConnectionRegistry();

      const c1 = "consumer-1" as any;
      const prodFilter: any = { op: "eq", field: "env", value: "prod" };
      const stagingFilter: any = { op: "eq", field: "env", value: "staging" };

      const conn = await registry.open("node-a", "deployments", "list", c1, prodFilter);
      const decision = registry.decidePromotion(stagingFilter, [conn]);

      // Non-overlapping eq on same field — currently opens new
      expect(decision.action).toBe("new");
    });
  });

  describe("MeshSubscriptionManager as global notifier registry", () => {
    it("registers global resource notifiers keyed by entityKey", () => {
      const mgr = new MeshSubscriptionManager();

      type Item = { id: string };
      const itemSchema = null as any;

      const notifier1 = mgr.registerGlobalResource("test:projects", itemSchema);
      const notifier2 = mgr.registerGlobalResource("test:users", itemSchema);

      // Same key returns existing notifier (idempotent)
      const notifier1again = mgr.registerGlobalResource("test:projects", itemSchema);
      expect(notifier1again).toBe(notifier1);

      // Different keys are isolated
      expect(notifier2).not.toBe(notifier1);
    });

    it("routes subscription events only to subscribers of the same entityKey", async () => {
      const mgr = new MeshSubscriptionManager();

      type Item = { id: string; value: number };
      const itemSchema = null as any;

      const projectsNotifier = mgr.registerGlobalResource<Item>("projects", itemSchema);
      const usersNotifier = mgr.registerGlobalResource<Item>("users", itemSchema);

      const projectEvents: string[] = [];
      const userEvents: string[] = [];

      mgr.subscribe<Item>("projects", async (evt) => {
        projectEvents.push(`project:${evt.type}:${evt.item.id}`);
      });

      mgr.subscribe<Item>("users", async (evt) => {
        userEvents.push(`user:${evt.type}:${evt.item.id}`);
      });

      await projectsNotifier.notifyCreated({ id: "p1", value: 1 }, "node-a");
      await usersNotifier.notifyUpdated(
        { id: "u1", value: 5 },
        { id: "u1", value: 3 },
        "node-b"
      );

      await new Promise((r) => setTimeout(r, 10));

      // Project subscriber only gets project events
      expect(projectEvents).toContain("project:created:p1");
      expect(projectEvents).not.toContain("user:updated:u1");

      // User subscriber only gets user events
      expect(userEvents).toContain("user:updated:u1");
      expect(userEvents).not.toContain("project:created:p1");
    });
  });
});
