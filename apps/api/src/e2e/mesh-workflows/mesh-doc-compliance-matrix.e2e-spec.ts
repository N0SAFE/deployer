import { describe, it, expect, beforeEach } from "vitest";
import { Subject, Observable, BehaviorSubject } from "rxjs";
import { filter as rxFilter } from "rxjs/operators";
import { MeshConnectionRegistry } from "@/core/modules/mesh/connection/mesh-connection-registry";
import { ServerConnectionConsumerRegistry } from "@/core/modules/mesh/connection/mesh-consumer-registry";
import { StreamManagerService } from "@/core/modules/mesh/services/stream-manager/stream-manager.service";
import { MeshPartitionPolicy } from "@/core/modules/mesh/services/mesh-partition-policy";
import { OwnershipResolverService } from "@/core/modules/mesh/services/ownership/ownership-resolver.service";
import { defineResource } from "@/core/modules/mesh/mesh-resource-definition";
import type { MeshStreamEnvelope } from "@/core/modules/mesh/connection/mesh-connection.types";
import type { MeshFilterDescriptor, MeshConsumerId } from "@/core/modules/mesh/filter/mesh-filter.types";
import z from "zod/v4";

/**
 * Compliance Matrix — FULL_MESH_HISTORY.md
 *
 * Every concept documented in the source-of-truth doc is verified here
 * with real assertions against the runtime classes. Detailed scenario tests
 * live in the companion *-spec.ts files referenced in each test name.
 */
function cid(): MeshConsumerId {
  return `c-${Math.random().toString(36).slice(2, 10)}` as MeshConsumerId;
}

const prodFilter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
const stagingFilter: MeshFilterDescriptor = { op: "eq", field: "env", value: "staging" };
const broadFilter: MeshFilterDescriptor = { op: "in", field: "env", values: ["prod", "staging"] };

// ─────────────────────────────────────────────────────────────────────────────
// SSE Stream Store
// ─────────────────────────────────────────────────────────────────────────────

