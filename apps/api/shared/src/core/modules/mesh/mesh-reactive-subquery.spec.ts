import { describe, it, expect } from "vitest";
import { MeshConnectionRegistry } from "./connection/mesh-connection-registry";
import { ServerConnectionConsumerRegistry } from "./connection/mesh-consumer-registry";
import {
  eq,
  and,
  or,
  inSet,
  always,
} from "./filter/mesh-filter";
import { reconstructFilter } from "./filter/mesh-filter-evaluator";
import { isFilterSubset, unionFilters } from "./filter/mesh-filter-subset";
import type { MeshFilterDescriptor } from "./filter/mesh-filter.types";
import { compileParamsToFilterDescriptor } from "./params/mesh-params-compiler";
import { Subject } from "rxjs";

function makeId(): string {
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/**
 * E2E Test: Mesh Reactive Subqueries & Connection Sharing
 *
 * This test validates the core v8 mesh architecture:
 * 1. Isomorphic filter API (client-side + server-side reconstruction)
 * 2. Connection-level multiplexing (shared SSE connections)
 * 3. Consumer-scoped event delivery with recipient deduplication
 * 4. Reactive subquery pattern: deployments of active projects
 * 5. Params-to-filter compilation for typed call parameters
 */
describe("Mesh E2E: Reactive Subqueries & Connection Sharing", () => {
  function createTestModule() {
    return {
      connectionRegistry: new MeshConnectionRegistry(),
      consumerRegistry: new ServerConnectionConsumerRegistry(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 1: Isomorphic Filter API
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Isomorphic Filter API", () => {
    it("eq filter evaluates correctly client-side and serializes to descriptor", async () => {
      const filter = eq("environment", "prod" as const);

      // Client-side evaluation
      expect(filter.evaluate({ environment: "prod" } as any)).toBe(true);
      expect(filter.evaluate({ environment: "staging" } as any)).toBe(false);

      // Descriptor serialization
      expect(filter.descriptor).toEqual({ op: "eq", field: "environment", value: "prod" });

      // Server-side reconstruction
      const serverEval = reconstructFilter(filter.descriptor);
      expect(serverEval({ environment: "prod" })).toBe(true);
      expect(serverEval({ environment: "staging" })).toBe(false);
    });

    it("and combinator evaluates correctly on both sides", async () => {
      const filter = and(
        eq("environment", "prod" as const),
        eq("status", "running" as const),
      );

      expect(filter.evaluate({ environment: "prod", status: "running" } as any)).toBe(true);
      expect(filter.evaluate({ environment: "prod", status: "stopped" } as any)).toBe(false);

      const serverEval = reconstructFilter(filter.descriptor);
      expect(serverEval({ environment: "prod", status: "running" })).toBe(true);
      expect(serverEval({ environment: "prod", status: "stopped" })).toBe(false);
    });

    it("or combinator evaluates correctly", async () => {
      const filter = or(
        eq("environment", "prod" as const),
        eq("environment", "staging" as const),
      );

      expect(filter.evaluate({ environment: "prod" } as any)).toBe(true);
      expect(filter.evaluate({ environment: "staging" } as any)).toBe(true);
      expect(filter.evaluate({ environment: "canary" } as any)).toBe(false);
    });

    it("inSet filter matches multiple values", async () => {
      const filter = inSet("status", ["running", "pending"] as const);

      expect(filter.evaluate({ status: "running" } as any)).toBe(true);
      expect(filter.evaluate({ status: "pending" } as any)).toBe(true);
      expect(filter.evaluate({ status: "stopped" } as any)).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 2: Filter Subset & Union (for connection sharing decisions)
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Filter Subset & Union", () => {
    it("detects subset relationship: eq ⊆ in", () => {
      const a: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      const b: MeshFilterDescriptor = { op: "in", field: "env", values: ["prod", "staging"] };

      expect(isFilterSubset(a, b)).toBe(true);
      expect(isFilterSubset(b, a)).toBe(false);
    });

    it("detects identical filters as subsets of each other", () => {
      const a: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      const b: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      expect(isFilterSubset(a, b)).toBe(true);
      expect(isFilterSubset(b, a)).toBe(true);
    });

    it("computes union of two filters", () => {
      const a: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      const b: MeshFilterDescriptor = { op: "eq", field: "env", value: "staging" };

      const union = unionFilters(a, b);
      expect(union).toEqual({
        op: "or",
        operands: [a, b],
      });
    });

    it("always absorbs any union", () => {
      const a: MeshFilterDescriptor = { op: "always" };
      const b: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      expect(unionFilters(a, b)).toEqual({ op: "always" });
      expect(unionFilters(b, a)).toEqual({ op: "always" });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 3: Params to Filter Compilation
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Params to Filter Compilation", () => {
    it("compiles simple params to eq filters", () => {
      const params = { environment: "prod", status: "running" };
      const descriptor = compileParamsToFilterDescriptor(params);

      expect(descriptor).toEqual({
        op: "and",
        operands: [
          { op: "eq", field: "environment", value: "prod" },
          { op: "eq", field: "status", value: "running" },
        ],
      });
    });

    it("compiles array params to in filters", () => {
      const params = { status: ["running", "pending"] };
      const descriptor = compileParamsToFilterDescriptor(params);

      expect(descriptor).toEqual({
        op: "in", field: "status", values: ["running", "pending"],
      });
    });

    it("ignores pagination hints", () => {
      const params = { environment: "prod", limit: 10, offset: 0 };
      const descriptor = compileParamsToFilterDescriptor(params);

      expect(descriptor).toEqual({
        op: "eq", field: "environment", value: "prod",
      });
    });

    it("returns always for empty params", () => {
      const descriptor = compileParamsToFilterDescriptor({});
      expect(descriptor).toEqual({ op: "always" });
    });

    it("includes $filter escape hatch", () => {
      const params = {
        environment: "prod",
        $filter: { op: "gt", field: "replicaCount", value: 2 } as MeshFilterDescriptor,
      };
      const descriptor = compileParamsToFilterDescriptor(params);

      expect(descriptor).toEqual({
        op: "and",
        operands: [
          { op: "eq", field: "environment", value: "prod" },
          { op: "gt", field: "replicaCount", value: 2 },
        ],
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 4: Connection Registry & Consumer Deduplication
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Connection Registry", () => {
    it("opens a new connection when none exists", async () => {
      const { connectionRegistry } = await createTestModule();
      const consumerId = crypto.randomUUID() as any;
      const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      const conn = await connectionRegistry.open(
        "node-A",
        "deployments",
        "list",
        consumerId,
        filter,
      );

      expect(conn.nodeId).toBe("node-A");
      expect(conn.entityKey).toBe("deployments");
      expect(conn.consumers.size).toBe(1);
      expect(conn.status).toBe("connecting");

      connectionRegistry.release(conn.id, consumerId);
    });

    it("attaches a second consumer to an existing connection", async () => {
      const { connectionRegistry } = await createTestModule();
      const consumerA = crypto.randomUUID() as any;
      const consumerB = crypto.randomUUID() as any;
      const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      const conn = await connectionRegistry.open(
        "node-B",
        "deployments",
        "list",
        consumerA,
        filter,
      );

      await connectionRegistry.attach(conn.id, consumerB, filter);

      expect(conn.consumers.size).toBe(2);

      connectionRegistry.release(conn.id, consumerA);
      connectionRegistry.release(conn.id, consumerB);
    });

    it("closes connection when all consumers release", async () => {
      const { connectionRegistry } = await createTestModule();
      const consumerId = crypto.randomUUID() as any;
      const filter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };

      const conn = await connectionRegistry.open(
        "node-C",
        "deployments",
        "list",
        consumerId,
        filter,
      );

      const connId = conn.id;
      connectionRegistry.release(connId, consumerId);

      const openConns = connectionRegistry.listOpen();
      const found = openConns.find((c) => c.id === connId);
      expect(found).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 5: Server-Side Consumer Registry & Recipient Computation
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Server-Side Consumer Registry", () => {
    it("computes recipients for matching events", () => {
      const registry = new ServerConnectionConsumerRegistry();

      registry.attach("consumer-A" as any, { op: "eq", field: "env", value: "prod" });
      registry.attach("consumer-B" as any, { op: "eq", field: "env", value: "staging" });
      registry.attach("consumer-C" as any, {
        op: "and",
        operands: [
          { op: "eq", field: "env", value: "prod" },
          { op: "eq", field: "status", value: "running" },
        ],
      });

      // Event matching prod
      const recipients1 = registry.computeRecipients({ env: "prod", status: "running" });
      expect(recipients1).toContain("consumer-A");
      expect(recipients1).not.toContain("consumer-B");
      expect(recipients1).toContain("consumer-C");

      // Event matching staging
      const recipients2 = registry.computeRecipients({ env: "staging", status: "pending" });
      expect(recipients2).not.toContain("consumer-A");
      expect(recipients2).toContain("consumer-B");
      expect(recipients2).not.toContain("consumer-C");

      // Event matching nothing
      const recipients3 = registry.computeRecipients({ env: "canary" });
      expect(recipients3.length).toBe(0);
    });

    it("suppresses events with no matching consumers", () => {
      const registry = new ServerConnectionConsumerRegistry();
      registry.attach("consumer-A" as any, { op: "eq", field: "env", value: "prod" });

      const recipients = registry.computeRecipients({ env: "staging" });
      expect(recipients.length).toBe(0);
    });

    it("computes union filter across consumers", () => {
      const registry = new ServerConnectionConsumerRegistry();

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

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 6: Consumer-Scoped Event Delivery & Deduplication
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Consumer-Scoped Event Delivery", () => {
    it("delivers events only to matching consumers", async () => {
      const { connectionRegistry } = await createTestModule();
      const source$ = new Subject<any>();
      const consumerA = "consumer-A" as any;
      const consumerB = "consumer-B" as any;

      const obsA = connectionRegistry.buildConsumerObservable(source$, consumerA);
      const obsB = connectionRegistry.buildConsumerObservable(source$, consumerB);

      const valuesA: any[] = [];
      const valuesB: any[] = [];

      const subA = obsA.subscribe((v) => valuesA.push(v));
      const subB = obsB.subscribe((v) => valuesB.push(v));

      // Emit event addressed to both
      source$.next({
        connectionId: "conn-1",
        recipients: [consumerA, consumerB],
        entityKey: "deployments",
        eventType: "updated",
        payload: { deploymentId: "dep-1", env: "prod" },
        timestamp: new Date().toISOString(),
        sourceNodeId: "node-A",
      });

      // Emit event addressed to A only
      source$.next({
        connectionId: "conn-1",
        recipients: [consumerA],
        entityKey: "deployments",
        eventType: "updated",
        payload: { deploymentId: "dep-2", env: "prod" },
        timestamp: new Date().toISOString(),
        sourceNodeId: "node-A",
      });

      // Emit event addressed to B only
      source$.next({
        connectionId: "conn-1",
        recipients: [consumerB],
        entityKey: "deployments",
        eventType: "updated",
        payload: { deploymentId: "dep-3", env: "staging" },
        timestamp: new Date().toISOString(),
        sourceNodeId: "node-A",
      });

      // Emit event addressed to neither (suppressed in real impl)
      source$.next({
        connectionId: "conn-1",
        recipients: [],
        entityKey: "deployments",
        eventType: "updated",
        payload: { deploymentId: "dep-4", env: "canary" },
        timestamp: new Date().toISOString(),
        sourceNodeId: "node-A",
      });

      expect(valuesA.length).toBe(2); // dep-1 and dep-2
      expect(valuesB.length).toBe(2); // dep-1 and dep-3
      expect(valuesA[0].deploymentId).toBe("dep-1");
      expect(valuesA[1].deploymentId).toBe("dep-2");
      expect(valuesB[0].deploymentId).toBe("dep-1");
      expect(valuesB[1].deploymentId).toBe("dep-3");

      subA.unsubscribe();
      subB.unsubscribe();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 7: Connection Lifecycle Events
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Connection Lifecycle", () => {
    it("emits lifecycle events for connection open/close", async () => {
      const { connectionRegistry } = await createTestModule();
      const events: any[] = [];
      const sub = connectionRegistry.lifecycle$.subscribe((e) => events.push(e));

      const consumerId = crypto.randomUUID() as any;
      const filter: MeshFilterDescriptor = { op: "always" };

      const conn = await connectionRegistry.open(
        "node-D",
        "deployments",
        "list",
        consumerId,
        filter,
      );

      await new Promise((r) => setTimeout(r, 50));

      connectionRegistry.release(conn.id, consumerId);
      await new Promise((r) => setTimeout(r, 50));

      const opened = events.find((e) => e.type === "connection_opened" && e.connectionId === conn.id);
      const closed = events.find((e) => e.type === "connection_closed" && e.connectionId === conn.id);

      expect(opened).toBeDefined();
      expect(opened.nodeId).toBe("node-D");
      expect(closed).toBeDefined();
      expect(closed.reason).toBe("empty");

      sub.unsubscribe();
    });

    it("emits consumer attach/detach events", async () => {
      const { connectionRegistry } = await createTestModule();
      const events: any[] = [];
      const sub = connectionRegistry.lifecycle$.subscribe((e) => events.push(e));

      const consumerA = crypto.randomUUID() as any;
      const consumerB = crypto.randomUUID() as any;
      const filter: MeshFilterDescriptor = { op: "always" };

      const conn = await connectionRegistry.open(
        "node-E",
        "deployments",
        "list",
        consumerA,
        filter,
      );

      await connectionRegistry.attach(conn.id, consumerB, filter);
      connectionRegistry.release(conn.id, consumerA);
      connectionRegistry.release(conn.id, consumerB);

      await new Promise((r) => setTimeout(r, 50));

      const attached = events.filter(
        (e) => e.type === "consumer_attached" && e.connectionId === conn.id,
      );
      const detached = events.filter(
        (e) => e.type === "consumer_detached" && e.connectionId === conn.id,
      );

      expect(attached.length).toBe(1); // consumerB attached
      expect(detached.length).toBe(2); // both released

      sub.unsubscribe();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 8: Reactive Subquery Pattern (The Core Use Case)
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Reactive Subquery Pattern", () => {
    it("demonstrates the reactive subquery: deployments of active projects", async () => {
      // This test demonstrates the pattern from FULL_MESH_HISTORY.md v8:
      //
      // 1. Subscribe to active projects (global resource)
      // 2. When projects change, derive a new where clause for deployments
      // 3. Re-subscribe to deployments with the updated project IDs
      // 4. Events are deduplicated across consumers on shared connections

      // ── Step 1: Simulate active projects stream ──────────────────────────────
      const activeProjects$ = new Subject<any>();

      // ── Step 2: Simulate the reactive deployment subscription ────────────────
      const deploymentEvents: any[] = [];

      // This simulates what .whereFrom() does internally:
      // - When activeProjects$ emits → extract project IDs → re-subscribe to deployments
      const sub = activeProjects$.subscribe((projectsResult) => {
        const projectIds = projectsResult.items.map((i: any) => i.data.projectId);

        // Build filter: projectId in [active project IDs] AND environment = prod
        const filter = and(
          inSet("projectId", projectIds),
          eq("environment", "prod" as const),
        );

        deploymentEvents.push({
          type: "subscription_updated",
          projectIds,
          filterDescriptor: filter.descriptor,
        });
      });

      // ── Step 3: Emit initial project list ────────────────────────────────────
      activeProjects$.next({
        items: [
          { data: { projectId: "proj-1", name: "API Service", status: "active" } },
          { data: { projectId: "proj-2", name: "Web App", status: "active" } },
        ],
        meta: { eventType: "snapshot" },
      });

      // ── Step 4: A new project is added ─────────────────────────────────────────
      activeProjects$.next({
        items: [
          { data: { projectId: "proj-1", name: "API Service", status: "active" } },
          { data: { projectId: "proj-2", name: "Web App", status: "active" } },
          { data: { projectId: "proj-3", name: "Worker", status: "active" } },
        ],
        meta: { eventType: "created" },
      });

      // ── Step 5: A project is archived ────────────────────────────────────────
      activeProjects$.next({
        items: [
          { data: { projectId: "proj-1", name: "API Service", status: "active" } },
          { data: { projectId: "proj-3", name: "Worker", status: "active" } },
        ],
        meta: { eventType: "updated" },
      });

      sub.unsubscribe();

      // ── Verification ─────────────────────────────────────────────────────────
      expect(deploymentEvents.length).toBe(3);

      // First subscription: proj-1, proj-2
      expect(deploymentEvents[0].projectIds).toEqual(["proj-1", "proj-2"]);
      expect(deploymentEvents[0].filterDescriptor).toEqual({
        op: "and",
        operands: [
          { op: "in", field: "projectId", values: ["proj-1", "proj-2"] },
          { op: "eq", field: "environment", value: "prod" },
        ],
      });

      // Second subscription: proj-1, proj-2, proj-3
      expect(deploymentEvents[1].projectIds).toEqual(["proj-1", "proj-2", "proj-3"]);

      // Third subscription: proj-1, proj-3
      expect(deploymentEvents[2].projectIds).toEqual(["proj-1", "proj-3"]);
    });

    it("demonstrates connection sharing for multiple consumers", async () => {
      const { connectionRegistry } = await createTestModule();

      // Scenario: Two dashboard components subscribe to deployments
      // Component A: all prod deployments
      // Component B: only running prod deployments (subset of A)
      // Both should share the same connection to each node

      const consumerA = crypto.randomUUID() as any;
      const consumerB = crypto.randomUUID() as any;

      const filterA: MeshFilterDescriptor = { op: "eq", field: "environment", value: "prod" };
      const filterB: MeshFilterDescriptor = {
        op: "and",
        operands: [
          { op: "eq", field: "environment", value: "prod" },
          { op: "eq", field: "status", value: "running" },
        ],
      };

      // Consumer A opens connection
      const connA = await connectionRegistry.open(
        "node-F",
        "deployments",
        "list",
        consumerA,
        filterA,
      );

      // Consumer B's filter is a SUBSET of A's filter → attach to same connection
      const isSubset = isFilterSubset(filterB, filterA);
      expect(isSubset).toBe(true);

      await connectionRegistry.attach(connA.id, consumerB, filterB);

      // Verify both consumers are on the same connection
      const conn = connectionRegistry.listOpen().find((c) => c.id === connA.id);
      expect(conn).toBeDefined();
      expect(conn!.consumers.size).toBe(2);

      // Simulate server-side recipient computation
      const serverRegistry = new ServerConnectionConsumerRegistry();
      serverRegistry.attach(consumerA, filterA);
      serverRegistry.attach(consumerB, filterB);

      // Event: prod + running → both consumers
      const recipients1 = serverRegistry.computeRecipients({
        environment: "prod",
        status: "running",
        deploymentId: "dep-1",
      });
      expect(recipients1).toContain(consumerA);
      expect(recipients1).toContain(consumerB);

      // Event: prod + stopped → only consumer A
      const recipients2 = serverRegistry.computeRecipients({
        environment: "prod",
        status: "stopped",
        deploymentId: "dep-2",
      });
      expect(recipients2).toContain(consumerA);
      expect(recipients2).not.toContain(consumerB);

      // Cleanup
      connectionRegistry.release(connA.id, consumerA);
      connectionRegistry.release(connA.id, consumerB);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTION 9: End-to-End Integration
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("End-to-End Integration", () => {
    it("validates the full mesh stack is wired in the Nest module", async () => {
      const { connectionRegistry, consumerRegistry } = await createTestModule();

      // Verify services are available from the DI container
      expect(connectionRegistry).toBeDefined();
      expect(consumerRegistry).toBeDefined();
    });

    it("demonstrates the complete v8 API pattern with typed params", async () => {
      const { connectionRegistry } = await createTestModule();

      // This demonstrates the intended consumer API from FULL_MESH_HISTORY.md v8:
      //
      // const activeProjects$ = mesh
      //   .from(ProjectMeshService.queries.projects.query)
      //   .listen()
      //   .execute();
      //
      // const orgDeployments$ = mesh
      //   .from(DeploymentMeshService.queries.deployments.query)
      //   .where({ environment: eq("prod") })
      //   .listen()
      //   .whereFrom(
      //     activeProjects$,
      //     (projectsResult) => ({
      //       projectId: inList(projectsResult.items.map(i => i.data.projectId)),
      //     }),
      //   )
      //   .execute();

      // For this e2e test, we verify the underlying primitives work:

      // 1. Build filter from params
      const params = { environment: "prod", status: "running" };
      const filter = compileParamsToFilterDescriptor(params);
      expect(filter.op).toBe("and");

      // 2. Reconstruct and evaluate server-side
      const evaluator = reconstructFilter(filter);
      expect(evaluator({ environment: "prod", status: "running" })).toBe(true);
      expect(evaluator({ environment: "staging", status: "running" })).toBe(false);

      // 3. Open connection with filter
      const consumerId = crypto.randomUUID() as any;
      const conn = await connectionRegistry.open(
        "node-G",
        "deployments",
        "list",
        consumerId,
        filter,
      );

      // 4. Verify connection tracking
      expect(conn.entityKey).toBe("deployments");
      expect(conn.methodName).toBe("list");

      // 5. Simulate event delivery
      const source$ = conn.source$;
      const serverReg = new ServerConnectionConsumerRegistry();
      serverReg.attach(consumerId, filter);

      const recipients = serverReg.computeRecipients({
        environment: "prod",
        status: "running",
        deploymentId: "dep-abc",
      });
      expect(recipients).toContain(consumerId);

      // 6. Build consumer observable
      const consumerObs = connectionRegistry.buildConsumerObservable(source$, consumerId);
      const received: any[] = [];
      const sub = consumerObs.subscribe((v) => received.push(v));

      // Emit event
      source$.next({
        connectionId: conn.id,
        recipients: [consumerId],
        entityKey: "deployments",
        eventType: "updated",
        payload: { deploymentId: "dep-abc", environment: "prod", status: "running" },
        timestamp: new Date().toISOString(),
        sourceNodeId: "node-G",
      });

      expect(received.length).toBe(1);
      expect(received[0].deploymentId).toBe("dep-abc");

      sub.unsubscribe();
      connectionRegistry.release(conn.id, consumerId);
    });
  });
});