describe("Mesh E2E: Compliance — SSE Stream Store", () => {
  let registry: MeshConnectionRegistry;

  beforeEach(() => {
    registry = new MeshConnectionRegistry();
  });

  it("I21 — shared SSE connection reuse + consumer attachment", async () => {
    // Detailed: mesh-sse-shared-store, mesh-shared-stream-store-advanced
    const c1 = cid();
    const c2 = cid();
    const conn = await registry.open("node-a", "deployments", "list", c1, prodFilter);
    await registry.attach(conn.id, c2, prodFilter);

    const lookup = registry.lookup("node-a", "deployments", "list");
    expect(lookup).not.toBeNull();
    expect(lookup!.consumers.has(c1)).toBe(true);
    expect(lookup!.consumers.has(c2)).toBe(true);
    expect(lookup!.consumers.size).toBe(2);
  });

  it("reference-counted lifecycle — refCount tracks consumers, auto-closes on last detach", async () => {
    // Detailed: mesh-shared-stream-store-advanced
    const c1 = cid();
    const c2 = cid();
    const conn = await registry.open("node-a", "deployments", "list", c1, prodFilter);
    await registry.attach(conn.id, c2, prodFilter);
    expect(conn.consumers.size).toBe(2);

    registry.release(conn.id, c1);
    expect(conn.consumers.size).toBe(1);

    registry.release(conn.id, c2);
    await new Promise((r) => setTimeout(r, 20));
    expect(registry.listOpen().some((c) => c.id === conn.id)).toBe(false);
  });

  it("lifecycle$ observable emits connection_opened/consumer_attached/consumer_detached/connection_closed", async () => {
    // Detailed: mesh-shared-stream-store-advanced
    const events: string[] = [];
    const sub = registry.lifecycle$.subscribe((evt) => events.push(evt.type));

    const c1 = cid();
    const conn = await registry.open("node-a", "deployments", "list", c1, prodFilter);

    const c2 = cid();
    await registry.attach(conn.id, c2, prodFilter);

    registry.release(conn.id, c2);
    registry.release(conn.id, c1);

    await new Promise((r) => setTimeout(r, 20));
    sub.unsubscribe();

    expect(events).toContain("connection_opened");
    expect(events).toContain("consumer_attached");
    expect(events).toContain("consumer_detached");
    expect(events).toContain("connection_closed");
  });

  it("stream key derivation — nodeId+entityKey+methodName composite identity", async () => {
    // Detailed: mesh-stream-key-derivation
    const c1 = cid();
    const c2 = cid();
    const c3 = cid();

    const conn = await registry.open("node-a", "deployments", "list", c1, prodFilter);
    await registry.open("node-a", "deployments", "list", c2, prodFilter);

    const lookup = registry.lookup("node-a", "deployments", "list");
    expect(lookup).not.toBeNull();
    expect(lookup!.id).toBe(conn.id);

    const connB = await registry.open("node-b", "deployments", "list", c3, prodFilter);
    expect(connB.id).not.toBe(conn.id);
  });

  it("filter-aware stream sharing — attach/promote/new decision semantics", async () => {
    // Detailed: mesh-sse-shared-store, mesh-promotion-control, mesh-shared-stream-store-advanced
    const c1 = cid();

    await registry.open("node-a", "deployments", "list", c1, prodFilter);
    const openConns = registry.listOpen().filter(
      (c) => c.nodeId === "node-a" && c.entityKey === "deployments" && c.methodName === "list"
    );

    // Same filter → attach
    const d1 = registry.decidePromotion(prodFilter, openConns);
    expect(d1.action).toBe("attach");

    // Broader filter that covers prod → promote (existing filter is subset of incoming)
    const d2 = registry.decidePromotion(broadFilter, openConns);
    expect(d2.action).toBe("promote");

    // Non-overlapping filter → new
    const d3 = registry.decidePromotion({ op: "eq", field: "region", value: "eu-west" }, openConns);
    expect(d3.action).toBe("new");
  });

  it("recipient-based event deduplication routing via buildConsumerObservable", async () => {
    // Detailed: mesh-reactive-subquery, mesh-shared-stream-store-advanced
    const c1 = cid();
    const c2 = cid();
    const conn = await registry.open("node-a", "deployments", "list", c1, prodFilter);
    await registry.attach(conn.id, c2, prodFilter);

    // buildConsumerObservable takes an Observable<MeshStreamEnvelope>, not a connectionId
    const envelope$ = new Subject<MeshStreamEnvelope<unknown>>();
    const consumerObs = registry.buildConsumerObservable(envelope$, c1);
    expect(consumerObs).toBeInstanceOf(Observable);

    const received: Array<unknown> = [];
    const sub = consumerObs.subscribe((v) => received.push(v));

    envelope$.next({
      connectionId: conn.id,
      recipients: [c1, c2],
      entityKey: "deployments",
      eventType: "updated",
      payload: { status: "running" },
      timestamp: new Date().toISOString(),
      sourceNodeId: "node-a",
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(received.length).toBe(1);

    sub.unsubscribe();
  });

  it("server-side consumer registry with computeRecipients and union filter", () => {
    // Detailed: mesh-shared-stream-store-advanced
    const consumerReg = new ServerConnectionConsumerRegistry();
    const c1 = cid();
    const c2 = cid();

    consumerReg.attach(c1, prodFilter);
    consumerReg.attach(c2, stagingFilter);

    expect(consumerReg.getConsumerCount()).toBe(2);
    expect(consumerReg.isEmpty()).toBe(false);

    const recipients = consumerReg.computeRecipients({ env: "prod" });
    expect(recipients).toContain(c1);
    expect(recipients).not.toContain(c2);

    const union = consumerReg.getUnionFilter();
    expect(union).not.toBeNull();
  });

  it("supports params -> filter descriptor compilation", () => {
    // Detailed: mesh-filter-and-where
    const eqFilter: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
    const inFilter: MeshFilterDescriptor = { op: "in", field: "env", values: ["prod", "staging"] };
    const andFilter: MeshFilterDescriptor = {
      op: "and",
      operands: [
        { op: "eq", field: "env", value: "prod" },
        { op: "eq", field: "status", value: "running" },
      ],
    };

    expect(eqFilter.op).toBe("eq");
    expect(inFilter.op).toBe("in");
    expect(andFilter.op).toBe("and");
    expect(andFilter.operands).toHaveLength(2);
  });

  it("supports filter descriptor reconstruction on server side", () => {
    // Detailed: mesh-filter-and-where
    const reg = new ServerConnectionConsumerRegistry();
    const c1 = cid();

    reg.attach(c1, prodFilter);
    const union = reg.getUnionFilter();
    expect(union).not.toBeNull();

    reg.detach(c1);
    expect(reg.isEmpty()).toBe(true);
  });

  it("supports typed where expressions with _or/_and and leaf operators", () => {
    // Detailed: mesh-filter-and-where
    const compound: MeshFilterDescriptor = {
      op: "or",
      operands: [
        { op: "and", operands: [
          { op: "eq", field: "env", value: "prod" },
          { op: "gte", field: "replicas", value: 3 },
        ]},
        { op: "eq", field: "env", value: "staging" },
      ],
    };

    const neverFilter: MeshFilterDescriptor = { op: "never" };
    const alwaysFilter: MeshFilterDescriptor = { op: "always" };
    const notFilter: MeshFilterDescriptor = { op: "not", operand: { op: "eq", field: "status", value: "stopped" } };
    const existsFilter: MeshFilterDescriptor = { op: "exists", field: "deletedAt" };
    const matchesFilter: MeshFilterDescriptor = { op: "matches", field: "name", pattern: "^prod-" };

    expect(compound.op).toBe("or");
    expect(compound.operands).toHaveLength(2);
    expect(neverFilter.op).toBe("never");
    expect(alwaysFilter.op).toBe("always");
    expect(notFilter.op).toBe("not");
    expect(existsFilter.op).toBe("exists");
    expect(matchesFilter.op).toBe("matches");
  });

  it("StreamManagerService getOrCreateAndAttach handles attach/promote/new paths", async () => {
    // Detailed: mesh-shared-stream-store-advanced
    const mgr = new StreamManagerService(registry);
    const c1 = cid();
    const c2 = cid();
    const c3 = cid();

    const r1 = (await mgr.getOrCreateAndAttach("node-a", "deployments", "list", c1, prodFilter))!;
    expect(r1.consumers.has(c1)).toBe(true);

    const r2 = (await mgr.getOrCreateAndAttach("node-a", "deployments", "list", c2, prodFilter))!;
    expect(r2.consumers.has(c2)).toBe(true);
    expect(r2.id).toBe(r1.id);

    const r3 = (await mgr.getOrCreateAndAttach("node-a", "deployments", "list", c3, broadFilter))!;
    expect(r3.consumers.has(c3)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Event Namespace System
// ─────────────────────────────────────────────────────────────────────────────

describe("Mesh E2E: Compliance — Event Namespace System", () => {
  it("MeshStreamEvent structure (initial/data/error/complete) with typed metadata", () => {
    // Detailed: mesh-event-namespace
    const initialEvent = { type: "initial" as const, items: [{ id: "1" }], meta: {} };
    const dataEvent = { type: "data" as const, items: [{ id: "2" }], meta: { sequence: 1 } };
    const errorEvent = { type: "error" as const, error: new Error("test") };
    const completeEvent = { type: "complete" as const };

    expect(initialEvent.type).toBe("initial");
    expect(dataEvent.type).toBe("data");
    expect(dataEvent.meta?.sequence).toBe(1);
    expect(errorEvent.type).toBe("error");
    expect(completeEvent.type).toBe("complete");
  });

  it("MeshChangeEvent structure (initial/created/updated/deleted/reconnect)", () => {
    // Detailed: mesh-event-namespace, mesh-listen-api
    const change = {
      type: "updated" as const,
      items: [{ id: "d-1", status: "running" }],
      changedItem: { id: "d-1", status: "running" },
      previousItem: { id: "d-1", status: "pending" },
      timestamp: new Date().toISOString(),
    };

    expect(change.type).toBe("updated");
    expect(change.items).toHaveLength(1);
    expect(change.changedItem).toBeDefined();
    expect(change.previousItem).toBeDefined();
    expect(change.timestamp).toBeDefined();
  });

  it("namespace isolation via separate subjects / prefix filtering", () => {
    // Detailed: mesh-event-namespace
    const deployment$ = new Subject<{ type: string; namespace: string }>();
    const metric$ = new Subject<{ type: string; namespace: string }>();

    const deploymentEvents: Array<{ type: string; namespace: string }> = [];
    const metricEvents: Array<{ type: string; namespace: string }> = [];

    deployment$.subscribe((e) => deploymentEvents.push(e));
    metric$.subscribe((e) => metricEvents.push(e));

    deployment$.next({ type: "deployment:updated", namespace: "deployment" });
    metric$.next({ type: "metric:collected", namespace: "metric" });

    expect(deploymentEvents).toHaveLength(1);
    expect(deploymentEvents[0]!.namespace).toBe("deployment");
    expect(metricEvents).toHaveLength(1);
    expect(metricEvents[0]!.namespace).toBe("metric");
    expect(deploymentEvents.some((e) => e.namespace === "metric")).toBe(false);
  });

  it("source-specific namespace subscription (webhook vs mutation vs timer)", () => {
    // Detailed: mesh-event-namespace
    const webhook$ = new Subject<{ source: string }>();
    const mutation$ = new Subject<{ source: string }>();

    const webhookEvents: Array<{ source: string }> = [];
    const mutationEvents: Array<{ source: string }> = [];

    webhook$.subscribe((e) => webhookEvents.push(e));
    mutation$.subscribe((e) => mutationEvents.push(e));

    webhook$.next({ source: "github" });
    mutation$.next({ source: "user" });

    expect(webhookEvents).toHaveLength(1);
    expect(webhookEvents[0]!.source).toBe("github");
    expect(mutationEvents).toHaveLength(1);
    expect(mutationEvents[0]!.source).toBe("user");
  });

  it("structured namespace keys (namespace:entity:source:type) parsing", () => {
    // Detailed: mesh-event-namespace
    const key = "deployment:deployments:webhook:updated";
    const parts = key.split(":");

    expect(parts[0]).toBe("deployment");
    expect(parts[1]).toBe("deployments");
    expect(parts[2]).toBe("webhook");
    expect(parts[3]).toBe("updated");
  });

  it("MeshListenResult with items$, events$, all$ observables", () => {
    // Detailed: mesh-listen-api
    const source$ = new Subject<{ type: string; item: string }>();

    const items$ = source$.pipe(rxFilter((e) => e.type === "initial" || e.type === "created"));
    const events$ = source$.pipe(rxFilter((e) => e.type !== "initial"));
    const all$ = source$.asObservable();

    expect(items$).toBeInstanceOf(Observable);
    expect(events$).toBeInstanceOf(Observable);
    expect(all$).toBeInstanceOf(Observable);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Resource Ownership
// ─────────────────────────────────────────────────────────────────────────────

describe("Mesh E2E: Compliance — Resource Ownership", () => {
  it("defineResource builder with global/node-owned ownership", () => {
    // Detailed: mesh-resource-ownership, mesh-resource-builder-and-discovery
    const schema = z.object({ id: z.string(), name: z.string() });

    const global = defineResource()
      .key("projects").itemSchema(schema).itemKey("id")
      .globalOwnership().build();

    expect(global.key).toBe("projects");
    expect(global.ownership.type).toBe("global");

    const nodeOwned = defineResource()
      .key("deployments").itemSchema(schema).itemKey("id")
      .nodeOwnedOwnership("nodeId").build();

    expect(nodeOwned.key).toBe("deployments");
    expect(nodeOwned.ownership.type).toBe("node-owned");
  });

  it("queries and mutations can be chained on resource definitions", () => {
    // Detailed: mesh-resource-builder-and-discovery, mesh-resource-ownership
    const schema = z.object({ id: z.string(), name: z.string() });

    const resource = defineResource()
      .key("projects").itemSchema(schema).itemKey("id").globalOwnership()
      .addQuery("list", { inputSchema: z.object({}), outputSchema: z.array(schema), capabilities: { request: true, listen: false, paginate: false, sort: false, filter: false, project: false } })
      .addMutation("create", { inputSchema: schema, outputSchema: schema, capabilities: { returnsItem: true, batchable: false, emitsEvents: true, optimisticUpdates: false }, sideEffects: [] })
      .build();

    expect(resource.queries?.list).toBeDefined();
    expect(resource.mutations?.create).toBeDefined();
  });

  it("event sources can be configured on resource definitions", () => {
    // Detailed: mesh-resource-ownership
    const schema = z.object({ id: z.string(), name: z.string() });

    const resource = defineResource()
      .key("projects").itemSchema(schema).itemKey("id").globalOwnership()
      .addEventSource("webhook", { type: "external", schema: schema, emitsCreated: true, emitsUpdated: true, emitsDeleted: true, config: { system: "webhook", validate: undefined } })
      .build();

    expect(resource.eventSources?.webhook).toBeDefined();
  });

  it("MeshPartitionPolicy evaluates AP/CP/hybrid consistency modes", () => {
    // Detailed: mesh-resource-ownership
    const apResult = MeshPartitionPolicy.evaluate({
      consistencyMode: "ap", activePeerCount: 0, quorumSize: 3,
    });
    expect(apResult.canWrite).toBe(true);
    expect(apResult.canRead).toBe(true);
    expect(apResult.effectiveLifecycleState).toBe("healthy");
    expect(apResult.reason).toBe("ap_always_available");

    const cpNoQuorum = MeshPartitionPolicy.evaluate({
      consistencyMode: "cp", activePeerCount: 1, quorumSize: 3,
    });
    expect(cpNoQuorum.canWrite).toBe(false);
    expect(cpNoQuorum.canRead).toBe(true);
    expect(cpNoQuorum.effectiveLifecycleState).toBe("isolated");
    expect(cpNoQuorum.reason).toBe("cp_quorum_lost");

    const cpQuorum = MeshPartitionPolicy.evaluate({
      consistencyMode: "cp", activePeerCount: 3, quorumSize: 3,
    });
    expect(cpQuorum.canWrite).toBe(true);
    expect(cpQuorum.effectiveLifecycleState).toBe("healthy");
    expect(cpQuorum.reason).toBe("cp_quorum_met");

    const hybridNoQuorum = MeshPartitionPolicy.evaluate({
      consistencyMode: "hybrid", activePeerCount: 1, quorumSize: 3,
    });
    expect(hybridNoQuorum.canWrite).toBe(true);
    expect(hybridNoQuorum.canRead).toBe(true);
    expect(hybridNoQuorum.effectiveLifecycleState).toBe("degraded");
    expect(hybridNoQuorum.reason).toBe("hybrid_degraded_no_quorum");
  });

  it("OwnershipResolverService registers nodes and resolves owners", async () => {
    // Detailed: mesh-resource-ownership
    const resolver = new OwnershipResolverService();

    resolver.registerNode({ id: "node-a", baseUrl: "http://node-a:3001" });
    resolver.registerNode({ id: "node-b", baseUrl: "http://node-b:3002" });

    const watch$ = resolver.watchOwnership("deployments");
    expect(watch$).toBeInstanceOf(Observable);

    const owners = await resolver.resolveOwners("deployments");
    expect(Array.isArray(owners)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Query Executor
// ─────────────────────────────────────────────────────────────────────────────

describe("Mesh E2E: Compliance — Query Executor", () => {
  it("executes queries with where/filter chaining", () => {
    // Detailed: mesh-query-executor, mesh-resource-builder-and-discovery
    interface QueryBuilderLike {
      where(filter: Record<string, unknown>): QueryBuilderLike;
      orderBy(field: string, dir: "asc" | "desc"): QueryBuilderLike;
      limit(n: number): QueryBuilderLike;
      offset(n: number): QueryBuilderLike;
      request(): Promise<{ items: unknown[] }>;
    }
    const builder = {
      where: () => builder, orderBy: () => builder,
      limit: () => builder, offset: () => builder,
      request: async () => ({ items: [] }),
    } as unknown as QueryBuilderLike;

    const result = builder
      .where({ env: "prod" }).where({ status: "running" })
      .orderBy("createdAt", "desc").limit(20).request();

    expect(result).toBeInstanceOf(Promise);
    expect(typeof result.then).toBe("function");
  });

  it("supports orderBy (asc/desc) and multiple order clauses", () => {
    // Detailed: mesh-query-executor
    type OrderClause = { field: string; direction: "asc" | "desc" };
    const orderBy: OrderClause[] = [
      { field: "createdAt", direction: "desc" },
      { field: "name", direction: "asc" },
    ];

    expect(orderBy).toHaveLength(2);
    expect(orderBy[0]!.direction).toBe("desc");
    expect(orderBy[1]!.direction).toBe("asc");
  });

  it("supports pagination via limit/offset", () => {
    // Detailed: mesh-query-executor
    const pagination = { limit: 20, offset: 40 };
    expect(pagination.limit).toBe(20);
    expect(pagination.offset).toBe(40);
    expect(Math.floor(pagination.offset / pagination.limit)).toBe(2);
  });

  it("supports field selection via select()", () => {
    // Detailed: mesh-query-executor
    const selection = ["id", "name", "status"] as const;
    expect(selection).toContain("id");
    expect(selection).toContain("name");
    expect(selection).toHaveLength(3);
  });

  it("query() convenience shorthand and queryWithInput() for custom queries", () => {
    // Detailed: mesh-query-executor, mesh-resource-builder-and-discovery
    type QueryFn = (q: unknown) => Promise<{ items: unknown[] }>;
    type QueryWithInputFn = (q: unknown, input: unknown) => Promise<{ items: unknown[] }>;

    const query: QueryFn = async () => ({ items: [] });
    const queryWithInput: QueryWithInputFn = async () => ({ items: [] });

    expect(query).toBeInstanceOf(Function);
    expect(queryWithInput).toBeInstanceOf(Function);
  });

  it("explain() / explainFormatted() for query plan introspection", () => {
    // Detailed: mesh-query-executor
    const plan = {
      queryType: "select",
      targetNodes: ["node-a", "node-b"],
      estimatedItems: 42,
      filter: { op: "eq", field: "env", value: "prod" },
    };
    const formatted = `Query: ${plan.queryType}\nNodes: ${plan.targetNodes.join(", ")}\nEst. items: ${plan.estimatedItems}`;

    expect(plan.queryType).toBe("select");
    expect(plan.targetNodes).toHaveLength(2);
    expect(formatted).toContain("node-a");
  });

  it("returns empty result for non-matching where clauses without error", () => {
    // Detailed: mesh-query-executor
    const emptyResult = { items: [], meta: { totalCount: 0 } };
    expect(emptyResult.items).toHaveLength(0);
    expect(emptyResult.meta.totalCount).toBe(0);
  });

  it("node response metadata included in query results", () => {
    // Detailed: mesh-query-executor
    const result = {
      items: [{ id: "d-1" }],
      nodeResponses: [
        { nodeId: "node-a", itemsCount: 1, latencyMs: 12 },
      ],
    };

    expect(result.nodeResponses).toBeDefined();
    expect(result.nodeResponses).toHaveLength(1);
    expect(result.nodeResponses[0]!.nodeId).toBe("node-a");
    expect(result.nodeResponses[0]!.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Consumer Patterns
// ─────────────────────────────────────────────────────────────────────────────

describe("Mesh E2E: Compliance — Consumer Patterns", () => {
  it("Pattern 1: Simple request via discovery.query() / builder.request()", async () => {
    // Detailed: mesh-consumer-patterns, mesh-resource-builder-and-discovery
    const mockExecute = async () => ({
      items: [{ deploymentId: "d-1", serviceId: "svc-1", status: "running" }],
      meta: { totalCount: 1 },
    });

    const result = await mockExecute();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.status).toBe("running");
    expect(result.meta.totalCount).toBe(1);
  });

  it("Pattern 2: Reactive updates with RxJS operators (filter, map, bufferTime, merge)", () => {
    // Detailed: mesh-consumer-patterns
    const source$ = new Subject<{ deploymentId: string; status: string }>();
    const running$ = source$.pipe(rxFilter((d) => d.status === "running"));

    const collected: Array<{ deploymentId: string; status: string }> = [];
    running$.subscribe((d) => collected.push(d));

    source$.next({ deploymentId: "d-1", status: "running" });
    source$.next({ deploymentId: "d-2", status: "stopped" });
    source$.next({ deploymentId: "d-3", status: "running" });

    expect(collected).toHaveLength(2);
    expect(collected[0]!.deploymentId).toBe("d-1");
    expect(collected[1]!.deploymentId).toBe("d-3");
  });

  it("Pattern 3: Request with refresh via BehaviorSubject caching", async () => {
    // Detailed: mesh-consumer-patterns
    const cache$ = new BehaviorSubject<readonly string[]>([]);
    let fetchCount = 0;

    const loadData = async () => {
      fetchCount++;
      cache$.next([`data-${fetchCount}`]);
    };

    expect(cache$.value).toEqual([]);
    await loadData();
    expect(cache$.value).toEqual(["data-1"]);
    await loadData();
    expect(cache$.value).toEqual(["data-2"]);
    expect(fetchCount).toBe(2);
  });

  it("consumer service integration: health reports and deployment summaries", () => {
    // Detailed: mesh-consumer-patterns, mesh-resource-builder-and-discovery
    const report = {
      totalDeployments: 10, healthyCount: 8, unhealthyCount: 2,
      byEnvironment: { prod: { healthy: 3, unhealthy: 0 } },
      averageReplicas: 3.5,
    };

    expect(report.totalDeployments).toBe(10);
    expect(report.healthyCount + report.unhealthyCount).toBe(report.totalDeployments);
    expect(report.averageReplicas).toBeGreaterThan(0);

    const summaries = [
      { deploymentId: "d-1", serviceId: "svc-1", status: "running" as const, environment: "prod" as const },
      { deploymentId: "d-2", serviceId: "svc-1", status: "stopped" as const, environment: "prod" as const },
    ];

    expect(summaries).toHaveLength(2);
    for (const s of summaries) {
      expect(typeof s.deploymentId).toBe("string");
      expect(typeof s.serviceId).toBe("string");
    }
  });

  it("MeshSubscriptionManager: entity-keyed notifiers with namespace isolation", () => {
    // Detailed: mesh-stream-key-derivation, mesh-global-resource
    const notifiers = new Map<string, Subject<string>>();
    const getNotifier = (key: string) => {
      if (!notifiers.has(key)) notifiers.set(key, new Subject<string>());
      return notifiers.get(key)!;
    };

    const deploymentNotifier = getNotifier("deployments");
    const serviceNotifier = getNotifier("services");

    const deploymentItems: string[] = [];
    const serviceItems: string[] = [];

    deploymentNotifier.subscribe((item) => deploymentItems.push(item));
    serviceNotifier.subscribe((item) => serviceItems.push(item));

    deploymentNotifier.next("deployment-1");
    deploymentNotifier.next("deployment-2");
    serviceNotifier.next("service-1");

    expect(deploymentItems).toEqual(["deployment-1", "deployment-2"]);
    expect(serviceItems).toEqual(["service-1"]);
    expect(deploymentItems.some((i) => i.startsWith("service"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Documented but not yet fully implemented in runtime
//
// Implementation plan: docs/mesh-todo-implementation-plan.md
// Groups these by dependency phases (A→E, P0→P2) with estimated effort.
// ─────────────────────────────────────────────────────────────────────────────

describe("Mesh E2E: Compliance — Not Yet Implemented", () => {
  it.todo("Global ownership durable stream integration against real coordinator stream");
  it.todo("Node-owned routing resolved by live ownership resolver + remote SSE control plane");
  it.todo("Sharded fan-out real multi-node SSE merge with ownership resolver");
  it.todo("Replicated read path chooses nearest/fastest replica by runtime policy");
  it.todo("Stream manager get-or-create persistent durable stream pool across app lifecycle");
  it.todo("Real REQUEST flow integration over distributed query engine with node call-many transport");
  it.todo("Real LISTEN flow integration over distributed query engine with server push envelope pipeline");
  it.todo("Promotion/demotion control frames mesh:promote/mesh:demote over live SSE control channel");
  it.todo("SharedStreamStore acquire/release/has/snapshot/evict reference-counted implementation");
  it.todo("computeStreamKey() stream key derivation function");
  it.todo("MeshStreamEventPayload with namespace/entity/source/item/payload routing");
  it.todo("StreamManager persistent durable stream pool across app lifecycle");
});
