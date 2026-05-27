i want you to enhance this doc to take in account sse stream shared event to avoid creating a new sse stream for each new request. the goal is to have a store so when someone want somthings we check if there is not already is a opened stream for these filters etc

# Mesh Use Cases & Event Architecture

The mesh architecture embraces a **100% RxJS-based streaming model**, treating the whole distributed platform as a single event-driven system. Under the hood, everything is routed through Server-Sent Events (SSE) bounded dynamically to the RxJS lifecycle (`subscribe` triggers the connection; `unsubscribe` terminates it). 

This robust system enables precise real-time synchronization, edge-computing topologies, distributed querying, and transparent scaling boundaries. 

---

## 1. The RxJS Event Namespace System

Instead of a flat bus, the mesh operates on **Namespaced Event Streams**. Events are scoped through structured keys (e.g., `namespace:resource:source:type`). This ensures zero cross-talk, exact typing, and efficient topological fan-out.

### 1.1 Event Structure

Every real-time event within the mesh emits the following interface on the wire and deserialises into an RxJS Observable:

```typescript
export interface MeshStreamEventPayload<TItem, TEventPayload = unknown> {
  // Routing metadata
  readonly namespace: string;        // The logical grouping (e.g., "deployment")
  readonly entity: string;           // The resource entity (e.g., "service")
  readonly source: string;           // The event driver (e.g., "webhook", "mutations")
  readonly type: string;             // The event name (e.g., "updated")

  // State metadata
  readonly item: TItem;              // Current authoritative state of the entity
  readonly payload: TEventPayload;   // Contextual information (e.g., { diff: [..] })
  readonly timestamp: string;        
  readonly sourceNodeId: string;     // The Node identifying as the originator
}
```

### 1.2 Accessing the Namespaces via RxJS

You interact with namespaces utilizing the `events` property built into `meshEntityEnhanced`. The mesh abstracts the discovery protocol and merely hands you an RxJS observable matching the namespace request:

```typescript
// Example: Listen directly to a specific source namespace stream
const githubWebhookStream$ = organizationServiceEntity.events.getSourceObservable<{ commitSha: string }>("github_webhook");

const subscription = githubWebhookStream$.subscribe({
  next: (event) => {
    // event.type === "github_webhook:updated"
    // event.payload === { commitSha: "a09bd9..." }
    console.log(`Pipeline triggered for ${event.item.serviceId}`);
  }
});
```

---

## 2. Why Use the Mesh? (The Driving Philosophy)

### 2.1 Distributed Edge Synchronization 
In a multi-node architecture, node A might be deploying a service while node B is rendering the UI for the user. Instead of relying on rigid, interval-based polling (which increases DB load and UX lag), the Mesh guarantees sub-second updates by fanning out SSE events triggered off the edge node’s RxJS pipelines directly back to the API/Web boundary.

### 2.2 Transparent Scalability (The Mesh Abstraction)
Developers don’t need to care *where* a resource lives. You call `.where({ serviceId: "x" })` and `.listen()`. The mesh knows if "deployments" are **Node-Owned** (meaning the Mesh queries Node C directly and proxies the SSE to you) or **Global** (the Mesh hooks into the Central Coordinator's stream). It scales infinitely without restructuring the internal APIs.

### 2.3 Strict Logical Isolation (Namespaces)
Because events are namespaced by the definition layer (e.g., mutation vs metrics vs webhook), a UI component can listen *only* to metric streams for a service, bypassing high-volume mutation streams that it doesn’t care about, massively reducing wire overhead.

---

## 3. How to Use the Mesh: Ownership Patterns & Use Cases

The way you fetch and subscribe depends profoundly on the `ownership` pattern set in the resource definition.

### 3.1 `Global` (Coordinator Owned)
**What it is:** Resource lives in a central state store (the primary DB). Changes are universally broadcasted.
**When to use:** Metadata, structural state, settings.
**Examples:** `User`, `Organization`, `Project`, `AccessTokens`.

```typescript
// ── Use Case: Live Role Management ──
// If an admin promotes a user from Viewer to Admin, 
// the Mesh broadcasts a global event. All active sessions
// for that user immediately reflect the new permissions via stream bounds.

discovery
  .from(globalResources.users)
  .where({ organizationId: "org-1" })
  .listen() // Translates to an SSE listening on the global mesh stream
  .subscribe(event => updateRoleCache(event.item));
```

### 3.2 `Node-Owned` (Edge Owned)
**What it is:** A specific node acts as the sole authoritative owner due to physical constraints (e.g., the container is running *on* node B). 
**When to use:** Runtime instances, active jobs, live builds.
**Examples:** `Deployment`, `DockerContainer`, `BuildJob`.

```typescript
// ── Use Case: Live Build Logs ──
// The target Deployment is Node-Owned. The Mesh looks up which Node
// holds the deployment, proxies a direct SSE stream up to that Node,
// and pipes the logs back to you as an RxJS Observable.

discovery
  .from(nodeOwnedResources.deployments)
  .where({ status: "building" })
  .listen() 
  // Under the hood: Dynamic Ephemeral SSE directly to Node B
  .subscribe(log => appendToTerminal(log.item));
```

### 3.3 `Sharded` (Partitioned)
**What it is:** The dataset is split across the cluster utilizing a partition key (usually to balance memory or disk boundaries).
**When to use:** High volume aggregates, transient stats.
**Examples:** `LiveTraefikMetrics`, `DistributedCache`, `ActiveWebsocketConnections`.

```typescript
// ── Use Case: Real-time Traffic Metrics ──
// Traffic hits 5 different edge nodes. You want an aggregate stream
// of metrics for 'project-x'. The Mesh opens an SSE fan-out to all
// 5 nodes simultaneously and merges them into a single local RxJS stream.

discovery
  .from(shardedResources.metrics)
  .where({ projectId: "proj-abc" })
  .listen() 
  // Under the hood: 5 simultaneous SSE Streams -> merged into 1 Observable
  .pipe(
     bufferTime(1000), // RxJS capabilities available trivially
     map(calculateAverages)
  )
  .subscribe(avg => updateChart(avg));
```

### 3.4 `Replicated` (High-Availability)
**What it is:** The data is pushed to multiple nodes matching a consistency model (strong/eventual) so any of them can answer immediately. 
**When to use:** Zero-latency crucial config lookups, secret injection for edge workers.
**Examples:** `EnvironmentVariables`, `TLSCertificates`, `RateLimitState`.

```typescript
// ── Use Case: Instant Config Pulls ──
// We need the database connection URL for a service immediately to boot it up.
// Because it's replicated, we just request it from the closest/fastest node.

const envVars = await discovery
  .from(replicatedResources.environment)
  .where({ serviceId: "db-1" })
  .request(); // Promise API for instantaneous, one-shot pulls from local cache
```

---

## Conclusion
The Mesh Module guarantees that the physical complexity of multi-server application state is abstracted into simple, standardized Zod/RxJS operations. Whether you are doing a single `await request()` for a user's name, or opening a dynamic multi-node `listen()` pipeline for real-time build logs, the topological routing, backpressure, and type safety are all guaranteed synchronously.





also update the doc to take in account this doc as well
# Mesh Resource Discovery Architecture

## Overview

The mesh system provides a unified API for discovering and accessing resources across a distributed cluster. All communication is built on **SSE (Server-Sent Events)** streams, with Observable-based APIs for reactive programming and Promise-based conveniences for simple use cases.

## Core Principles

### 1. Observable-First, Promise as Convenience

- **Primary API**: Observables for streaming, real-time updates
- **Secondary API**: Promises for one-time requests (built on top of Observables)
- All operations fundamentally work with streams

### 2. Resource Ownership Model

Resources have different ownership patterns that determine how they're accessed:

| Ownership | Description | Discovery Pattern |
|-----------|-------------|-------------------|
| **Global** | Single source of truth, not tied to any node | Subscribe to global event stream |
| **Node-Owned** | Owned by exactly one node | Direct SSE stream to owner node |
| **Sharded** | Partitioned across multiple nodes | Fan-out SSE streams to shard holders |
| **Replicated** | Same data on multiple nodes (HA) | Subscribe to any replica |

### 3. Stream Types

#### A. Main Mesh Stream (Durable)

**Purpose**: Cluster topology, node discovery, keep-alive

**Characteristics**:
- Persistent connection to mesh coordinator
- Used for: node announcements, heartbeats, topology changes
- Durable: reconnects automatically on connection loss

**Access**:
```typescript
// Subscribe to mesh topology changes
discovery.mesh.topology.listen().subscribe(event => {
  console.log(`Node ${event.nodeId} is ${event.status}`);
});
```

#### B. Global Resource Stream (Durable)

**Purpose**: Global resources (projects, organizations, users)

**Characteristics**:
- Persistent connection to global resource coordinator
- Events: `created`, `updated`, `deleted`
- Shared across all nodes via event replication

**Access**:
```typescript
// Listen to global project changes
discovery
  .from(resources.projects)
  .listen() // Observable<ProjectChangeEvent>
  .subscribe(event => {
    if (event.type === 'created') {
      console.log('New project:', event.item);
    }
  });
```

#### C. Node-Specific Streams (Ephemeral)

**Purpose**: Node-owned resources (deployments, logs, metrics)

**Characteristics**:
- Created on-demand when a consumer wants to listen
- SSE connection established directly to node(s) holding the resource
- Closed when consumer unsubscribes

**Access**:
```typescript
// Listen to deployments on specific node(s)
discovery
  .from(resources.deployments)
  .where({ serviceId: 'my-service' })
  .listen() // Opens SSE to relevant node(s)
  .subscribe(event => {
    console.log('Deployment update:', event);
  });
```

## Resource Discovery Flows

### Flow 1: Request (One-Time Query)

```
Consumer                    Discovery Service                    Nodes
   |                              |                                  |
   |  .request()                  |                                  |
   | ----------------------------->|                                  |
   |                              |  1. Determine resource ownership |
   |                              |  2. Query appropriate node(s)    |
   |                              | -------------------------------->|
   |                              |                                  |
   |                              |  3. Return results               |
   |                              | <--------------------------------|
   |                              |                                  |
   |  Promise<Result>             |                                  |
   | <-----------------------------|                                  |
```

**Implementation**:
```typescript
// One-time request - Promise API
const deployments = await discovery
  .from(resources.deployments)
  .where({ environment: 'prod' })
  .request(); // Promise<QueryResult>
```

**Under the hood**:
- For global resources: Query global coordinator
- For node-owned: Query specific node or broadcast to all
- For sharded: Query shard holders
- Result aggregated and returned as Promise

### Flow 2: Listen (Real-Time Subscription)

```
Consumer                    Discovery Service                    Node(s)
   |                              |                                  |
   |  .listen()                   |                                  |
   | ----------------------------->|                                  |
   |                              |  1. Determine ownership          |
   |                              |  2. Open SSE stream(s)           |
   |                              | -------------------------------=>|
   |                              |                                  |
   |  Observable<Events>          |  3. Stream events <-------------=>|
   | <============================|================================= |
   |                              |                                  |
   |  .unsubscribe()              |                                  |
   | ----------------------------->|  4. Close SSE stream(s)          |
   |                              | -------------------------------->|
```

**Implementation**:
```typescript
// Real-time updates - Observable API
const subscription = discovery
  .from(resources.deployments)
  .where({ environment: 'prod' })
  .listen() // Observable<ChangeEvent>
  .subscribe(event => {
    switch (event.type) {
      case 'created': console.log('New:', event.item); break;
      case 'updated': console.log('Updated:', event.item); break;
      case 'deleted': console.log('Deleted:', event.item); break;
    }
  });

// Cleanup
subscription.unsubscribe();
```

**Under the hood**:
- For global resources: Subscribe to global event stream
- For node-owned: Open SSE stream to owner node(s)
- For sharded: Open SSE streams to all shard holders
- Observable merges events from all relevant streams

## API Design

### Unified Builder API

```typescript
// Query building is the same for all resource types
const builder = discovery
  .from(resources.deployments)
  .where({ environment: 'prod', status: 'running' })
  .orderBy('createdAt', 'desc')
  .limit(100);

// Request mode: One-time query
const result = await builder.request();

// Listen mode: Real-time updates
const stream$ = builder.listen();
stream$.subscribe(event => console.log(event));
```

### Resource Definition

```typescript
// Define resource with ownership and access patterns
const deployments = defineResource({
  key: 'deployments',
  schema: deploymentSchema,
  
  // Ownership configuration
  ownership: {
    type: 'node-owned',      // 'global' | 'node-owned' | 'sharded' | 'replicated'
    ownerField: 'nodeId',    // Field indicating ownership
  },
  
  // Query configuration
  queries: {
    list: defineQuery({
      input: listDeploymentsInput,
      output: listDeploymentsOutput,
      // Can be executed as request or listen
      supports: ['request', 'listen'],
    }),
    
    findById: defineQuery({
      input: findDeploymentInput,
      output: deploymentSchema,
      // Single item - request only
      supports: ['request'],
    }),
  },
  
  // Event configuration
  events: {
    // Which events are emitted
    types: ['created', 'updated', 'deleted', 'restarted', 'scaled'],
    // Event payload schema
    payload: deploymentEventSchema,
  },
});
```

### Consumer Patterns

#### Pattern 1: Simple Request

```typescript
@Injectable()
class DeploymentService {
  async getRunningDeployments(serviceId: string) {
    return await this.discovery
      .from(resources.deployments)
      .where({ serviceId, status: 'running' })
      .request();
  }
}
```

#### Pattern 2: Reactive Updates

```typescript
@Injectable()
class DeploymentDashboardService {
  private deployments$ = this.discovery
    .from(resources.deployments)
    .where({ environment: 'prod' })
    .listen();

  getLiveDeployments() {
    return this.deployments$;
  }
}
```

#### Pattern 3: Request with Refresh

```typescript
@Injectable()
class ProjectService {
  private projectsCache$ = new BehaviorSubject<Project[]>([]);

  async loadProjects() {
    const result = await this.discovery
      .from(resources.projects)
      .where({ status: 'active' })
      .request();
    
    this.projectsCache$.next(result.items);
    return result.items;
  }

  listenToUpdates() {
    return this.discovery
      .from(resources.projects)
      .where({ status: 'active' })
      .listen()
      .subscribe(event => {
        this.loadProjects(); // Refresh on change
      });
  }
}
```

## Implementation Architecture

### Stream Manager

Responsible for managing SSE connections:

```typescript
interface StreamManager {
  // Get or create a stream to a node
  getNodeStream(nodeId: string): Observable<NodeEvent>;
  
  // Get or create the global event stream
  getGlobalStream(): Observable<GlobalEvent>;
  
  // Create ephemeral query stream
  createQueryStream<T>(
    query: MeshQuery,
    targets: NodeTarget[]
  ): Observable<T>;
}
```

### Ownership Resolver

Determines where to route queries:

```typescript
interface OwnershipResolver {
  // Resolve which node(s) own a resource
  resolveOwners(
    resourceKey: string,
    filter?: ResourceFilter
  ): Promise<NodeTarget[]>;
  
  // Subscribe to ownership changes
  watchOwnership(resourceKey: string): Observable<OwnershipChange>;
}
```

### Query Engine

Executes queries against the mesh:

```typescript
interface QueryEngine {
  // Execute one-time query
  request<T>(query: BuiltQuery): Promise<QueryResult<T>>;
  
  // Create real-time stream
  listen<T>(query: BuiltQuery): Observable<ChangeEvent<T>>;
}
```

## Event Flow Examples

### Global Resource Change (Project Updated)

```
Node A (originator)          Global Coordinator          Node B (consumer)
       |                             |                            |
       | 1. Project updated          |                            |
       |---------------------------->|                            |
       |                             | 2. Broadcast change        |
       |                             |---------------------------=>|
       |                             |                            |
       |                             | 3. SSE event               |
       |                             |<===========================|
       |                             |                            |
       |                             | 4. Fan out to listeners    |
       |                             |<===========================|
```

### Node-Owned Resource Change (Deployment Scaled)

```
Node A (owner)               Consumer
       |                        |
       | 1. Deployment scaled   |
       |                        |
       | 2. SSE event           |
       |=======================>|
       |                        |
       | 3. Consumer notified   |
       |=======================>|
```

### Cross-Node Query (Find All Deployments)

```
Consumer                     Discovery Service                Node A        Node B
   |                               |                              |             |
   | 1. Query all deployments      |                              |             |
   |------------------------------>|                              |             |
   |                               | 2. Fan out to all nodes      |             |
   |                               |----------------------------->|             |
   |                               |------------------------------------------>|
   |                               |                              |             |
   |                               | 3. Collect results           |             |
   |                               |<-----------------------------|             |
   |                               |<-------------------------------------------|
   |                               |                              |             |
   | 4. Aggregated result          |                              |             |
   |<------------------------------|                              |             |
```

## Type Safety

All operations are fully typed:

```typescript
// TypeScript knows the exact shape
const result = await discovery
  .from(resources.deployments)
  .where({ 
    environment: 'prod',  // ✓ Valid literal
    status: 'running',    // ✓ Valid literal
    // invalid: 'foo'    // ✗ Type error
  })
  .request();

// Result is typed as Deployment[]
result.items[0].deploymentId;  // ✓ Known property
result.items[0].invalid;       // ✗ Type error

// Listen events are typed
discovery
  .from(resources.deployments)
  .listen()
  .subscribe(event => {
    if (event.type === 'created') {
      event.item.deploymentId;  // ✓ Typed as Deployment
    }
  });
```

## Summary

1. **Everything is a stream** (SSE-based)
2. **Observable-first API** with Promise convenience
3. **Unified builder** for both request and listen patterns
4. **Ownership-aware routing** (global, node-owned, sharded, replicated)
5. **Type-safe** end-to-end
6. **Two main flows**:
   - `request()`: One-time query, returns Promise
   - `listen()`: Real-time updates, returns Observable
and

# Mesh Resource Discovery & Distributed Query Architecture — v2

> **Status:** Design finalized, implementation pending
> **Scope:** `BaseMeshService`, `meshOperation`, `MeshEntity`, `MeshQueryBuilder`, `SystemMeshResourceDiscoveryService`, distributed joins, typed subqueries
> **Goal:** Zero-boilerplate, fully inferred, strongly typed, Drizzle-style distributed query engine over mesh services

---

# Table of Contents

1. Vision & Architectural Direction
2. Core Concept Shift — Services Are Distributed Table Groups
3. Problems With The Previous Model
4. High-Level Architecture
5. Core Design Principles
6. `meshOperation()` Primitive
7. `meshEntity()` — Distributed Entity/Table Definition
8. Service Structure — Multiple Queryable Entities Per Service
9. Operation System
10. Complete Type Inference Pipeline
11. Static Service Metadata
12. Query Manifest System
13. Updated `BaseMeshService`
14. Internal Topic Derivation
15. Distributed Query Builder
16. Scope & Strategy System
17. Where System
18. Select System
19. Ordering & Pagination
20. Subqueries
21. Join System (Builder-Based)
22. Nested Joins
23. Join Type Inference
24. Execution Engine
25. Distributed Deduplication
26. Result Shapes
27. Streaming Queries
28. Discovery Service
29. Registration & Dependency Injection
30. Full End-to-End Examples
31. File Structure
32. Implementation Order
33. Invariants & Guarantees
34. Future Extensions

---

# 1. Vision & Architectural Direction

The mesh layer is no longer modeled as:

> "A service exposes a few remote procedure calls"

Instead, it is modeled as:

> "A service exposes a distributed relational surface composed of queryable entities"

Every mesh service behaves conceptually like a distributed database schema.

A service can expose:

* deployments
* deployment logs
* deployment replicas
* deployment metrics
* deployment health snapshots
* deployment routing tables
* deployment revisions
* deployment events

All from the same service.

The consumer does not think in terms of:

* topic names
* request/response pairs
* transport contracts
* mesh routing
* correlation envelopes

The consumer thinks in terms of:

* entities
* queries
* filters
* joins
* subqueries
* projections
* distributed execution

The final API should feel closer to:

```ts
const activeDeployments = await discovery
  .from(DeploymentMeshService.methods.deployments)
  .where({
    status: "running",
    environment: "prod",
  })
  .join(
    discovery
      .from(ServiceMeshService.methods.services)
      .where({ archived: false }),
    join => join.on((deployment, service) =>
      deployment.serviceId === service.serviceId,
    ),
  )
  .execute();
```

than:

```ts
await callMany("deployment:list:req", ...)
```

The distributed topology becomes an execution detail.

---

# 2. Core Concept Shift — Services Are Distributed Table Groups

## Previous Mental Model

A mesh service represented:

```txt
DeploymentMeshService
 ├─ list deployments
 ├─ resolve deployment
 └─ search deployments
```

This model is RPC-oriented.

Each operation returns one conceptual thing.

## New Mental Model

A mesh service represents:

```txt
DeploymentMeshService
 ├─ deployments
 ├─ deploymentLogs
 ├─ deploymentReplicas
 ├─ deploymentMetrics
 ├─ deploymentEvents
 ├─ deploymentRouting
 ├─ deploymentSnapshots
 └─ deploymentHealth
```

Each entity behaves like:

* a distributed table
* a distributed view
* a distributed materialized collection
* a distributed stream surface

Every entity:

* has its own item type
* has its own item key
* has its own operations
* can be joined
* can be filtered
* can be projected
* can participate in subqueries
* can itself be the result of another join

A service is therefore:

> A namespace containing multiple strongly typed distributed entities.

---

# 3. Problems With The Previous Model

## Problem 1 — Services only exposed one conceptual entity

`DeploymentMeshService` returned deployments.

But deployments are only one part of deployment topology.

We also need:

* deployment replicas
* deployment metrics
* deployment revisions
* deployment events
* deployment health
* deployment logs

The service should expose an entire graph of related distributed entities.

---

## Problem 2 — Operations were stringly typed

```ts
.from(DeploymentMeshService, "list")
```

Still relies on:

* raw strings
* manual naming
* possible typos
* poor refactorability

The goal is:

```ts
.from(DeploymentMeshService.methods.deployments)
```

where:

* the operation is a static strongly typed object
* no string literals exist
* inference is fully preserved
* IDE autocomplete works perfectly

---

## Problem 3 — Joins were service-oriented instead of query-oriented

Old:

```ts
.join({
  from: ServiceMeshService,
  operation: "list",
})
```

This is too limited.

Cannot:

* join filtered queries
* join projected queries
* join subqueries
* join already joined builders
* compose reusable joins
* create nested distributed relational graphs

The join system must instead operate on builders.

---

## Problem 4 — The transport layer leaked everywhere

The user still thought about:

* operations
* request payloads
* response payloads
* RPC semantics
* list vs resolve

The system should instead infer:

* list vs single item
* item types
* payloads
* distributed deduplication
* join compatibility
* entity identity

from the entity definitions.

---

# 4. High-Level Architecture

```txt
┌──────────────────────────────────────────────────────────────┐
│                SystemMeshResourceDiscoveryService            │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                      MeshQueryBuilder                        │
│                                                              │
│  where()                                                     │
│  join(subquery)                                              │
│  orderBy()                                                   │
│  select()                                                    │
│  limit()                                                     │
│  offset()                                                    │
│  stream()                                                    │
│  execute()                                                   │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                     MeshQueryExecutor                        │
│                                                              │
│  strategy resolution                                         │
│  distributed execution                                       │
│  deduplication                                               │
│  filtering                                                   │
│  joins                                                       │
│  pagination                                                  │
│  projections                                                 │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                       BaseMeshService                        │
│                                                              │
│  registerEntity()                                            │
│  callEntity()                                                │
│  distributed transport                                       │
│  correlation handling                                        │
│  cancellation                                                │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    Mesh Topic Infrastructure                 │
└──────────────────────────────────────────────────────────────┘
```

---

# 5. Core Design Principles

## Principle 1 — Services are distributed schemas

A service is not a single query surface.

A service exposes multiple distributed entities.

---

## Principle 2 — Entities are first-class

The primary query primitive is not:

* a topic
* a handler
* an RPC method

The primary primitive is:

```ts
MeshEntity
```

---

## Principle 3 — Builders are composable

Everything is a builder.

You can:

* join builders
* nest builders
* reuse builders
* compose builders
* project builders
* stream builders

Exactly like relational query systems.

---

## Principle 4 — Transport is infrastructure

Users never think about:

* topics
* envelopes
* cancellation
* response correlation
* request IDs

Those are entirely internal.

---

## Principle 5 — No string literals

The API should maximize:

* symbol inference
* static metadata
* object references
* type extraction
* IDE autocomplete

while minimizing:

* raw strings
* duplicated naming
* manual type annotations

---

## Principle 6 — Everything inferable should be inferred

The developer should never manually specify:

* request types
* response types
* item types
* join shapes
* projected result types
* entity shapes
* relation shapes
* query result types

The only things declared manually should be:

* schemas
* item keys
* explicit join predicates

Everything else must derive automatically.

---

# 6. `meshOperation()` Primitive

## Purpose

Defines a distributed operation.

Operations are infrastructure primitives.

They are not exposed directly to end users.

Entities are built on top of operations.

---

## Definition

```ts
export interface MeshOperation<
  TRequestSchema extends ZodType,
  TResponseSchema extends ZodType,
> {
  readonly requestSchema: TRequestSchema;
  readonly responseSchema: TResponseSchema;
}
```

---

## Factory

```ts
export function meshOperation<
  TRequestSchema extends ZodType,
  TResponseSchema extends ZodType,
>(
  requestSchema: TRequestSchema,
  responseSchema: TResponseSchema,
): MeshOperation<TRequestSchema, TResponseSchema>
```

---

# 7. `meshEntity()` — Distributed Entity/Table Definition

## Purpose

Defines a distributed queryable entity.

This is the primary abstraction exposed to users.

---

## Example

```ts
export const deployments = meshEntity({
  key: "deployments",

  item: deploymentSummarySchema,

  itemKey: "deploymentId",

  operations: {
    list: meshOperation(
      z.object({
        serviceId: z.string().optional(),
      }),
      z.object({
        items: z.array(deploymentSummarySchema),
      }),
    ),

    resolve: meshOperation(
      z.object({
        deploymentId: z.string(),
      }),
      deploymentSummarySchema.nullable(),
    ),
  },
});
```

---

## Why entities exist

Operations alone are insufficient.

The system needs:

* item identity
* entity-level metadata
* joinability
* distributed deduplication rules
* projections
* relation typing

Entities centralize these concepts.

---

# 8. Service Structure — Multiple Queryable Entities Per Service

## Example

```ts
export class DeploymentMeshService extends BaseMeshService({
  namespace: "deployment",

  entities: {
    deployments,
    deploymentLogs,
    deploymentMetrics,
    deploymentReplicas,
    deploymentEvents,
  },
}) {

  static readonly methods = {
    deployments: deployments.methods.list,
    deploymentLogs: deploymentLogs.methods.list,
    deploymentMetrics: deploymentMetrics.methods.list,
    deploymentReplicas: deploymentReplicas.methods.list,
    deploymentEvents: deploymentEvents.methods.list,

    resolveDeployment: deployments.methods.resolve,
  } as const;
}
```

---

## Result

```ts
.from(DeploymentMeshService.methods.deployments)
```

instead of:

```ts
.from(DeploymentMeshService, "list")
```

Benefits:

* no strings
* fully typed
* operation identity preserved
* impossible to reference invalid operations
* perfect autocomplete
* safe refactors

---

# 9. Operation System

## Internal Topic Derivation

Every entity operation derives:

```txt
{namespace}:{entity}:{operation}:req
{namespace}:{entity}:{operation}:res
{namespace}:{entity}:{operation}:cancel
```

Example:

```txt
deployment:deployments:list:req
```

Users never reference these.

---

# 10. Complete Type Inference Pipeline

## Pipeline

```txt
Zod Schema
   ↓
meshOperation()
   ↓
MeshEntity
   ↓
Service.methods.*
   ↓
Query Builder
   ↓
Join Expansion
   ↓
Projected Result Type
```

---

## Everything inferred

The system infers:

* request payload type
* response payload type
* item type
* list vs single item
* join result shape
* nested join shape
* projection shape
* query result type
* stream item type
* subquery shape
* alias typing

---

# 11. Static Service Metadata

Every service exposes:

```ts
static readonly methods
```

This is the primary entrypoint.

---

## Example

```ts
DeploymentMeshService.methods.deployments
DeploymentMeshService.methods.resolveDeployment
DeploymentMeshService.methods.deploymentLogs
```

Each method object contains:

* entity metadata
* operation metadata
* item type
* request type
* response type
* namespace identity
* service identity

All strongly typed.

---

# 12. Query Manifest System

Every entity declares:

```ts
itemKey
```

Example:

```ts
itemKey: "deploymentId"
```

This powers:

* distributed deduplication
* join identity
* pagination stability
* ordering stability
* stream correlation

---

# 13. Updated `BaseMeshService`

## Responsibilities

`BaseMeshService` owns:

* namespace registration
* topic derivation
* cancellation
* correlation handling
* distributed execution
* responder coordination
* transport envelopes
* distributed streaming

It does NOT own:

* filtering
* joins
* projections
* ordering
* pagination

Those belong to the query layer.

---

# 14. Internal Topic Derivation

Completely hidden from users.

---

## Example

```txt
Service Namespace: deployment
Entity: deployments
Operation: list
```

Derives:

```txt
deployment:deployments:list:req
deployment:deployments:list:res
deployment:deployments:list:cancel
```

---

# 15. Distributed Query Builder

## Entry Point

```ts
const query = discovery.from(
  DeploymentMeshService.methods.deployments,
);
```

---

## Why this is important

The operation object itself carries:

* item type
* operation type
* entity metadata
* service identity
* join capabilities

No strings needed.

---

# 16. Scope & Strategy System

## Purpose

Controls distributed execution.

Not data filtering.

---

## Example

```ts
.scope({
  organizationId: "org-1",
  broadcastAll: true,
  timeoutMs: 3000,
})
```

---

## Strategies

```ts
"broadcast-first"
"broadcast-merge"
"direct-node"
"local-only"
"quorum"
```

---

# 17. Where System

## Object Form

```ts
.where({
  status: "running",
  environment: "prod",
})
```

---

## Functional Form

```ts
.where(f => and(
  eq(f.status, "running"),
  or(
    eq(f.environment, "prod"),
    eq(f.environment, "staging"),
  ),
))
```

---

## Fully Typed

Fields autocomplete from the entity item type.

Impossible:

```ts
.where({
  invalidField: true,
})
```

Compile-time error.

---

# 18. Select System

## Purpose

Allow projections.

---

## Example

```ts
.select({
  deploymentId: true,
  status: true,
})
```

Result type becomes:

```ts
{
  deploymentId: string;
  status: string;
}
```

Fully inferred.

---

# 19. Ordering & Pagination

## Example

```ts
.orderBy("deploymentId", "asc")
.orderBy("createdAt", "desc")
.limit(50)
.offset(100)
```

All fields strongly typed.

---

# 20. Subqueries

## Core Principle

Every builder is itself queryable.

A builder can:

* be joined
* be nested
* be reused
* become a derived table

Exactly like SQL subqueries.

---

## Example

```ts
const activeServices = discovery
  .from(ServiceMeshService.methods.services)
  .where({
    archived: false,
    active: true,
  });
```

This builder can later be joined.

---

# 21. Join System (Builder-Based)

# Core Design Change

The join system no longer accepts:

```ts
.join({
  from: ServiceMeshService,
  operation: "list",
})
```

Instead it accepts:

```ts
.join(subqueryBuilder, join => ...)
```

This is critical.

It enables:

* subqueries
* reusable joins
* nested joins
* composable relational graphs
* projected joins
* filtered joins
* joined joins
* SQL-like builder composition

---

# Basic Join Example

```ts
const services = discovery
  .from(ServiceMeshService.methods.services)
  .where({
    archived: false,
  });

const result = await discovery
  .from(DeploymentMeshService.methods.deployments)
  .join(
    services,
    join => join
      .as("service")
      .on((deployment, service) =>
        deployment.serviceId === service.serviceId,
      ),
  )
  .execute();
```

---

# Join Builder API

## Signature

```ts
join<
  TJoinedBuilder extends MeshQueryBuilder<any, any, any>,
>(
  builder: TJoinedBuilder,
  config: (
    join: MeshJoinConfigurator<
      CurrentBuilderShape,
      BuilderResultShape<TJoinedBuilder>
    >,
  ) => MeshJoinConfiguratorResult,
)
```

---

# Why builders instead of services

Because builders can already contain:

* where clauses
* joins
* projections
* ordering
* aliases
* limits
* nested subqueries

Meaning joins become infinitely composable.

---

# 22. Nested Joins

## Example

```ts
const projects = discovery
  .from(ProjectMeshService.methods.projects)
  .where({ archived: false });

const services = discovery
  .from(ServiceMeshService.methods.services)
  .join(
    projects,
    join => join
      .as("project")
      .on((service, project) =>
        service.projectId === project.projectId,
      ),
  );

const deployments = await discovery
  .from(DeploymentMeshService.methods.deployments)
  .join(
    services,
    join => join
      .as("service")
      .on((deployment, service) =>
        deployment.serviceId === service.serviceId,
      ),
  )
  .execute();
```

---

# Final Result Type

Automatically inferred:

```ts
{
  deploymentId: string;
  serviceId: string;

  service: {
    serviceId: string;
    projectId: string;

    project: {
      projectId: string;
      archived: boolean;
    } | null;
  } | null;
}
```

No manual typing.

No generics.

No casts.

---

# 23. Join Type Inference

## Left Join

Default.

Joined shape becomes:

```ts
service: ServiceSummary | null
```

---

## Inner Join

```ts
.type("inner")
```

Result removes unmatched rows.

---

## Multiple Joins

```ts
.join(builderA, ...)
.join(builderB, ...)
.join(builderC, ...)
```

Each expands the result shape.

---

# 24. Execution Engine

## Pipeline

```txt
resolve strategy
      ↓
execute primary distributed query
      ↓
collect node responses
      ↓
deduplicate
      ↓
apply filters
      ↓
execute subquery joins
      ↓
stitch join graph
      ↓
apply ordering
      ↓
apply pagination
      ↓
apply projections
      ↓
return typed result
```

---

# Join Execution Model

Joins execute:

* after primary collection
* in parallel
* entirely in memory

No distributed query planner exists.

This is intentional.

---

# 25. Distributed Deduplication

## Purpose

Multiple nodes may return:

* replicas
* cached copies
* stale copies
* partial copies

The executor deduplicates using:

```ts
itemKey
```

---

## Example

```ts
itemKey: "deploymentId"
```

---

## Strategy

Default:

```txt
last-write-wins
```

Can later evolve into:

* vector clocks
* CRDT merge
* timestamp arbitration
* priority nodes

---

# 26. Result Shapes

## Query Result

```ts
interface MeshQueryResult<T> {
  items: T[];

  total: number;

  strategy: MeshQueryStrategy;

  metrics: MeshCallManyMetrics;

  nodeResponses: MeshNodeResponse[];

  hasMore: boolean;

  nextOffset: number | null;
}
```

---

# 27. Streaming Queries

## Purpose

Allow processing before all nodes respond.

---

## Example

```ts
for await (const deployment of discovery
  .from(DeploymentMeshService.methods.deployments)
  .where({ status: "pending" })
  .stream()
) {
  await processDeployment(deployment);
}
```

---

# 28. Discovery Service

## Entry Point

```ts
@Injectable()
export class SystemMeshResourceDiscoveryService {

  from<TMethod extends MeshEntityMethod<any>>(
    method: TMethod,
  ): MeshQueryBuilder<MethodItem<TMethod>>
}
```

---

## Example

```ts
const deployments = discovery.from(
  DeploymentMeshService.methods.deployments,
);
```

---

# 29. Registration & Dependency Injection

Every mesh service must register:

```ts
{
  provide: MESH_SERVICE_TOKEN,
  useExisting: DeploymentMeshService,
  multi: true,
}
```

---

# 30. Full End-to-End Examples

# Example 1 — Basic Query

```ts
const result = await discovery
  .from(DeploymentMeshService.methods.deployments)
  .where({
    status: "running",
  })
  .execute();
```

---

# Example 2 — Join Against Filtered Subquery

```ts
const activeServices = discovery
  .from(ServiceMeshService.methods.services)
  .where({
    archived: false,
    active: true,
  });

const result = await discovery
  .from(DeploymentMeshService.methods.deployments)
  .join(
    activeServices,
    join => join
      .as("service")
      .on((deployment, service) =>
        deployment.serviceId === service.serviceId,
      ),
  )
  .execute();
```

---

# Example 3 — Deep Nested Graph

```ts
const projects = discovery
  .from(ProjectMeshService.methods.projects)
  .where({ archived: false });

const services = discovery
  .from(ServiceMeshService.methods.services)
  .join(
    projects,
    join => join
      .as("project")
      .on((service, project) =>
        service.projectId === project.projectId,
      ),
  );

const metrics = discovery
  .from(DeploymentMeshService.methods.deploymentMetrics)
  .where({ healthy: true });

const result = await discovery
  .from(DeploymentMeshService.methods.deployments)
  .where({
    environment: "prod",
  })
  .join(
    services,
    join => join
      .as("service")
      .on((deployment, service) =>
        deployment.serviceId === service.serviceId,
      ),
  )
  .join(
    metrics,
    join => join
      .as("metrics")
      .on((deployment, metric) =>
        deployment.deploymentId === metric.deploymentId,
      ),
  )
  .orderBy("deploymentId")
  .limit(100)
  .execute();
```

---

# Example 4 — Reusable Builder Fragments

```ts
const prodDeployments = discovery
  .from(DeploymentMeshService.methods.deployments)
  .where({ environment: "prod" });

const runningProdDeployments = prodDeployments
  .where({ status: "running" });

const pendingProdDeployments = prodDeployments
  .where({ status: "pending" });
```

Immutable.

Composable.

---

# Example 5 — Projection

```ts
const result = await discovery
  .from(DeploymentMeshService.methods.deployments)
  .select({
    deploymentId: true,
    serviceId: true,
    status: true,
  })
  .execute();
```

Result type inferred automatically.

---

# 31. File Structure

```txt
src/core/modules/mesh/
│
├── mesh-operation.ts
├── mesh-entity.ts
├── mesh-entity.types.ts
├── mesh-query.types.ts
│
├── query/
│   ├── mesh-query-builder.ts
│   ├── mesh-query-executor.ts
│   ├── mesh-query-join-executor.ts
│   ├── mesh-query-subquery.ts
│   ├── mesh-where.ts
│   ├── mesh-select.ts
│   ├── mesh-order.ts
│   └── mesh-pagination.ts
│
├── services/
│   ├── base-mesh.service.ts
│   └── system-mesh-resource-discovery.service.ts
│
└── tokens.ts
```

---

# 32. Implementation Order

## Phase 1

* meshOperation
* meshEntity
* type inference primitives

---

## Phase 2

* BaseMeshService update
* internal topic derivation
* operation registration

---

## Phase 3

* query builder
* where system
* ordering
* pagination

---

## Phase 4

* joins
* nested joins
* builder composition
* subqueries

---

## Phase 5

* execution engine
* distributed deduplication
* streaming

---

## Phase 6

* discovery service
* DI registration
* public API stabilization

---

# 33. Invariants & Guarantees

## I1 — Services expose entities, not raw operations

Users query entities.

Not topics.

Not RPC calls.

---

## I2 — Everything is strongly typed

Impossible:

* invalid fields
* invalid joins
* invalid projections
* invalid operation references
* invalid aliases

---

## I3 — No string operation names

Operations are referenced through:

```ts
DeploymentMeshService.methods.deployments
```

Never:

```ts
"list"
```

---

## I4 — Builders are immutable

Every method returns a new builder.

---

## I5 — Joins operate on builders

Joins never accept raw service definitions.

Only builders.

This enables composability.

---

## I6 — Joins are infinitely nestable

A joined builder may itself contain joins.

---

## I7 — Filtering is post-distribution

Where clauses execute after distributed collection.

---

## I8 — Distributed execution is hidden

Users never manage:

* transport
* correlation
* cancellation
* responder counting
* topology synchronization

---

## I9 — Deduplication is entity-driven

Entities define:

```ts
itemKey
```

The executor handles distributed merging.

---

## I10 — Result types are fully inferred

No manual generics.

No casts.

No DTO duplication.

---

# 34. Future Extensions

Potential future capabilities:

* relation metadata
* automatic join inference
* distributed aggregation
* groupBy
* having
* distributed indexes
* query planner
* pushdown filtering
* distributed caching
* CRDT merge strategies
* reactive live queries
* graph traversal queries
* distributed materialized views
* query optimization
* lazy joins
* query explain plans
* distributed transactional snapshots

## 19. Distributed Mutation Architecture

The mesh system is not only a distributed discovery/query engine.
It is also a fully typed distributed mutation engine.

The same architectural principles apply:

* zero boilerplate
* zero manual topic strings
* fully inferred payloads
* entity-aware APIs
* composable builders
* deterministic distributed execution
* infrastructure hidden from userland
* transport concerns separated from domain concerns

The query layer and mutation layer are intentionally symmetric.

Just like:

```ts
await discovery
  .from(DeploymentMeshService.methods.deployments)
  .where({ deploymentId: "dep-1" })
  .execute();
```

The mutation side becomes:

```ts
await mesh
  .from(DeploymentMeshService.methods.deployments)
  .where({ deploymentId: "dep-1" })
  .update({
    status: "stopped",
  })
  .execute();
```

The developer never thinks about:

* topic routing
* node ownership
* broadcast semantics
* distributed coordination
* cancel topics
* correlation IDs
* request envelopes
* response envelopes
* retry semantics
* deduplication
* optimistic concurrency
* distributed acknowledgements

All of this is infrastructure.

---

## 20. Distributed Entity Mutation Model

The architecture now formally separates:

| Layer                   | Responsibility                                  |
| ----------------------- | ----------------------------------------------- |
| Entity Definition Layer | Defines entities, relations, mutation contracts |
| Query Layer             | Distributed querying + joins                    |
| Mutation Layer          | Distributed writes + coordination               |
| Transport Layer         | Topics, envelopes, cancellation                 |
| Topology Layer          | Routing, ownership, node resolution             |

A mesh service is now conceptually:

> A distributed bounded-context exposing multiple distributed entities,
> where each entity behaves like a distributed relational table with:
>
> * query operations
> * mutation operations
> * joins
> * ownership
> * routing
> * distributed execution semantics

Example:

```ts
DeploymentMeshService.entities.deployments
DeploymentMeshService.entities.logs
DeploymentMeshService.entities.events
DeploymentMeshService.entities.scalingPolicies
DeploymentMeshService.entities.runtimeMetrics
```

Each entity can expose:

* query methods
* mutation methods
* subscriptions
* transactional capabilities
* ownership semantics
* distributed consistency guarantees

---

## 21. Mutation Operations

Just like query operations are defined via `meshOperation()`, mutation operations are defined via:

```ts
meshMutation()
```

### File: `mesh-mutation.ts`

```ts
import type { ZodType } from "zod/v4";

export declare const MESH_MUTATION_BRAND: unique symbol;

export interface MeshMutation<
  TInputSchema extends ZodType,
  TResultSchema extends ZodType,
> {
  readonly [MESH_MUTATION_BRAND]: true;
  readonly inputSchema: TInputSchema;
  readonly resultSchema: TResultSchema;
}

export function meshMutation<
  TInputSchema extends ZodType,
  TResultSchema extends ZodType,
>(
  inputSchema: TInputSchema,
  resultSchema: TResultSchema,
): MeshMutation<TInputSchema, TResultSchema> {
  return {
    [MESH_MUTATION_BRAND]: true,
    inputSchema,
    resultSchema,
  } as MeshMutation<TInputSchema, TResultSchema>;
}
```

---

## 22. Entity Methods API

The system now formalizes the concept of:

```ts
Service.entities.entityName.methods.methodName
```

instead of:

```ts
Service.methods.operation
```

because entities are now first-class distributed relational resources.

### Example

```ts
export class DeploymentMeshService extends BaseMeshService<...> {
  static readonly entities = {
    deployments: meshEntity({
      itemKey: "deploymentId",

      queries: {
        list: meshQuery(...),
        resolve: meshQuery(...),
        search: meshQuery(...),
      },

      mutations: {
        create: meshMutation(...),
        update: meshMutation(...),
        delete: meshMutation(...),
        restart: meshMutation(...),
        scale: meshMutation(...),
      },
    }),

    logs: meshEntity({
      itemKey: "logId",

      queries: {
        list: meshQuery(...),
      },

      mutations: {
        delete: meshMutation(...),
      },
    }),
  } as const;
}
```

This allows:

```ts
DeploymentMeshService.entities.deployments.queries.list
DeploymentMeshService.entities.deployments.mutations.update
DeploymentMeshService.entities.logs.queries.list
```

with fully inferred typing.

No strings.

No operation names.

No duplicated keys.

No manual type annotations.

---

## 23. Mutation Builder API

The mutation layer mirrors the query builder.

### Entry Point

```ts
await mesh
  .from(DeploymentMeshService.entities.deployments)
  .where({ deploymentId: "dep-1" })
  .update({
    status: "running",
  })
  .execute();
```

### Create

```ts
await mesh
  .from(DeploymentMeshService.entities.deployments)
  .create({
    deploymentId: "dep-1",
    serviceId: "svc-1",
    environment: "prod",
  })
  .execute();
```

### Update

```ts
await mesh
  .from(DeploymentMeshService.entities.deployments)
  .where({ deploymentId: "dep-1" })
  .update({
    status: "stopped",
  })
  .execute();
```

### Delete

```ts
await mesh
  .from(DeploymentMeshService.entities.deployments)
  .where({ deploymentId: "dep-1" })
  .delete()
  .execute();
```

### Distributed Domain Actions

Mutations are not limited to CRUD.

They can represent domain actions:

```ts
await mesh
  .from(DeploymentMeshService.entities.deployments)
  .where({ deploymentId: "dep-1" })
  .invoke("restart", {
    graceful: true,
  })
  .execute();
```

or:

```ts
await mesh
  .from(DeploymentMeshService.entities.deployments)
  .invoke("scale", {
    replicas: 5,
  })
  .execute();
```

The mutation names autocomplete from the entity definition.

---

## 24. Distributed Mutation Strategies

Mutation execution strategies are distinct from query strategies.

Queries optimize for:

* discovery
* aggregation
* deduplication
* partial availability

Mutations optimize for:

* ownership
* consistency
* conflict resolution
* acknowledgement
* transactional guarantees

### Mutation Strategies

```ts
export type MeshMutationStrategy =
  | "owner-route"
  | "broadcast"
  | "quorum"
  | "local-only"
  | "transactional"
  | "optimistic";
```

### owner-route

Default strategy.

The system:

1. resolves entity ownership
2. routes to owning node
3. executes mutation there
4. returns typed result

The developer does NOT need to know which node owns the entity.

### broadcast

Broadcasts the mutation to all nodes.

Useful for:

* cache invalidation
* distributed notifications
* cluster synchronization
* ephemeral runtime actions

### quorum

Waits for quorum acknowledgement.

Useful for:

* consensus-sensitive writes
* distributed leadership changes
* replicated state updates

---

## 25. Mutation Result Types

```ts
export interface MeshMutationResult<TResult> {
  success: boolean;
  result: TResult;
  strategy: MeshMutationStrategy;
  affectedCount: number;
  acknowledgements: MeshMutationAcknowledgement[];
  metrics: MeshMutationMetrics;
  conflicts: MeshMutationConflict[];
  rolledBack: boolean;
}
```

---

## 26. Ownership-Aware Mutations

One of the strongest architectural advantages of the mesh system is:

> entity ownership is infrastructure

The caller never manually routes.

Execution pipeline:

```text
1. Resolve entity key from where()
2. Resolve owner node from MeshResourceRegistryService
3. Resolve mutation strategy
4. Route mutation to owner node
5. Execute mutation handler
6. Return typed result
```

This creates:

* zero manual routing
* deterministic ownership
* cluster transparency
* service transparency
* node transparency

---

## 27. Distributed Transactions (Future)

The architecture intentionally leaves room for:

* distributed transactions
* sagas
* optimistic concurrency
* event sourcing
* CQRS
* write replication
* snapshot isolation
* distributed locks
* transactional joins
* reactive live queries

without changing the public API.

---

## 28. Unified Relational Distributed Mesh Model

The final architecture can now be described as:

> A distributed relational execution engine over mesh services.

Where:

* mesh services are distributed bounded contexts
* entities behave like distributed relational tables
* builders behave like distributed query plans
* joins behave like distributed relational joins
* mutations behave like distributed relational writes
* topology/routing are infrastructure concerns
* transport is entirely hidden
* typing is fully inferred end-to-end
* operations are declarative
* ownership is automatic
* joins are composable
* subqueries are composable
* nested joins are composable
* distributed execution is deterministic

The resulting developer experience becomes:

```ts
const deployments = await mesh
  .from(DeploymentMeshService.entities.deployments)
  .where({ environment: "prod" })
  .join(
    mesh
      .from(ServiceMeshService.entities.services)
      .where({ status: "running" })
      .join(
        mesh
          .from(ProjectMeshService.entities.projects)
          .where({ archived: false }),
        {
          as: "project",
          on: (service, project) => service.projectId === project.projectId,
        },
      ),
    {
      as: "service",
      on: (deployment, service) => deployment.serviceId === service.serviceId,
    },
  )
  .update({
    status: "restarting",
  })
  .execute();
```

This is:

* relational
* distributed
* topology-aware
* ownership-aware
* transport-abstracted
* completely type-safe
* composable
* declarative
* infrastructure-driven

while still running on top of the existing mesh topic infrastructure.

# Mesh Resource Discovery & Distributed Query Architecture — v3

> **Status:** Design enhanced, implementation pending
> **Scope:** All v2 concepts + Reactive Live Queries, Distributed Aggregations, Query Middleware Pipeline, Entity Relations Graph, Optimistic Mutations, Distributed Transactions (Saga), Query Plan Introspection, Typed Event Subscriptions
> **Goal:** Complete distributed relational execution engine with reactive capabilities, transactional guarantees, and full observability

---

# New Sections Added in v3

35. Reactive Live Query System
36. Distributed Aggregation Engine
37. Query Middleware Pipeline
38. Entity Relations Graph (Auto-Join Inference)
39. Optimistic Mutation Layer
40. Distributed Saga / Transaction Coordinator
41. Query Plan Introspection
42. Typed Event Subscriptions
43. Query Caching Layer
44. Enhanced Type Utilities
45. Updated File Structure (v3)
46. Updated Implementation Order (v3)

---

# 35. Reactive Live Query System

## Motivation

Static queries return a snapshot.

Real distributed systems need:

* live deployment status feeds
* reactive topology views
* real-time metric dashboards
* event-driven UI updates
* streaming aggregations

The live query system extends the builder with a `.live()` terminal that returns an `Observable` instead of a `Promise`.

---

## API

```ts
const deployments$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .live();

deployments$.subscribe(result => {
  console.log("Updated deployments:", result.items);
});
```

---

## Live Query Behavior

A live query:

1. Executes the initial distributed query immediately
2. Subscribes to mesh entity change events
3. Re-executes or patches the result set when relevant events arrive
4. Emits a new `MeshQueryResult<T>` on every change
5. Completes when the subscriber unsubscribes

---

## Interface

```ts
interface MeshLiveQueryOptions {
  debounceMs?: number;
  throttleMs?: number;
  refetchOnChange?: boolean;
  patchOnChange?: boolean;
}

// On the builder:
live(options?: MeshLiveQueryOptions): Observable<MeshQueryResult<TResultShape>>;
```

---

## Change Event Integration

Entity mutations emit change events on internal topics:

```txt
{namespace}:{entity}:changed
{namespace}:{entity}:created
{namespace}:{entity}:deleted
```

The live query engine subscribes to these and triggers re-evaluation.

---

## Patch vs Refetch Strategy

| Strategy | Behavior |
|---|---|
| `patchOnChange` | Applies delta to existing result set in-memory |
| `refetchOnChange` | Re-executes full distributed query |

Default: `refetchOnChange: true`

`patchOnChange` is more efficient but requires the entity to emit full item payloads in change events.

---

## Implementation Sketch

```ts
// mesh-live-query.ts

export class MeshLiveQueryEngine {
  constructor(
    private readonly executor: MeshQueryExecutor,
    private readonly eventBus: MeshEntityEventBus,
  ) {}

  live$<T>(
    builder: MeshQueryBuilder<any, T>,
    options?: MeshLiveQueryOptions,
  ): Observable<MeshQueryResult<T>> {
    const initial$ = from(this.executor.execute<T>(builder));

    const entityKey = builder.query.entityKey!;
    const changes$ = this.eventBus.on$(entityKey).pipe(
      options?.debounceMs
        ? debounceTime(options.debounceMs)
        : identity,
      switchMap(() => from(this.executor.execute<T>(builder))),
    );

    return merge(initial$, changes$);
  }
}
```

---

# 36. Distributed Aggregation Engine

## Motivation

Distributed systems need more than item lists.

They need:

* counts across nodes
* sums of metrics
* averages of latencies
* groupings by environment
* histograms of status distributions

---

## API

```ts
const stats = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .aggregate({
    total: count(),
    byStatus: groupBy("status", count()),
    avgReplicas: avg("replicaCount"),
    maxAge: max("createdAt"),
  })
  .execute();
```

Result type fully inferred:

```ts
{
  total: number;
  byStatus: Record<string, number>;
  avgReplicas: number;
  maxAge: string;
}
```

---

## Aggregation Primitives

```ts
// mesh-aggregation-primitives.ts

export function count(): MeshAggregator<number> { ... }
export function sum(field: string): MeshAggregator<number> { ... }
export function avg(field: string): MeshAggregator<number> { ... }
export function min(field: string): MeshAggregator<number> { ... }
export function max(field: string): MeshAggregator<number> { ... }
export function groupBy<T>(
  field: string,
  inner: MeshAggregator<T>,
): MeshAggregator<Record<string, T>> { ... }
export function collect<T>(field: string): MeshAggregator<T[]> { ... }
export function distinct(field: string): MeshAggregator<string[]> { ... }
```

---

## Distributed Aggregation Strategy

Aggregations execute in two phases:

```txt
Phase 1 — Partial Aggregation (per node)
  Each node computes a partial aggregate over its local items.

Phase 2 — Merge Aggregation (caller)
  The caller merges all partial aggregates into a final result.
```

This mirrors the MapReduce pattern and avoids transferring all raw items over the mesh.

---

## Interface

```ts
export interface MeshAggregator<TResult> {
  readonly __brand: "MeshAggregator";
  readonly resultType: TResult;
  partial(items: unknown[]): unknown;
  merge(partials: unknown[]): TResult;
}

export interface MeshAggregateBuilder<TItem, TSpec extends Record<string, MeshAggregator<any>>> {
  execute(): Promise<{ [K in keyof TSpec]: TSpec[K]["resultType"] }>;
}
```

---

# 37. Query Middleware Pipeline

## Motivation

Cross-cutting concerns should not pollute query logic:

* distributed tracing
* query logging
* performance metrics
* authorization checks
* rate limiting
* caching
* circuit breaking

These should be composable middleware applied to the execution pipeline.

---

## Middleware Interface

```ts
// mesh-query-middleware.ts

export interface MeshQueryMiddlewareContext<T> {
  builder: MeshQueryBuilder<any, T>;
  entityKey: string;
  methodName: string;
  strategy: MeshQueryStrategy;
}

export interface MeshQueryMiddleware {
  name: string;
  execute<T>(
    context: MeshQueryMiddlewareContext<T>,
    next: () => Promise<MeshQueryResult<T>>,
  ): Promise<MeshQueryResult<T>>;
}
```

---

## Registration

```ts
// In NestJS module:
MeshModule.forRoot({
  middleware: [
    new MeshTracingMiddleware(tracer),
    new MeshLoggingMiddleware(logger),
    new MeshCircuitBreakerMiddleware({ threshold: 5 }),
    new MeshCacheMiddleware(cacheService),
  ],
})
```

---

## Built-in Middleware

### Tracing

```ts
export class MeshTracingMiddleware implements MeshQueryMiddleware {
  name = "tracing";

  async execute<T>(ctx, next) {
    const span = this.tracer.startSpan(`mesh.query.${ctx.entityKey}`);
    try {
      const result = await next();
      span.setTag("items", result.items.length);
      span.finish();
      return result;
    } catch (err) {
      span.setTag("error", true);
      span.finish();
      throw err;
    }
  }
}
```

### Circuit Breaker

```ts
export class MeshCircuitBreakerMiddleware implements MeshQueryMiddleware {
  name = "circuit-breaker";

  async execute<T>(ctx, next) {
    if (this.isOpen(ctx.entityKey)) {
      throw new MeshCircuitOpenError(ctx.entityKey);
    }
    try {
      return await next();
    } catch (err) {
      this.recordFailure(ctx.entityKey);
      throw err;
    }
  }
}
```

---

# 38. Entity Relations Graph (Auto-Join Inference)

## Motivation

Manually writing join predicates is repetitive when relations are well-known.

If `Deployment` always joins `Service` via `serviceId`, the system should infer this automatically.

---

## Relation Declaration

```ts
// In meshEntity definition:

export const deploymentEntity = meshEntity({
  key: "deployments",
  item: deploymentSummarySchema,
  itemKey: "deploymentId",

  relations: {
    service: meshRelation({
      entity: () => serviceEntity,
      type: "belongs-to",
      on: (deployment, service) =>
        deployment.serviceId === service.serviceId,
    }),

    metrics: meshRelation({
      entity: () => deploymentMetricsEntity,
      type: "has-many",
      on: (deployment, metric) =>
        deployment.deploymentId === metric.deploymentId,
    }),
  },

  queries: { ... },
  mutations: { ... },
});
```

---

## Auto-Join API

```ts
// Instead of:
const result = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .join(
    discovery.from(ServiceMeshService.entities.services.queries.list),
    join => join.as("service").on((d, s) => d.serviceId === s.serviceId),
  )
  .execute();

// With auto-join:
const result = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .include("service")
  .include("metrics")
  .execute();
```

The system resolves the relation, builds the join, and stitches the result automatically.

---

## Relation Types

```ts
export type MeshRelationType =
  | "belongs-to"    // N:1 — result is TRelated | null
  | "has-many"      // 1:N — result is TRelated[]
  | "has-one"       // 1:1 — result is TRelated | null
  | "many-to-many"; // N:M — result is TRelated[]
```

---

## meshRelation Factory

```ts
export function meshRelation<
  TSourceItem,
  TRelatedEntity extends AnyMeshEntity,
>(config: {
  entity: () => TRelatedEntity;
  type: MeshRelationType;
  on: (
    source: TSourceItem,
    related: EntityItem<TRelatedEntity>,
  ) => boolean;
  through?: AnyMeshEntity; // for many-to-many
}): MeshRelation<TSourceItem, TRelatedEntity> { ... }
```

---

# 39. Optimistic Mutation Layer

## Motivation

In distributed UIs and reactive systems, mutations should feel instant.

The optimistic layer:

1. Immediately applies the mutation to the local query cache
2. Executes the real distributed mutation in the background
3. Reconciles the result when the mutation completes
4. Rolls back the optimistic update on failure

---

## API

```ts
await mesh
  .from(DeploymentMeshService.entities.deployments)
  .where({ deploymentId: "dep-1" })
  .update({ status: "stopping" })
  .optimistic({
    // Immediately patch local cache
    patch: (current) => ({ ...current, status: "stopping" }),
    // Rollback on failure
    onRollback: (original, error) => {
      logger.warn("Optimistic update rolled back", { error });
    },
  })
  .execute();
```

---

## Optimistic Cache

```ts
// mesh-optimistic-cache.ts

export class MeshOptimisticCache {
  private readonly patches = new Map<string, unknown>();

  apply(itemKey: string, patch: unknown): void {
    this.patches.set(itemKey, patch);
  }

  rollback(itemKey: string): void {
    this.patches.delete(itemKey);
  }

  get(itemKey: string): unknown | undefined {
    return this.patches.get(itemKey);
  }
}
```

The query executor checks the optimistic cache before returning results, merging any pending patches.

---

# 40. Distributed Saga / Transaction Coordinator

## Motivation

Some operations span multiple services and must be atomic:

* create a deployment AND create its routing entry AND notify the metrics service
* delete a service AND delete all its deployments AND purge its logs

These require distributed coordination with compensating actions on failure.

---

## Saga Builder API

```ts
const result = await mesh.saga()
  .step("create-deployment", async (ctx) => {
    const deployment = await mesh
      .from(DeploymentMeshService.entities.deployments)
      .create({ serviceId: "svc-1", environment: "prod" })
      .execute();

    ctx.set("deploymentId", deployment.result.deploymentId);
    return deployment;
  })
  .compensate("create-deployment", async (ctx) => {
    await mesh
      .from(DeploymentMeshService.entities.deployments)
      .where({ deploymentId: ctx.get("deploymentId") })
      .delete()
      .execute();
  })
  .step("create-routing", async (ctx) => {
    return mesh
      .from(RoutingMeshService.entities.routes)
      .create({
        deploymentId: ctx.get("deploymentId"),
        weight: 100,
      })
      .execute();
  })
  .compensate("create-routing", async (ctx) => {
    await mesh
      .from(RoutingMeshService.entities.routes)
      .where({ deploymentId: ctx.get("deploymentId") })
      .delete()
      .execute();
  })
  .execute();
```

---

## Saga Execution Model

```txt
Step 1 → success → Step 2 → success → Step 3 → FAILURE
                                              ↓
                              Compensate Step 3 (if defined)
                                              ↓
                              Compensate Step 2
                                              ↓
                              Compensate Step 1
                                              ↓
                              SagaRollbackComplete
```

---

## Saga Result

```ts
export interface MeshSagaResult<TContext> {
  success: boolean;
  completedSteps: string[];
  failedStep: string | null;
  compensatedSteps: string[];
  context: TContext;
  error: unknown | null;
  durationMs: number;
}
```

---

## Saga Context

```ts
export interface MeshSagaContext {
  set<T>(key: string, value: T): void;
  get<T>(key: string): T;
  has(key: string): boolean;
}
```

Typed saga contexts can be declared:

```ts
interface DeploymentSagaContext {
  deploymentId: string;
  routeId: string;
}

mesh.saga<DeploymentSagaContext>()
  .step("create-deployment", async (ctx) => {
    ctx.set("deploymentId", "dep-1"); // typed
  })
```

---

# 41. Query Plan Introspection

## Motivation

Developers need to understand what a query will do before executing it:

* which nodes will be contacted
* which strategy will be used
* which joins will execute
* estimated cost
* execution order

---

## API

```ts
const plan = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .join(services, join => join.as("service").on(...))
  .explain();

console.log(plan);
```

---

## Query Plan Shape

```ts
export interface MeshQueryPlan {
  entityKey: string;
  strategy: MeshQueryStrategy;
  estimatedNodes: number;
  whereClauses: MeshQueryPlanWhereClause[];
  joins: MeshQueryPlanJoin[];
  projections: string[] | null;
  ordering: MeshQueryPlanOrder[];
  pagination: { limit: number | null; offset: number | null };
  estimatedCostMs: number;
  warnings: MeshQueryPlanWarning[];
}

export interface MeshQueryPlanJoin {
  alias: string;
  entityKey: string;
  type: "left" | "inner";
  nestedPlan: MeshQueryPlan;
}

export interface MeshQueryPlanWarning {
  code: string;
  message: string;
  severity: "info" | "warn" | "error";
}
```

---

## Example Output

```txt
MeshQueryPlan {
  entityKey: "deployments",
  strategy: "broadcast-merge",
  estimatedNodes: 3,
  whereClauses: [{ field: "environment", op: "eq", value: "prod" }],
  joins: [
    {
      alias: "service",
      entityKey: "services",
      type: "left",
      nestedPlan: {
        entityKey: "services",
        strategy: "broadcast-merge",
        estimatedNodes: 3,
        whereClauses: [{ field: "archived", op: "eq", value: false }],
        joins: [],
        warnings: [],
      }
    }
  ],
  warnings: [
    {
      code: "CROSS_SERVICE_JOIN",
      message: "Join crosses service boundary — executed in-memory post-collection",
      severity: "info"
    }
  ]
}
```

---

# 42. Typed Event Subscriptions

## Motivation

Beyond live queries, consumers need to subscribe to specific entity lifecycle events:

* `deployment.created`
* `deployment.updated`
* `deployment.deleted`
* `deployment.status_changed`

These are strongly typed and entity-aware.

---

## API

```ts
mesh
  .on(DeploymentMeshService.entities.deployments)
  .event("created")
  .where({ environment: "prod" })
  .subscribe(event => {
    console.log("New deployment:", event.item);
  });
```

---

## Event Types

```ts
export type MeshEntityEventType =
  | "created"
  | "updated"
  | "deleted"
  | "status_changed"
  | "any";

export interface MeshEntityEvent<TItem> {
  type: MeshEntityEventType;
  item: TItem;
  previous: TItem | null;
  entityKey: string;
  timestamp: string;
  sourceNodeId: string;
  organizationId: string | null;
}
```

---

## Observable API

```ts
const deploymentEvents$ = mesh
  .on(DeploymentMeshService.entities.deployments)
  .event("updated")
  .where({ environment: "prod" })
  .asObservable();

deploymentEvents$.pipe(
  filter(e => e.item.status !== e.previous?.status),
  map(e => ({ id: e.item.deploymentId, from: e.previous?.status, to: e.item.status })),
).subscribe(change => {
  console.log("Status changed:", change);
});
```

---

## Entity Event Emitter (Service Side)

Services emit events by calling:

```ts
// Inside DeploymentMeshService handler:
this.emitEntityEvent(
  DeploymentMeshService.entities.deployments,
  "updated",
  {
    item: updatedDeployment,
    previous: previousDeployment,
    organizationId: "org-1",
  },
);
```

This is automatically available on `InternalBaseMeshService`.

---

# 43. Query Caching Layer

## Motivation

Repeated identical queries should not re-execute distributed calls.

The cache layer:

* caches by query fingerprint (entity + where + select + joins)
* supports TTL
* supports tag-based invalidation
* integrates with the middleware pipeline

---

## API

```ts
const result = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .cache({
    ttlMs: 5_000,
    tags: ["deployments", "prod"],
  })
  .execute();
```

---

## Cache Invalidation

```ts
// Invalidate by tag when a mutation completes:
await mesh
  .from(DeploymentMeshService.entities.deployments)
  .where({ deploymentId: "dep-1" })
  .update({ status: "stopped" })
  .invalidates(["deployments", "prod"])
  .execute();
```

---

## Cache Interface

```ts
export interface MeshQueryCache {
  get<T>(fingerprint: string): MeshQueryResult<T> | null;
  set<T>(fingerprint: string, result: MeshQueryResult<T>, ttlMs: number): void;
  invalidate(tags: string[]): void;
  clear(): void;
}
```

---

## Query Fingerprinting

```ts
// mesh-query-fingerprint.ts

export function fingerprintQuery(builder: MeshQueryBuilder<any, any>): string {
  return JSON.stringify({
    entityKey: builder.query.entityKey,
    methodName: builder.query.methodName,
    whereClauses: builder.whereClauses,
    selectedFields: builder.selectedFields,
    joins: builder.joins.map(j => fingerprintQuery(j.right as any)),
    orderBy: builder.orderBy,
    limit: builder.limit,
    offset: builder.offset,
  });
}
```

---

# 44. Enhanced Type Utilities

## New Type Helpers

```ts
// mesh-type-utils.ts

/** Extract the item type from a MeshEntity */
export type EntityItem<TEntity> =
  TEntity extends MeshEntity<any, infer TSchema, any, any, any>
    ? z.infer<TSchema>
    : never;

/** Extract the item key field name from a MeshEntity */
export type EntityItemKey<TEntity> =
  TEntity extends MeshEntity<any, any, infer TKey, any, any>
    ? TKey
    : never;

/** Extract the query names from a MeshEntity */
export type EntityQueryNames<TEntity> =
  TEntity extends MeshEntity<any, any, any, infer TQueries, any>
    ? keyof TQueries
    : never;

/** Extract the mutation names from a MeshEntity */
export type EntityMutationNames<TEntity> =
  TEntity extends MeshEntity<any, any, any, any, infer TMutations>
    ? keyof TMutations
    : never;

/** Extract the result shape of a builder */
export type BuilderResult<TBuilder> =
  TBuilder extends MeshQueryBuilder<any, infer TResult>
    ? TResult
    : never;

/** Extract the item type of a builder */
export type BuilderItem<TBuilder> =
  TBuilder extends MeshQueryBuilder<infer TItem, any>
    ? TItem
    : never;

/** Infer the join result shape given a base shape, alias, and joined shape */
export type WithJoin<
  TBase,
  TAlias extends string,
  TJoined,
  TType extends "left" | "inner" = "left",
> = TBase & Record<TAlias, TType extends "inner" ? TJoined : TJoined | null>;

/** Deep partial for where clauses */
export type MeshWhereInput<T> = {
  [K in keyof T]?: T[K] extends object ? MeshWhereInput<T[K]> : T[K];
};

/** Infer the aggregate result from an aggregate spec */
export type AggregateResult<TSpec extends Record<string, MeshAggregator<any>>> = {
  [K in keyof TSpec]: TSpec[K] extends MeshAggregator<infer R> ? R : never;
};
```

---

# 45. Updated File Structure (v3)

````
src/core/modules/mesh/
│
├── mesh-operation.ts
├── mesh-query.ts
├── mesh-mutation.ts
├── mesh-entity.ts
├── mesh-relation.ts                      ← NEW
├── mesh-entity.types.ts
├── mesh-query.types.ts
├── mesh-type-utils.ts                    ← NEW
│
├── query/
│   ├── mesh-query-builder.ts
│   ├── mesh-query-executor.ts
│   ├── mesh-query-join-executor.ts
│   ├── mesh-query-subquery.ts
│   ├── mesh-query-fingerprint.ts         ← NEW
│   ├── mesh-query-plan.ts                ← NEW
│   ├── mesh-where.ts
│   ├── mesh-select.ts
│   ├── mesh-order.ts
│   ├── mesh-pagination.ts
│   └── mesh-aggregate.ts                 ← NEW
│
├── live/
│   ├── mesh-live-query.ts                ← NEW
│   └── mesh-entity-event-bus.ts          ← NEW
│
├── mutation/
│   ├── mesh-mutation-builder.ts          ← NEW
│   ├── mesh-mutation-executor.ts         ← NEW
│   └── mesh-optimistic-cache.ts          ← NEW
│
├── saga/
│   ├── mesh-saga-builder.ts              ← NEW
│   ├── mesh-saga-executor.ts             ← NEW
│   └── mesh-saga-context.ts              ← NEW
│
├── middleware/
│   ├── mesh-query-middleware.ts          ← NEW
│   ├── mesh-tracing-middleware.ts        ← NEW
│   ├── mesh-logging-middleware.ts        ← NEW
│   ├── mesh-circuit-breaker-middleware.ts ← NEW
│   └── mesh-cache-middleware.ts          ← NEW
│
├── cache/
│   ├── mesh-query-cache.ts               ← NEW
│   └── mesh-query-cache.types.ts         ← NEW
│
├── events/
│   ├── mesh-entity-event.ts              ← NEW
│   ├── mesh-entity-event-emitter.ts      ← NEW
│   └── mesh-entity-event-subscriber.ts   ← NEW
│
├── services/
│   ├── base-mesh.service.ts
│   └── system-mesh-resource-discovery.service.ts
│
└── tokens.ts
````

---

# 46. Updated Implementation Order (v3)

## Phase 1 — Core Primitives *(unchanged)*
- `meshOperation`, `meshQuery`, `meshMutation`, `meshEntity`
- Type inference pipeline
- `meshRelation` ← **new**

## Phase 2 — Transport Layer *(unchanged)*
- `BaseMeshService` update
- Internal topic derivation
- Entity event emission hooks ← **new**

## Phase 3 — Query Builder *(unchanged)*
- Builder, where, select, order, pagination

## Phase 4 — Join & Subquery System *(unchanged)*
- Builder-based joins, nested joins, `include()` via relations ← **new**

## Phase 5 — Execution Engine *(unchanged)*
- Executor, deduplication, streaming

## Phase 6 — Aggregation Engine ← **new**
- Aggregation primitives
- Two-phase distributed aggregation
- `AggregateBuilder`

## Phase 7 — Mutation Layer ← **new**
- `MeshMutationBuilder`
- Optimistic cache
- `MeshMutationExecutor`

## Phase 8 — Saga Coordinator ← **new**
- `MeshSagaBuilder`
- `MeshSagaExecutor`
- Compensation chain

## Phase 9 — Reactive Layer ← **new**
- `MeshLiveQueryEngine`
- `MeshEntityEventBus`
- Typed event subscriptions

## Phase 10 — Middleware & Cache ← **new**
- Middleware pipeline
- Query fingerprinting
- `MeshQueryCache`
- Built-in middleware (tracing, circuit breaker, logging)

## Phase 11 — Introspection ← **new**
- `explain()` / `MeshQueryPlan`
- Plan warnings
- Cost estimation

## Phase 12 — Public API Stabilization
- Discovery service
- DI registration
- Module configuration
- Documentation

---

# Updated Invariants (v3 Additions)

| # | Invariant |
|---|---|
| I11 | Live queries are always consistent with the last known distributed state |
| I12 | Aggregations execute in two phases — partial on nodes, merge on caller |
| I13 | Middleware is composable and order-preserving |
| I14 | Relations declared on entities are the single source of truth for auto-joins |
| I15 | Optimistic mutations always roll back on failure |
| I16 | Sagas always execute compensating actions in reverse step order |
| I17 | Query plans are always computable without executing the query |
| I18 | Event subscriptions are always scoped to entity + event type |
| I19 | Cache invalidation is always tag-driven, never key-driven |
| I20 | All new capabilities compose with all existing builder methods |

---

# Complete v3 Developer Experience

The final API surface, combining all layers:

```ts
// 1. Live reactive query with auto-join via relations
const deployments$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .include("service")
  .include("metrics")
  .cache({ ttlMs: 3_000, tags: ["deployments"] })
  .live({ debounceMs: 200 });

// 2. Distributed aggregation
const stats = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .aggregate({
    total: count(),
    byStatus: groupBy("status", count()),
    avgReplicas: avg("replicaCount"),
  })
  .execute();

// 3. Optimistic mutation with cache invalidation
await mesh
  .from(DeploymentMeshService.entities.deployments)
  .where({ deploymentId: "dep-1" })
  .update({ status: "stopping" })
  .optimistic({ patch: c => ({ ...c, status: "stopping" }) })
  .invalidates(["deployments"])
  .execute();

// 4. Distributed saga
await mesh.saga<{ deploymentId: string }>()
  .step("create", async ctx => {
    const r = await mesh
      .from(DeploymentMeshService.entities.deployments)
      .create({ serviceId: "svc-1", environment: "prod" })
      .execute();
    ctx.set("deploymentId", r.result.deploymentId);
  })
  .compensate("create", async ctx => {
    await mesh
      .from(DeploymentMeshService.entities.deployments)
      .where({ deploymentId: ctx.get("deploymentId") })
      .delete()
      .execute();
  })
  .execute();

// 5. Query plan introspection
const plan = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .include("service")
  .explain();

// 6. Typed event subscription
mesh
  .on(DeploymentMeshService.entities.deployments)
  .event("updated")
  .where({ environment: "prod" })
  .asObservable()
  .pipe(filter(e => e.item.status !== e.previous?.status))
  .subscribe(e => console.log("Status changed:", e));
```

and 

import type { z, ZodType } from "zod";
import type { MeshQuery, AnyMeshQuery } from "./mesh-query";
import type { MeshMutation, AnyMeshMutation } from "./mesh-mutation";
import type {
  MeshResourceOwnership,
  MeshEventSourceConfig,
  MeshEventSourceType,
} from "./mesh-resource-definition";

// ─── Re-exports from resource definition ──────────────────────────────────────

export type {
  MeshResourceOwnership,
  MeshEventSourceConfig,
  MeshEventSourceType,
} from "./mesh-resource-definition";

// ─── Resource Scope Types (legacy, use MeshResourceOwnership instead) ─────────

/**
 * @deprecated Use MeshResourceOwnership instead for more flexibility
 */
export type MeshResourceScope = "global" | "node-owned";

/**
 * @deprecated Use MeshResourceOwnership instead
 */
export interface MeshResourceConfig<TScope extends MeshResourceScope = MeshResourceScope> {
  /** How this resource is distributed across the mesh */
  readonly scope: TScope;

  /** For global resources: whether real-time subscriptions are supported */
  readonly subscriptions?: TScope extends "global" ? boolean : never;

  /** For node-owned resources: the field that identifies which node owns the item */
  readonly nodeIdField?: TScope extends "node-owned" ? string : never;
}

// ─── Core interface ───────────────────────────────────────────────────────────

/**
 * A distributed queryable entity — the primary abstraction exposed to users.
 *
 * @param TKey       - Literal string key identifying this entity (e.g. "deployments")
 * @param TItemSchema - Zod schema for the entity's item type
 * @param TItemKey   - The field name that uniquely identifies an item (e.g. "deploymentId")
 * @param TQueries   - Map of query operations this entity supports
 * @param TMutations - Map of mutation operations this entity supports
 * @param TScope     - Resource scope: "global" or "node-owned"
 */
export interface MeshEntity<
  TKey extends string,
  TItemSchema extends ZodType,
  TItemKey extends keyof z.infer<TItemSchema> & string,
  TQueries extends Record<string, AnyMeshQuery>,
  TMutations extends Record<string, AnyMeshMutation>,
  TScope extends MeshResourceScope = MeshResourceScope,
> {
  readonly key: TKey;
  readonly item: TItemSchema;
  readonly itemKey: TItemKey;
  readonly queries: TQueries;
  readonly mutations: TMutations;
  readonly config: MeshResourceConfig<TScope>;
}

// ─── Any-type alias ───────────────────────────────────────────────────────────

/**
 * Unconstrained mesh entity type.
 * Uses 'never' for TItemKey because we can't verify the key constraint
 * without knowing the specific item schema. Concrete entities will have the
 * correct constrained key.
 */
export type AnyMeshEntity = MeshEntity<string, ZodType, never, Record<string, AnyMeshQuery>, Record<string, AnyMeshMutation>, MeshResourceScope>;

// ─── Type transformers for bound queries/mutations ────────────────────────────

/**
 * Transforms a record of MeshQueries into BoundMeshQueries.
 * This represents the type after meshEntity() has attached metadata.
 */
export type BoundEntityQueries<
  TQueries extends Record<string, AnyMeshQuery>,
  TItem,
> = {
  [K in keyof TQueries]: TQueries[K] extends MeshQuery<infer TIn, infer TOut>
    ? BoundMeshQuery<TItem, TIn, TOut>
    : never;
};

/**
 * Transforms a record of MeshMutations into BoundMeshMutations.
 */
export type BoundEntityMutations<
  TMutations extends Record<string, AnyMeshMutation>,
  TItem,
> = {
  [K in keyof TMutations]: TMutations[K] extends MeshMutation<infer TIn, infer TOut>
    ? BoundMeshMutation<TItem, TIn, TOut>
    : never;
};

// ─── Item type extraction ─────────────────────────────────────────────────────

/** Extract the inferred item type from a MeshEntity */
export type MeshEntityItem<TEntity extends AnyMeshEntity> =
  TEntity extends MeshEntity<string, infer TSchema, never, any, any>
    ? z.infer<TSchema>
    : never;

/** Extract the itemKey field name from a MeshEntity */
export type MeshEntityItemKey<TEntity extends AnyMeshEntity> =
  TEntity extends MeshEntity<string, ZodType, infer TKey, any, any>
    ? TKey
    : string;

/** Extract query method names from a MeshEntity */
export type MeshEntityQueryNames<TEntity extends AnyMeshEntity> =
  TEntity extends MeshEntity<string, any, any, infer TQueries, any>
    ? keyof TQueries
    : never;

/** Extract mutation method names from a MeshEntity */
export type MeshEntityMutationNames<TEntity extends AnyMeshEntity> =
  TEntity extends MeshEntity<string, any, any, any, infer TMutations>
    ? keyof TMutations
    : never;

// ─── Bound Query/Mutation Types ───────────────────────────────────────────────

/**
 * A MeshQuery that has been bound to an entity by meshEntity().
 * All optional fields are now guaranteed to be present.
 */
export type BoundMeshQuery<
  TItem,
  TInputSchema extends ZodType = ZodType,
  TOutputSchema extends ZodType = ZodType,
> = AnyMeshQuery & {
  readonly itemSchema: z.ZodType<TItem>;
  readonly entityKey: string;
  readonly methodName: string;
  readonly itemKey: string;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;
};

/**
 * A MeshMutation that has been bound to an entity by meshEntity().
 */
export type BoundMeshMutation<
  TItem,
  TInputSchema extends ZodType = ZodType,
  TOutputSchema extends ZodType = ZodType,
> = AnyMeshMutation & {
  readonly itemSchema: z.ZodType<TItem>;
  readonly entityKey: string;
  readonly methodName: string;
  readonly itemKey: string;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a distributed queryable entity.
 *
 * Attaches routing metadata (`entityKey`, `methodName`, `itemSchema`, `itemKey`)
 * to every query and mutation so the discovery service can derive topics and
 * build typed query builders without any string literals.
 *
 * @example
 * // Node-owned resource (distributed across mesh nodes)
 * const deployments = meshEntity({
 *   key: "deployments",
 *   item: deploymentSchema,
 *   itemKey: "deploymentId",
 *   config: { scope: "node-owned", nodeIdField: "nodeId" },
 *   queries: { ... },
 *   mutations: { ... },
 * });
 *
 * @example
 * // Global resource (centralized, supports subscriptions)
 * const projects = meshEntity({
 *   key: "projects",
 *   item: projectSchema,
 *   itemKey: "projectId",
 *   config: { scope: "global", subscriptions: true },
 *   queries: { ... },
 *   mutations: { ... },
 * });
 */
export function meshEntity<
  TKey extends string,
  TItemSchema extends ZodType,
  TItemKey extends keyof z.infer<TItemSchema> & string,
  TQueries extends Record<string, AnyMeshQuery>,
  TMutations extends Record<string, AnyMeshMutation>,
  TScope extends MeshResourceScope = "node-owned",
>(config: {
  key: TKey;
  item: TItemSchema;
  itemKey: TItemKey;
  queries: TQueries;
  mutations: TMutations;
  config?: MeshResourceConfig<TScope>;
}): MeshEntity<
  TKey,
  TItemSchema,
  TItemKey,
  BoundEntityQueries<TQueries, z.infer<TItemSchema>>,
  BoundEntityMutations<TMutations, z.infer<TItemSchema>>,
  TScope
> {
  type TItem = z.infer<TItemSchema>;

  // Type the entity properly with the transformed query/mutation types
  type ResultEntity = MeshEntity<
    TKey,
    TItemSchema,
    TItemKey,
    BoundEntityQueries<TQueries, TItem>,
    BoundEntityMutations<TMutations, TItem>,
    TScope
  >;

  // Create the entity with default config
  const entity = {
    ...config,
    config: config.config ?? ({ scope: "node-owned" } as MeshResourceConfig<TScope>),
  } as unknown as ResultEntity;

  // Attach routing metadata to each query for topic derivation
  for (const [name, query] of Object.entries(entity.queries)) {
    (query as AnyMeshQuery).entityKey = entity.key;
    (query as AnyMeshQuery).methodName = name;
    (query as AnyMeshQuery).itemSchema = entity.item;
    (query as AnyMeshQuery).itemKey = entity.itemKey;
  }

  // Attach routing metadata to each mutation
  for (const [name, mutation] of Object.entries(entity.mutations)) {
    (mutation as AnyMeshMutation).entityKey = entity.key;
    (mutation as AnyMeshMutation).methodName = name;
    (mutation as AnyMeshMutation).itemSchema = entity.item;
    (mutation as AnyMeshMutation).itemKey = entity.itemKey;
  }

  return entity;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENHANCED ENTITY FACTORY WITH EVENT SOURCES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Event source registry attached to entities.
 */
export interface MeshEntityEventSources<
  TItem,
  TSources extends Record<string, MeshEventSourceConfig> = Record<string, MeshEventSourceConfig>,
> {
  /** Registry of event sources */
  readonly sources: TSources;
  
  /** Get event types that can be emitted */
  getEventTypes(): Array<"created" | "updated" | "deleted" | keyof TSources>;
  
  /** Check if a specific event type is supported */
  supportsEvent(type: string): boolean;
  
  /** Get observable for specific event source */
  getSourceObservable<TPayload>(
    sourceName: keyof TSources
  ): import("rxjs").Observable<{
    readonly type: string;
    readonly item: TItem;
    readonly payload: TPayload;
    readonly timestamp: string;
    readonly sourceNodeId: string;
  }>;
}

/**
 * Enhanced mesh entity with event source support.
 */
export interface EnhancedMeshEntity<
  TKey extends string,
  TItemSchema extends ZodType,
  TItemKey extends keyof z.infer<TItemSchema> & string,
  TOwnership extends MeshResourceOwnership,
  TQueries extends Record<string, AnyMeshQuery>,
  TMutations extends Record<string, AnyMeshMutation>,
  TEventSources extends Record<string, MeshEventSourceConfig>,
> extends MeshEntity<
  TKey,
  TItemSchema,
  TItemKey,
  TQueries,
  TMutations,
  TOwnership extends { type: "global" } ? "global" :
  TOwnership extends { type: "node-owned" } ? "node-owned" :
  MeshResourceScope
> {
  /** Event source configuration and registry */
  readonly events: MeshEntityEventSources<z.infer<TItemSchema>, TEventSources>;
  
  /** Ownership configuration (typed) */
  readonly ownership: TOwnership;
}

/**
 * Configuration for enhanced mesh entity.
 */
export interface EnhancedMeshEntityConfig<
  TItemSchema extends ZodType,
  TOwnership extends MeshResourceOwnership,
  TEventSources extends Record<string, MeshEventSourceConfig>,
> {
  /** Entity key */
  readonly key: string;
  
  /** Zod schema for items */
  readonly item: TItemSchema;
  
  /** Key field name */
  readonly itemKey: keyof z.infer<TItemSchema> & string;
  
  /** Ownership configuration */
  readonly ownership: TOwnership;
  
  /** Query definitions */
  readonly queries?: Record<string, AnyMeshQuery>;
  
  /** Mutation definitions */
  readonly mutations?: Record<string, AnyMeshMutation>;
  
  /** Event source configurations */
  readonly eventSources?: TEventSources;
}

/**
 * Creates an enhanced mesh entity with full event source support.
 * 
 * @example
 * const deployments = meshEntityEnhanced({
 *   key: "deployments",
 *   item: deploymentSchema,
 *   itemKey: "deploymentId",
 *   ownership: { type: "node-owned", ownerField: "nodeId" },
 *   queries: { list, findById },
 *   mutations: { create, update, delete },
 *   eventSources: {
 *     mutations: {
 *       type: "mutation",
 *       schema: mutationEventSchema,
 *       emitsCreated: true,
 *       emitsUpdated: true,
 *       emitsDeleted: true,
 *       config: { mutations: ["create", "update", "delete"], includePreviousState: true }
 *     },
 *     webhooks: {
 *       type: "external",
 *       schema: webhookSchema,
 *       emitsCreated: false,
 *       emitsUpdated: true,
 *       emitsDeleted: false,
 *       config: { system: "github", webhookPath: "/webhooks/github" }
 *     }
 *   }
 * });
 */
export function meshEntityEnhanced<
  TItemSchema extends ZodType,
  TOwnership extends MeshResourceOwnership,
  TEventSources extends Record<string, MeshEventSourceConfig>,
>(
  config: EnhancedMeshEntityConfig<TItemSchema, TOwnership, TEventSources>
): EnhancedMeshEntity<
  string,
  TItemSchema,
  keyof z.infer<TItemSchema> & string,
  TOwnership,
  Record<string, AnyMeshQuery>,
  Record<string, AnyMeshMutation>,
  TEventSources
> {
  type TItem = z.infer<TItemSchema>;
  
  // Create base entity with legacy config format for backward compatibility
  const legacyScope: MeshResourceScope = config.ownership.type === "global" ? "global" : "node-owned";
  const legacyConfig: MeshResourceConfig<typeof legacyScope> = {
    scope: legacyScope,
    ...(config.ownership.type === "global" && { subscriptions: true }),
    ...(config.ownership.type === "node-owned" && { nodeIdField: config.ownership.ownerField }),
  };

  const baseEntity = meshEntity({
    key: config.key,
    item: config.item,
    itemKey: config.itemKey,
    queries: config.queries ?? {},
    mutations: config.mutations ?? {},
    config: legacyConfig,
  });

  // Create event source registry
  const eventSources = config.eventSources ?? {} as TEventSources;
  
  const events: MeshEntityEventSources<TItem, TEventSources> = {
    sources: eventSources,
    
    getEventTypes() {
      const types = new Set<string>(["created", "updated", "deleted"]);
      
      for (const [name, source] of Object.entries(eventSources)) {
        if (source.emitsCreated) types.add(`${name}:created`);
        if (source.emitsUpdated) types.add(`${name}:updated`);
        if (source.emitsDeleted) types.add(`${name}:deleted`);
      }
      
      return Array.from(types) as Array<"created" | "updated" | "deleted" | keyof TEventSources>;
    },
    
    supportsEvent(type: string): boolean {
      return this.getEventTypes().includes(type as never);
    },
    
    getSourceObservable<TPayload>(sourceName: keyof TEventSources) {
      const source = eventSources[sourceName];
      if (!source) {
        throw new Error(`Event source "${String(sourceName)}" not found on entity "${config.key}"`);
      }
      
      // This would be connected to the actual event stream in a real implementation
      // For now, return a placeholder that would be replaced by the mesh infrastructure
      const { Subject } = require("rxjs");
      return new Subject<{
        readonly type: string;
        readonly item: TItem;
        readonly payload: TPayload;
        readonly timestamp: string;
        readonly sourceNodeId: string;
      }>().asObservable();
    },
  };

  // Build enhanced entity
  const enhancedEntity = {
    ...baseEntity,
    ownership: config.ownership,
    events,
  } as EnhancedMeshEntity<
    string,
    TItemSchema,
    keyof z.infer<TItemSchema> & string,
    TOwnership,
    Record<string, AnyMeshQuery>,
    Record<string, AnyMeshMutation>,
    TEventSources
  >;

  return enhancedEntity;
}

we should as well have somethings like a server side filtering as well to avoid sending all event for a type when the consumer only want a subtype.
also can we add posibilities to just enhance already opend stream to be able to send for data for one stream instead of opeing a new one. each stream should have unique id etc etc


# Mesh Resource Discovery & Distributed Query Architecture — v4

> **Status:** Design finalized, implementation pending
> **Scope:** All v3 concepts + Shared SSE Stream Registry, Server-Side Filter Pushdown, Stream Enhancement Protocol, Typed Stream IDs
> **Goal:** Zero-redundant-connections distributed execution engine — one SSE stream per unique filter scope, shared across all consumers

---

# Table of Contents

1. Vision & Architectural Direction
2. Core Concept Shift — Services Are Distributed Table Groups
3. Problems With The Previous Model (+ v4 additions)
4. High-Level Architecture
5. Core Design Principles
6. `meshOperation()` Primitive
7. `meshEntity()` — Distributed Entity/Table Definition
8. Service Structure — Multiple Queryable Entities Per Service
9. Operation System
10. Complete Type Inference Pipeline
11. Static Service Metadata
12. Query Manifest System
13. Updated `BaseMeshService`
14. Internal Topic Derivation
15. Distributed Query Builder
16. Scope & Strategy System
17. Where System
18. Select System
19. Ordering & Pagination
20. Subqueries
21. Join System (Builder-Based)
22. Nested Joins
23. Join Type Inference
24. Execution Engine
25. Distributed Deduplication
26. Result Shapes
27. Streaming Queries
28. Discovery Service
29. Registration & Dependency Injection
30. Full End-to-End Examples
31. Reactive Live Query System
32. Distributed Aggregation Engine
33. Query Middleware Pipeline
34. Entity Relations Graph (Auto-Join Inference)
35. Optimistic Mutation Layer
36. Distributed Saga / Transaction Coordinator
37. Query Plan Introspection
38. Typed Event Subscriptions
39. Query Caching Layer
40. Enhanced Type Utilities
41. **[NEW] Shared SSE Stream Registry**
42. **[NEW] Stream Identity & Unique Stream IDs**
43. **[NEW] Server-Side Filter Pushdown**
44. **[NEW] Stream Enhancement Protocol**
45. **[NEW] Stream Multiplexing & Reference Counting**
46. **[NEW] Stream Store API**
47. File Structure (v4)
48. Implementation Order (v4)
49. Invariants & Guarantees (v4)

---

# 1. Vision & Architectural Direction

The mesh layer models distributed systems as a **distributed relational surface** composed of queryable entities.

Every mesh service behaves conceptually like a distributed database schema, exposing not individual RPCs but entire entity graphs: deployments, deployment logs, deployment replicas, deployment metrics, etc.

In v4, the transport layer gains a critical optimization: **SSE streams are shared resources, not per-consumer connections**. When multiple consumers subscribe to the same entity with compatible filters, they all share a single underlying SSE stream. The system maintains a **Stream Registry** that tracks open connections by their filter fingerprint. New consumers attach to an existing stream rather than opening a new one.

Additionally, streams support **server-side filter pushdown** — the consumer declares its filter intent to the server, so only matching events travel the wire. And streams support **enhancement** — an already-open stream can be extended with additional subscriptions without tearing down and re-opening the connection.

---

# 2. Core Concept Shift — Services Are Distributed Table Groups

*(unchanged from v3)*

A mesh service represents a namespace of distributed entities, not a list of RPC methods:

```
DeploymentMeshService
 ├─ deployments
 ├─ deploymentLogs
 ├─ deploymentReplicas
 ├─ deploymentMetrics
 ├─ deploymentEvents
 ├─ deploymentRouting
 ├─ deploymentSnapshots
 └─ deploymentHealth
```

Each entity behaves like a distributed table: it has its own item type, item key, operations, join capabilities, and — in v4 — its own server-side filter contract.

---

# 3. Problems With The Previous Model

## Problems 1–4 (v2/v3 — unchanged)

See v2/v3 for: single-entity services, stringly-typed operations, service-oriented joins, transport layer leakage.

---

## Problem 5 — One SSE Stream Per Consumer (NEW)

In the previous model, every `.listen()` call unconditionally opens a new SSE stream to the target node(s), even when an identical stream is already open for another consumer with the same filters.

**Scenario:**

```
Consumer A: discovery.from(deployments).where({ environment: "prod" }).listen()
Consumer B: discovery.from(deployments).where({ environment: "prod" }).listen()
```

This opens **two separate SSE streams** to the same set of nodes with identical filter parameters — wasteful, redundant, and a source of connection exhaustion under scale.

**The fix (v4):** A `SharedStreamRegistry` holds open streams keyed by a deterministic stream fingerprint. Consumer B reuses Consumer A's already-open stream. When both unsubscribe, the stream is finally closed.

---

## Problem 6 — All Events Transferred for Server-Side Filtering (NEW)

In the previous model, server-side filter pushdown was not part of the SSE contract. The server would broadcast all events for an entity type, and filtering happened on the consumer side (inside the RxJS pipeline).

**Consequence:** High-volume entity streams (e.g. `LiveTraefikMetrics`) transfer every event to every consumer, even when each consumer only cares about a fraction of those events.

**The fix (v4):** The SSE stream protocol includes a **server-side filter descriptor**. The server evaluates this filter before emitting, so only matching events travel the wire.

---

## Problem 7 — Streams Cannot Be Enhanced (NEW)

Once an SSE stream is open, its scope is fixed. Adding a new subscription to a related entity or a wider filter set requires tearing down the stream and opening a fresh one.

**The fix (v4):** Streams support an **enhancement protocol**. A consumer can send a `STREAM_ENHANCE` message to the server over an existing stream to add new subscription scopes, change filter clauses, or add entity types — without interrupting the existing flow of events.

---

# 4. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                SystemMeshResourceDiscoveryService            │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                      MeshQueryBuilder                        │
│  where()  join()  orderBy()  select()  limit()  live()       │
│  stream() execute() explain() aggregate()                    │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐  ← NEW
│                    SharedStreamRegistry                      │
│                                                              │
│  lookup(fingerprint) → SharedStream | null                   │
│  acquire(fingerprint, spec) → SharedStream                   │
│  enhance(streamId, enhancement) → void                       │
│  release(streamId, consumerId) → void                        │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                     MeshQueryExecutor                        │
│  strategy resolution  distributed execution  deduplication   │
│  filtering  joins  pagination  projections                   │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                       BaseMeshService                        │
│  registerEntity()  callEntity()  distributed transport       │
│  correlation handling  cancellation  SSE server              │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│              Mesh Topic & SSE Infrastructure                 │
│  Server-Side Filter Pushdown  Stream Enhancement Protocol    │
└──────────────────────────────────────────────────────────────┘
```

---

# 5. Core Design Principles

*(v3 principles preserved; v4 additions follow)*

- **P1** — Services are distributed schemas
- **P2** — Entities are first-class
- **P3** — Builders are composable
- **P4** — Transport is infrastructure
- **P5** — No string literals
- **P6** — Everything inferable should be inferred
- **P7 (NEW)** — Streams are shared resources, not per-consumer connections
- **P8 (NEW)** — Filtering happens as early as possible — at the server, not the consumer
- **P9 (NEW)** — Streams are enhanceable without reconnection

---

# 6–40. Core Architecture (v3 — Preserved)

All content from v2 and v3 remains valid and unchanged, covering:

- `meshOperation()`, `meshQuery()`, `meshMutation()`, `meshEntity()`, `meshEntityEnhanced()`
- Distributed query builder, where/select/orderBy/pagination systems
- Join system (builder-based), nested joins, join type inference
- Execution engine, distributed deduplication, streaming
- Reactive live query system, aggregation engine, middleware pipeline
- Entity relations graph, optimistic mutations, distributed saga
- Query plan introspection, typed event subscriptions, query caching
- Full type utilities and DI registration

---

# 41. Shared SSE Stream Registry (NEW)

## 41.1 Motivation

SSE connections are expensive:

- Each SSE connection occupies a socket on both the client proxy and the target node
- Nodes maintain per-connection event fan-out state
- At scale, hundreds of UI components subscribing independently to the same entity can saturate connection limits

The `SharedStreamRegistry` ensures that for any given **stream fingerprint** (entity + filter + scope), at most one SSE connection is open at a time, regardless of how many consumers have called `.listen()` or `.live()`.

---

## 41.2 SharedStream Concept

```typescript
/**
 * A single SSE connection shared across one or more consumers.
 * Identified by a globally unique stream ID and a fingerprint derived
 * from the entity key, filters, and target nodes.
 */
export interface SharedStream<TEvent = unknown> {
  /** Globally unique ID for this stream (UUID v4) */
  readonly id: MeshStreamId;

  /** Human-readable fingerprint used for deduplication */
  readonly fingerprint: string;

  /** The entity key this stream is bound to */
  readonly entityKey: string;

  /** Server-side filter descriptor sent to the node */
  readonly serverFilter: MeshServerFilter;

  /** Target node(s) this SSE connection reaches */
  readonly targets: NodeTarget[];

  /** How many active consumers hold a reference to this stream */
  readonly refCount: number;

  /** When this stream was opened */
  readonly openedAt: Date;

  /** The raw RxJS Subject that all consumer Observables derive from */
  readonly source$: import("rxjs").Subject<TEvent>;

  /** Current lifecycle status */
  readonly status: "connecting" | "open" | "degraded" | "closed";
}
```

---

## 41.3 SharedStreamRegistry Interface

```typescript
export interface SharedStreamRegistry {
  /**
   * Look up an existing stream by fingerprint.
   * Returns null if no stream is open for that fingerprint.
   */
  lookup<T>(fingerprint: string): SharedStream<T> | null;

  /**
   * Acquire a stream for the given spec.
   * Returns an existing stream if one matches the fingerprint,
   * or opens a new SSE connection and registers it.
   * Increments the reference count for the returned stream.
   */
  acquire<T>(spec: StreamAcquisitionSpec): Promise<SharedStream<T>>;

  /**
   * Release a consumer's reference to a stream.
   * Decrements the reference count. When count reaches zero,
   * the SSE connection is closed and the stream is evicted.
   */
  release(streamId: MeshStreamId, consumerId: MeshConsumerId): void;

  /**
   * Enhance an existing stream with additional subscription scopes
   * without tearing down the SSE connection.
   * See section 44 for full protocol.
   */
  enhance(streamId: MeshStreamId, enhancement: StreamEnhancement): Promise<void>;

  /**
   * List all currently open streams (for diagnostics / introspection).
   */
  listOpen(): SharedStream[];

  /**
   * Observe stream lifecycle events across the registry.
   */
  lifecycle$: import("rxjs").Observable<StreamLifecycleEvent>;
}
```

---

## 41.4 Stream Acquisition Spec

```typescript
export interface StreamAcquisitionSpec {
  /** Entity and method being subscribed */
  entityKey: string;
  methodName: string;

  /**
   * Server-side filter to push down.
   * The server will only emit events matching this filter.
   */
  serverFilter: MeshServerFilter;

  /** Resolved target nodes for this query */
  targets: NodeTarget[];

  /** Ownership strategy (global / node-owned / sharded / replicated) */
  strategy: MeshQueryStrategy;

  /** Optional TTL before an idle stream (refCount === 0) is closed. Default: 0ms (immediate). */
  idleTtlMs?: number;
}
```

---

## 41.5 Fingerprint Derivation

The fingerprint is a deterministic, canonical hash of all fields that make two streams equivalent:

```typescript
// mesh-stream-fingerprint.ts

export function deriveStreamFingerprint(spec: StreamAcquisitionSpec): string {
  const canonical = {
    entityKey: spec.entityKey,
    methodName: spec.methodName,
    // Sort filter keys so { a:1, b:2 } === { b:2, a:1 }
    serverFilter: sortedDeep(spec.serverFilter),
    // Sort targets so order doesn't matter
    targets: [...spec.targets].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
    strategy: spec.strategy,
  };

  return deterministicHash(canonical); // e.g. SHA-256 truncated to 16 chars
}
```

Two `.listen()` calls with the same entity + filters + target nodes produce **identical fingerprints** and therefore share the same `SharedStream`.

---

## 41.6 Lifecycle Flow

```
Consumer A calls .listen()
  → fingerprint computed
  → registry.lookup(fingerprint) → null
  → registry.acquire(spec) → opens SSE, stores SharedStream, refCount=1
  → returns Observable derived from SharedStream.source$

Consumer B calls .listen() with same params
  → fingerprint computed (same)
  → registry.lookup(fingerprint) → SharedStream (refCount=1)
  → registry.acquire() → reuses stream, refCount=2
  → returns Observable derived from SharedStream.source$

Consumer A unsubscribes
  → registry.release(streamId, consumerA) → refCount=1

Consumer B unsubscribes
  → registry.release(streamId, consumerB) → refCount=0
  → SSE connection closed, stream evicted from registry
```

---

## 41.7 Idle TTL

For streams where brief reconnects are expensive (e.g. sharded fan-out to 10+ nodes), an `idleTtlMs` can be set so the stream stays open briefly even with zero consumers, anticipating reuse:

```typescript
registry.acquire({
  ...spec,
  idleTtlMs: 5_000, // keep alive for 5s after last consumer detaches
});
```

This is useful for paginated UIs where the user navigates between pages rapidly.

---

# 42. Stream Identity & Unique Stream IDs (NEW)

## 42.1 MeshStreamId

Every stream is identified by a globally unique ID:

```typescript
/** Opaque branded type for stream identifiers */
export type MeshStreamId = string & { readonly __brand: "MeshStreamId" };

/** Opaque branded type for consumer identifiers within a stream */
export type MeshConsumerId = string & { readonly __brand: "MeshConsumerId" };

export function generateStreamId(): MeshStreamId {
  return crypto.randomUUID() as MeshStreamId;
}

export function generateConsumerId(): MeshConsumerId {
  return crypto.randomUUID() as MeshConsumerId;
}
```

---

## 42.2 Stream ID Propagation

The stream ID is threaded through the entire lifecycle:

- Included in every SSE event emitted on that stream (as `streamId` in the envelope)
- Referenced in enhancement requests
- Visible in query plan introspection (`.explain()`)
- Emitted in stream lifecycle events for observability

```typescript
/** Every event emitted on a shared stream carries this envelope */
export interface MeshStreamEnvelope<TPayload = unknown> {
  readonly streamId: MeshStreamId;
  readonly consumerId?: MeshConsumerId; // set only for unicast enhancements
  readonly entityKey: string;
  readonly eventType: string;
  readonly payload: TPayload;
  readonly timestamp: string;
  readonly sourceNodeId: string;
  readonly serverFilterApplied: boolean; // did server filter reduce this event?
}
```

---

## 42.3 Stream Diagnostics

```typescript
// Access stream ID from an active subscription
const stream$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .listen();

// The builder exposes stream metadata after subscription
const handle = stream$.connect(); // returns StreamHandle
console.log(handle.streamId);    // "f3a2c1d0-..."
console.log(handle.fingerprint); // "9f3b4a..."
console.log(handle.refCount);    // 2 (this + another consumer sharing it)
console.log(handle.status);      // "open"
```

---

## 42.4 Stream Lifecycle Events

```typescript
export type StreamLifecycleEvent =
  | { type: "stream_opened";   streamId: MeshStreamId; fingerprint: string; entityKey: string }
  | { type: "stream_closed";   streamId: MeshStreamId; reason: "no_consumers" | "error" | "manual" }
  | { type: "consumer_attached";  streamId: MeshStreamId; consumerId: MeshConsumerId; refCount: number }
  | { type: "consumer_detached";  streamId: MeshStreamId; consumerId: MeshConsumerId; refCount: number }
  | { type: "stream_enhanced";    streamId: MeshStreamId; enhancement: StreamEnhancement }
  | { type: "stream_degraded";    streamId: MeshStreamId; reason: string }
  | { type: "stream_reconnected"; streamId: MeshStreamId; attemptCount: number };

// Observe globally via the registry
registry.lifecycle$.subscribe(event => {
  metrics.increment(`mesh.stream.${event.type}`);
});
```

---

# 43. Server-Side Filter Pushdown (NEW)

## 43.1 Motivation

Without server-side filtering, the server broadcasts every event for an entity type and consumers apply `.where()` locally inside RxJS. For high-frequency streams (metrics, logs, websocket connection states), this transfers enormous volumes of events that are immediately discarded client-side.

**Server-side filter pushdown** moves the filter evaluation to the emitting node. Only events that pass the filter are written to the SSE wire.

---

## 43.2 MeshServerFilter

```typescript
/**
 * A serializable filter descriptor sent to the server along with the
 * SSE subscription request. The server evaluates this before emitting.
 */
export type MeshServerFilter =
  | MeshServerFilterAnd
  | MeshServerFilterOr
  | MeshServerFilterNot
  | MeshServerFilterEq
  | MeshServerFilterNeq
  | MeshServerFilterIn
  | MeshServerFilterRange
  | MeshServerFilterExists
  | MeshServerFilterAlways;   // { type: "always" } — no filtering

export interface MeshServerFilterEq {
  type: "eq";
  field: string;
  value: string | number | boolean;
}

export interface MeshServerFilterNeq {
  type: "neq";
  field: string;
  value: string | number | boolean;
}

export interface MeshServerFilterIn {
  type: "in";
  field: string;
  values: Array<string | number | boolean>;
}

export interface MeshServerFilterRange {
  type: "range";
  field: string;
  gte?: number;
  lte?: number;
}

export interface MeshServerFilterExists {
  type: "exists";
  field: string;
}

export interface MeshServerFilterAnd {
  type: "and";
  filters: MeshServerFilter[];
}

export interface MeshServerFilterOr {
  type: "or";
  filters: MeshServerFilter[];
}

export interface MeshServerFilterNot {
  type: "not";
  filter: MeshServerFilter;
}

export interface MeshServerFilterAlways {
  type: "always";
}
```

---

## 43.3 Where-to-Filter Compiler

The query builder's `.where()` clauses are automatically compiled into a `MeshServerFilter` when the stream is opened. Fields that are pushdown-safe (scalar equality, range, membership) are pushed to the server. Fields that require in-process logic (computed fields, cross-entity references) are retained client-side.

```typescript
// mesh-server-filter-compiler.ts

export interface FilterCompilationResult {
  /** Filter safe to push to the server */
  serverFilter: MeshServerFilter;
  /** Residual predicate applied locally in RxJS */
  clientFilter: ((item: unknown) => boolean) | null;
}

export function compileWhereToServerFilter(
  where: MeshWhereClause[],
  entity: AnyMeshEntity,
): FilterCompilationResult {
  const pushable: MeshServerFilter[] = [];
  const residual: MeshWhereClause[] = [];

  for (const clause of where) {
    if (isServerPushable(clause, entity)) {
      pushable.push(clauseToServerFilter(clause));
    } else {
      residual.push(clause);
    }
  }

  return {
    serverFilter: pushable.length > 0
      ? { type: "and", filters: pushable }
      : { type: "always" },
    clientFilter: residual.length > 0
      ? buildClientPredicate(residual)
      : null,
  };
}
```

---

## 43.4 Server Evaluation

On the node side, `BaseMeshService` intercepts outbound events and evaluates the server filter before writing to the SSE connection:

```typescript
// Inside BaseMeshService SSE emitter

private shouldEmit(event: MeshStreamEnvelope, filter: MeshServerFilter): boolean {
  return evaluateServerFilter(filter, event.payload);
}

function evaluateServerFilter(filter: MeshServerFilter, item: unknown): boolean {
  switch (filter.type) {
    case "always": return true;
    case "eq":     return (item as any)[filter.field] === filter.value;
    case "neq":    return (item as any)[filter.field] !== filter.value;
    case "in":     return filter.values.includes((item as any)[filter.field]);
    case "range": {
      const v = (item as any)[filter.field];
      return (filter.gte === undefined || v >= filter.gte)
          && (filter.lte === undefined || v <= filter.lte);
    }
    case "exists": return (item as any)[filter.field] !== undefined;
    case "and":    return filter.filters.every(f => evaluateServerFilter(f, item));
    case "or":     return filter.filters.some(f => evaluateServerFilter(f, item));
    case "not":    return !evaluateServerFilter(filter.filter, item);
  }
}
```

---

## 43.5 Pushdown Transparency

The consumer API is unchanged. Pushdown is automatic:

```typescript
// This .where() clause is automatically pushed down to the server.
// Only events where environment === "prod" travel the wire.
discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .listen()
  .subscribe(event => {
    // event is guaranteed to have environment === "prod"
    // no client-side filtering needed
  });
```

The query plan introspection (`.explain()`) reports which clauses were server-pushed:

```
MeshQueryPlan {
  serverSideFilter: { type: "eq", field: "environment", value: "prod" },
  clientSideFilter: null,         // nothing left to filter locally
  filterPushdownRatio: "100%",
  ...
}
```

---

## 43.6 Filter Compatibility & Stream Sharing

When two consumers request the same entity with the same server filter, they share the same `SharedStream`. When filters differ, they get separate streams — each with its own server-side filter applied on the node.

```
Consumer A: .where({ environment: "prod" })
  → serverFilter: { type: "eq", field: "environment", value: "prod" }
  → fingerprint: "stream-abc"
  → SharedStream "stream-abc" opened

Consumer B: .where({ environment: "prod" })
  → same fingerprint: "stream-abc"
  → reuses SharedStream "stream-abc" ✓

Consumer C: .where({ environment: "staging" })
  → different fingerprint: "stream-xyz"
  → new SharedStream "stream-xyz" opened with different server filter
```

---

# 44. Stream Enhancement Protocol (NEW)

## 44.1 Motivation

Once a stream is open, the consumer may need to broaden its scope — for example:

- A dashboard initially subscribes to `environment: "prod"` but later the user selects "staging" as well
- A feature subscribes to `deployment` events and later needs `deploymentMetrics` events from the same node
- A pagination component subscribes to page 1 and wants to pre-fetch page 2's events without a separate connection

The **enhancement protocol** allows the consumer to extend a stream's subscription scope without tearing down the SSE connection. The server receives an enhancement instruction and begins emitting events for the new scope on the same connection.

---

## 44.2 StreamEnhancement Type

```typescript
/**
 * An instruction sent to the server over an existing SSE stream
 * to extend its subscription scope.
 */
export type StreamEnhancement =
  | StreamFilterEnhancement
  | StreamEntityEnhancement
  | StreamFieldEnhancement;

/**
 * Broaden or change the server-side filter on the existing stream.
 * The new filter replaces OR is OR-merged with the existing one.
 */
export interface StreamFilterEnhancement {
  readonly type: "filter";
  readonly mode: "replace" | "or-merge" | "and-narrow";
  readonly filter: MeshServerFilter;
}

/**
 * Add an additional entity type to the same SSE stream.
 * The stream becomes multiplexed across multiple entity types.
 */
export interface StreamEntityEnhancement {
  readonly type: "entity";
  readonly entityKey: string;
  readonly methodName: string;
  readonly filter: MeshServerFilter;
}

/**
 * Request additional fields to be included in future events
 * (e.g. if the entity supports projection-aware streaming).
 */
export interface StreamFieldEnhancement {
  readonly type: "fields";
  readonly add: string[];
  readonly remove?: string[];
}
```

---

## 44.3 Enhancement API on the Builder

```typescript
// Get a handle to an active stream
const handle = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .listen()
  .connect();

// Later, enhance it to also include staging events
// — no new SSE connection is opened
await handle.enhance({
  type: "filter",
  mode: "or-merge",
  filter: { type: "eq", field: "environment", value: "staging" },
});

// Add deploymentMetrics to the same stream
await handle.enhance({
  type: "entity",
  entityKey: "deploymentMetrics",
  methodName: "list",
  filter: { type: "always" },
});
```

---

## 44.4 Server-Side Enhancement Handling

The node receives enhancement instructions via a lightweight JSON control frame on the SSE connection (using a dedicated SSE event type `mesh:enhance`):

```
event: mesh:enhance
data: {
  "streamId": "f3a2c1d0-...",
  "enhancement": {
    "type": "filter",
    "mode": "or-merge",
    "filter": { "type": "eq", "field": "environment", "value": "staging" }
  }
}
```

The node updates its internal emit predicate for that SSE connection without closing the socket.

---

## 44.5 Enhancement and Stream Registry Consistency

When a stream is enhanced, its fingerprint changes. The registry handles this by:

1. Creating a new fingerprint for the enhanced specification
2. Checking if another stream already exists for that fingerprint
3. If yes: migrating the consumers to the existing stream and releasing the old one
4. If no: updating the existing stream's fingerprint in-place

```typescript
// mesh-shared-stream-registry.ts (excerpt)

async enhance(streamId: MeshStreamId, enhancement: StreamEnhancement): Promise<void> {
  const stream = this.streams.get(streamId);
  if (!stream) throw new MeshStreamNotFoundError(streamId);

  const newSpec = applyEnhancement(stream.spec, enhancement);
  const newFingerprint = deriveStreamFingerprint(newSpec);

  // Check for fingerprint collision (another stream already has this enhanced scope)
  const existing = this.lookup(newFingerprint);
  if (existing && existing.id !== streamId) {
    // Migrate consumers to the existing stream
    await this.migrateConsumers(stream, existing);
    return;
  }

  // Apply enhancement to server and update registry
  await this.sendEnhancement(stream, enhancement);
  this.updateFingerprint(streamId, newFingerprint);

  this.lifecycle$.next({ type: "stream_enhanced", streamId, enhancement });
}
```

---

## 44.6 Enhancement Negotiation

Not all enhancements are always possible (e.g., a node may not support field-level streaming projection). The server responds with an enhancement acknowledgement:

```
event: mesh:enhance:ack
data: {
  "streamId": "f3a2c1d0-...",
  "accepted": true,
  "appliedFilter": { "type": "or", "filters": [...] },
  "fallback": null
}
```

If `accepted: false`, the registry falls back to opening a new stream for the additional scope and running both in parallel, merging at the consumer level.

---

# 45. Stream Multiplexing & Reference Counting (NEW)

## 45.1 Consumer Reference Model

Every consumer that calls `.listen()` or `.live()` gets a unique `MeshConsumerId`. The `SharedStream` tracks all active consumers:

```typescript
export interface SharedStream<TEvent = unknown> {
  // ... (see §41.2)

  /** Map of active consumers and when they attached */
  readonly consumers: Map<MeshConsumerId, { attachedAt: Date; label?: string }>;

  /** Derived count — consumers.size */
  readonly refCount: number;
}
```

---

## 45.2 Multiplexed Event Delivery

All consumers sharing a `SharedStream` receive events from the same `source$` Subject. Each consumer's Observable is simply a derived view:

```typescript
// Inside SharedStreamRegistry.acquire()

const stream = this.lookup(fingerprint) ?? await this.openStream(spec);
const consumerId = generateConsumerId();

stream.consumers.set(consumerId, { attachedAt: new Date() });

// Each consumer gets its own Observable slice
// (allowing per-consumer client-side filtering on top of the shared server filter)
const consumerObservable$ = stream.source$.pipe(
  filter(event => spec.clientFilter ? spec.clientFilter(event.payload) : true),
  finalize(() => this.release(stream.id, consumerId)),
);

return { stream, consumerId, observable$: consumerObservable$ };
```

---

## 45.3 Per-Consumer Client-Side Filters

Even when two consumers share an SSE stream, they may have slightly different client-side residual filters (e.g. same server filter, but one consumer additionally wants `status !== "deprecated"`). Each consumer's Observable applies its own client-side predicate on top of the shared source, with zero duplication of the SSE transport:

```
SharedStream source$  →  Consumer A filter (status !== "deprecated")  →  Consumer A Observable
                      →  Consumer B filter (status === "running")      →  Consumer B Observable
```

---

## 45.4 Zero-Consumer Cleanup

When the last consumer releases its reference:

```typescript
release(streamId: MeshStreamId, consumerId: MeshConsumerId): void {
  const stream = this.streams.get(streamId);
  if (!stream) return;

  stream.consumers.delete(consumerId);

  if (stream.consumers.size === 0) {
    if (stream.idleTtlMs > 0) {
      // Keep alive briefly, in case of rapid re-subscription
      setTimeout(() => {
        if (stream.consumers.size === 0) {
          this.closeStream(stream);
        }
      }, stream.idleTtlMs);
    } else {
      this.closeStream(stream);
    }
  }
}
```

---

# 46. Stream Store API (NEW)

## 46.1 MeshStreamStore

The `MeshStreamStore` is the high-level interface exposed to the rest of the mesh system (query executor, live query engine, event subscriber). It wraps the `SharedStreamRegistry` and adds type safety and entity awareness:

```typescript
@Injectable()
export class MeshStreamStore {
  constructor(private readonly registry: SharedStreamRegistry) {}

  /**
   * Get or create a shared stream for the given entity query.
   * Returns a typed Observable and the stream handle.
   */
  async subscribe<TItem>(
    spec: TypedStreamSpec<TItem>,
    options?: StreamSubscribeOptions,
  ): Promise<TypedStreamHandle<TItem>> {
    const fingerprint = deriveStreamFingerprint(spec);
    const { stream, consumerId, observable$ } = await this.registry.acquire(spec);

    return {
      streamId: stream.id,
      consumerId,
      fingerprint,
      refCount$: stream.source$.pipe(map(() => stream.consumers.size), distinctUntilChanged()),
      status$: /* Observable<StreamStatus> from lifecycle$ */,
      events$: observable$ as Observable<MeshStreamEnvelope<TItem>>,
      enhance: (enhancement) => this.registry.enhance(stream.id, enhancement),
      release: () => this.registry.release(stream.id, consumerId),
    };
  }

  /**
   * Get diagnostic info about all open streams.
   */
  inspect(): StreamInspectionResult[] {
    return this.registry.listOpen().map(stream => ({
      streamId: stream.id,
      fingerprint: stream.fingerprint,
      entityKey: stream.entityKey,
      consumerCount: stream.refCount,
      openedAt: stream.openedAt,
      status: stream.status,
      serverFilter: stream.serverFilter,
    }));
  }

  /**
   * Observable of all stream lifecycle events.
   */
  get lifecycle$(): Observable<StreamLifecycleEvent> {
    return this.registry.lifecycle$;
  }
}
```

---

## 46.2 TypedStreamHandle

```typescript
export interface TypedStreamHandle<TItem> {
  /** The underlying shared stream ID */
  readonly streamId: MeshStreamId;

  /** This consumer's ID within the shared stream */
  readonly consumerId: MeshConsumerId;

  /** Deterministic fingerprint of the stream spec */
  readonly fingerprint: string;

  /** Current number of consumers sharing this stream */
  readonly refCount$: Observable<number>;

  /** Stream connection status */
  readonly status$: Observable<"connecting" | "open" | "degraded" | "closed">;

  /** Event stream for this consumer (server-filtered + client-filtered) */
  readonly events$: Observable<MeshStreamEnvelope<TItem>>;

  /** Enhance the underlying shared stream */
  enhance(enhancement: StreamEnhancement): Promise<void>;

  /** Release this consumer's reference */
  release(): void;
}
```

---

## 46.3 Integration with `.listen()` and `.live()`

The stream store is automatically used by the query builder's terminal operators. No change is needed at the consumer call site:

```typescript
// Consumer code — unchanged from v3
const subscription = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .listen()
  .subscribe(event => { ... });

// Under the hood (v4):
// 1. Compile .where() to serverFilter via compileWhereToServerFilter()
// 2. Derive fingerprint
// 3. streamStore.subscribe(spec) → reuses existing SharedStream if available
// 4. Return Observable from TypedStreamHandle.events$
// 5. On unsubscribe → TypedStreamHandle.release()
```

---

## 46.4 Exposing the Stream Handle

For advanced use cases, consumers can access the stream handle directly:

```typescript
const handle = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .connect(); // returns Promise<TypedStreamHandle<Deployment>>

console.log(handle.streamId);    // MeshStreamId
console.log(handle.fingerprint); // string

// Subscribe to events via the handle
handle.events$.subscribe(event => { ... });

// Enhance it later
await handle.enhance({
  type: "filter",
  mode: "or-merge",
  filter: { type: "eq", field: "environment", value: "staging" },
});

// Explicit cleanup
handle.release();
```

---

# 47. Updated File Structure (v4)

```
src/core/modules/mesh/
│
├── mesh-operation.ts
├── mesh-query.ts
├── mesh-mutation.ts
├── mesh-entity.ts
├── mesh-relation.ts
├── mesh-entity.types.ts
├── mesh-query.types.ts
├── mesh-type-utils.ts
│
├── query/
│   ├── mesh-query-builder.ts
│   ├── mesh-query-executor.ts
│   ├── mesh-query-join-executor.ts
│   ├── mesh-query-subquery.ts
│   ├── mesh-query-fingerprint.ts
│   ├── mesh-query-plan.ts
│   ├── mesh-where.ts
│   ├── mesh-select.ts
│   ├── mesh-order.ts
│   ├── mesh-pagination.ts
│   └── mesh-aggregate.ts
│
├── stream/                                       ← NEW (v4)
│   ├── mesh-stream-id.ts
│   ├── mesh-stream-fingerprint.ts
│   ├── mesh-stream-registry.ts
│   ├── mesh-stream-store.ts
│   ├── mesh-stream-enhancement.ts
│   ├── mesh-stream-enhancement-negotiator.ts
│   ├── mesh-stream-multiplexer.ts
│   └── mesh-stream.types.ts
│
├── filter/                                       ← NEW (v4)
│   ├── mesh-server-filter.ts
│   ├── mesh-server-filter-compiler.ts
│   ├── mesh-server-filter-evaluator.ts
│   └── mesh-server-filter.types.ts
│
├── live/
│   ├── mesh-live-query.ts
│   └── mesh-entity-event-bus.ts
│
├── mutation/
│   ├── mesh-mutation-builder.ts
│   ├── mesh-mutation-executor.ts
│   └── mesh-optimistic-cache.ts
│
├── saga/
│   ├── mesh-saga-builder.ts
│   ├── mesh-saga-executor.ts
│   └── mesh-saga-context.ts
│
├── middleware/
│   ├── mesh-query-middleware.ts
│   ├── mesh-tracing-middleware.ts
│   ├── mesh-logging-middleware.ts
│   ├── mesh-circuit-breaker-middleware.ts
│   └── mesh-cache-middleware.ts
│
├── cache/
│   ├── mesh-query-cache.ts
│   └── mesh-query-cache.types.ts
│
├── events/
│   ├── mesh-entity-event.ts
│   ├── mesh-entity-event-emitter.ts
│   └── mesh-entity-event-subscriber.ts
│
├── services/
│   ├── base-mesh.service.ts
│   └── system-mesh-resource-discovery.service.ts
│
└── tokens.ts
```

---

# 48. Implementation Order (v4)

## Phases 1–12 (v3 — unchanged)

See v3 for: core primitives, transport layer, query builder, join/subquery system, execution engine, aggregation engine, mutation layer, saga coordinator, reactive layer, middleware & cache, introspection, public API stabilization.

---

## Phase 13 — Server-Side Filter System ← NEW

- `MeshServerFilter` type hierarchy
- `compileWhereToServerFilter()` compiler
- `evaluateServerFilter()` evaluator (node-side)
- Integration into `BaseMeshService` SSE emitter
- Pushdown reporting in `.explain()`

---

## Phase 14 — Stream Identity ← NEW

- `MeshStreamId` / `MeshConsumerId` branded types
- `generateStreamId()` / `generateConsumerId()`
- `MeshStreamEnvelope` with streamId field
- Stream lifecycle event types

---

## Phase 15 — Shared Stream Registry ← NEW

- `SharedStream` interface
- `SharedStreamRegistry` implementation
  - fingerprint lookup
  - acquire (open or reuse)
  - release + refcount
  - idle TTL
  - lifecycle$ Subject

---

## Phase 16 — Stream Enhancement Protocol ← NEW

- `StreamEnhancement` type union
- Server-side control frame handling (`mesh:enhance` SSE event)
- `EnhancementNegotiator` (ack/reject/fallback)
- Registry fingerprint migration on enhancement
- Builder `.connect()` → `TypedStreamHandle`

---

## Phase 17 — Stream Store & Integration ← NEW

- `MeshStreamStore` service
- `TypedStreamHandle` interface
- Integration into `.listen()` / `.live()` terminals
- `MeshStreamMultiplexer` (per-consumer client-side filters on shared source$)
- `.inspect()` diagnostics

---

# 49. Invariants & Guarantees (v4)

## v3 Invariants I1–I20 (unchanged)

| # | Invariant |
|---|---|
| I1 | Services expose entities, not raw operations |
| I2 | Everything is strongly typed |
| I3 | No string operation names |
| I4 | Builders are immutable |
| I5 | Joins operate on builders |
| I6 | Joins are infinitely nestable |
| I7 | Filtering is post-distribution (for request) |
| I8 | Distributed execution is hidden |
| I9 | Deduplication is entity-driven |
| I10 | Result types are fully inferred |
| I11 | Live queries are consistent with last known distributed state |
| I12 | Aggregations execute in two phases |
| I13 | Middleware is composable and order-preserving |
| I14 | Relations declared on entities are single source of truth for auto-joins |
| I15 | Optimistic mutations always roll back on failure |
| I16 | Sagas always execute compensating actions in reverse order |
| I17 | Query plans are always computable without executing |
| I18 | Event subscriptions are always scoped to entity + event type |
| I19 | Cache invalidation is always tag-driven |
| I20 | All capabilities compose with all builder methods |

## v4 Additions

| # | Invariant |
|---|---|
| I21 | At most one SSE connection exists per unique stream fingerprint at any time |
| I22 | Streams are reference-counted — closed only when all consumers have released |
| I23 | Server-side filters are always evaluated before an event reaches the wire |
| I24 | Stream enhancement never tears down the existing SSE connection unless the server rejects the enhancement |
| I25 | Enhanced streams reuse existing streams when the post-enhancement fingerprint matches an already-open stream |
| I26 | Every stream has a globally unique, immutable `MeshStreamId` for its entire lifetime |
| I27 | Every consumer within a shared stream has a unique `MeshConsumerId` |
| I28 | Per-consumer client-side filters never affect other consumers sharing the same stream |
| I29 | Stream fingerprints are deterministic — identical specs always produce the same fingerprint regardless of call order |
| I30 | Filter pushdown is transparent — the consumer API is unchanged whether pushdown is active or not |

---

# Complete v4 Developer Experience

The API surface remains identical to v3. All v4 behavior is automatic and infrastructure-driven:

```typescript
// 1. Two consumers share one SSE stream automatically (v4 invariant I21)
const deployments1$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .listen(); // opens stream "abc"

const deployments2$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .listen(); // reuses stream "abc" (refCount: 2)

// 2. Server-side filter pushdown is automatic (v4 invariant I23)
// Only prod events travel the wire — no client-side filtering needed
discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod", status: "running" })
  .listen()
  .subscribe(event => { /* guaranteed: prod + running */ });

// 3. Access stream handle for advanced control
const handle = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .connect();

console.log(handle.streamId);   // "f3a2c1d0-..."
console.log(handle.fingerprint); // "9f3b4a..."

// 4. Enhance the stream without reconnecting (v4 invariant I24)
await handle.enhance({
  type: "filter",
  mode: "or-merge",
  filter: { type: "eq", field: "environment", value: "staging" },
});

// Stream now delivers both prod and staging events on the same connection

// 5. Add deploymentMetrics to the same stream (v4 invariant I24)
await handle.enhance({
  type: "entity",
  entityKey: "deploymentMetrics",
  methodName: "list",
  filter: { type: "always" },
});

// 6. Inspect all open streams for diagnostics
const openStreams = streamStore.inspect();
// [{ streamId, fingerprint, entityKey, consumerCount: 2, status: "open", serverFilter: {...} }]

// 7. Stream lifecycle observability
streamStore.lifecycle$.subscribe(event => {
  console.log(event.type, event.streamId);
  // "stream_opened" "f3a2c1d0-..."
  // "consumer_attached" "f3a2c1d0-..."
  // "stream_enhanced" "f3a2c1d0-..."
  // "consumer_detached" "f3a2c1d0-..."
  // "stream_closed" "f3a2c1d0-..."
});

// 8. Explicit cleanup
handle.release(); // decrements refCount; stream closes when all consumers release

// ─── All v3 capabilities compose naturally ────────────────────────────────────

// Live reactive query (shares stream with plain .listen() if fingerprint matches)
const deployments$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where({ environment: "prod" })
  .include("service")
  .cache({ ttlMs: 3_000, tags: ["deployments"] })
  .live({ debounceMs: 200 });

// Typed event subscription (uses stream registry for deduplication)
mesh
  .on(DeploymentMeshService.entities.deployments)
  .event("updated")
  .where({ environment: "prod" })
  .asObservable()
  .pipe(filter(e => e.item.status !== e.previous?.status))
  .subscribe(e => console.log("Status changed:", e));
```

---

# Summary of v4 Additions

| Feature | What It Solves | Key Types |
|---|---|---|
| **Shared SSE Stream Registry** | One connection per filter scope, regardless of consumer count | `SharedStreamRegistry`, `SharedStream`, `MeshStreamId` |
| **Stream Fingerprinting** | Deterministic dedup key from entity + filters + targets | `deriveStreamFingerprint()` |
| **Reference Counting** | Streams live exactly as long as they have consumers | `refCount`, `release()`, `idleTtlMs` |
| **Server-Side Filter Pushdown** | Only matching events travel the wire | `MeshServerFilter`, `compileWhereToServerFilter()`, `evaluateServerFilter()` |
| **Stream Enhancement Protocol** | Broaden or add entities to a stream without reconnecting | `StreamEnhancement`, `handle.enhance()`, `mesh:enhance` SSE event |
| **Stream Store** | High-level typed interface over the registry | `MeshStreamStore`, `TypedStreamHandle` |
| **Stream Lifecycle Events** | Observability for all stream transitions | `StreamLifecycleEvent`, `registry.lifecycle$` |
| **Per-Consumer Client Filters** | Independent residual filtering on a shared stream | `MeshStreamMultiplexer` |

from the full mesh history file provide me a new version that will enhance some principle.
so the goal of the STREAM_ENHANCE is more of a stream promote to have more things.
also the server side filtering should in fact be a rxjs based api that should work exactly the same but will be sent in json and reconstruct in the servers so i can query and filter from client and get the real request needed. when enhancing a stream it should return a new set of event to a new dedicated to a new consumer id and each envent can have multiple consumer id so the events is deduplicated if multiple consumer have cross refernce where clauses

# Mesh Resource Discovery & Distributed Query Architecture — v5

> **Status:** Design finalized, implementation pending
> **Scope:** All v4 concepts + RxJS-Isomorphic Server Filter API, Stream Promotion Protocol, Consumer-Scoped Event Delivery, Cross-Consumer Event Deduplication
> **Goal:** Zero-redundant-connections distributed execution engine with a unified RxJS filter model that serializes to the wire and reconstructs server-side — streams promote rather than fork, and events are deduplicated across consumers with overlapping filter scopes

---

# Table of Contents

1. Vision & Architectural Direction
2. Core Concept Shift — Services Are Distributed Table Groups
3. Problems With The Previous Model (+ v5 additions)
4. High-Level Architecture
5. Core Design Principles
6. `meshOperation()` Primitive
7. `meshEntity()` — Distributed Entity/Table Definition
8. Service Structure — Multiple Queryable Entities Per Service
9. Operation System
10. Complete Type Inference Pipeline
11. Static Service Metadata
12. Query Manifest System
13. Updated `BaseMeshService`
14. Internal Topic Derivation
15. Distributed Query Builder
16. Scope & Strategy System
17. Where System
18. Select System
19. Ordering & Pagination
20. Subqueries
21. Join System (Builder-Based)
22. Nested Joins
23. Join Type Inference
24. Execution Engine
25. Distributed Deduplication
26. Result Shapes
27. Streaming Queries
28. Discovery Service
29. Registration & Dependency Injection
30. Full End-to-End Examples
31. Reactive Live Query System
32. Distributed Aggregation Engine
33. Query Middleware Pipeline
34. Entity Relations Graph (Auto-Join Inference)
35. Optimistic Mutation Layer
36. Distributed Saga / Transaction Coordinator
37. Query Plan Introspection
38. Typed Event Subscriptions
39. Query Caching Layer
40. Enhanced Type Utilities
41. Shared SSE Stream Registry
42. Stream Identity & Unique Stream IDs
43. **[v5 REVISED] RxJS-Isomorphic Server Filter API**
44. **[v5 REVISED] Stream Promotion Protocol**
45. **[v5 REVISED] Consumer-Scoped Event Delivery & Cross-Consumer Deduplication**
46. Stream Multiplexing & Reference Counting
47. Stream Store API
48. File Structure (v5)
49. Implementation Order (v5)
50. Invariants & Guarantees (v5)

---

# 1. Vision & Architectural Direction

The mesh layer models distributed systems as a **distributed relational surface** composed of queryable entities. Every mesh service behaves conceptually like a distributed database schema, exposing not individual RPCs but entire entity graphs.

In v5, three architectural shifts complete the transport model:

**Shift 1 — The filter API is isomorphic.**
`.where()` clauses are written once as RxJS-compatible operators. The same predicate tree serializes to a compact JSON descriptor sent to the server, where it is reconstructed into an equivalent evaluation function. Consumers use the same RxJS filter vocabulary on both sides of the wire — no separate "server filter language" to learn.

**Shift 2 — Streams promote, they don't fork.**
When a consumer wants a broader scope than an existing open stream, they don't open a parallel connection. The existing stream is *promoted* — its server-side filter is widened to a superset — and a new `ConsumerId` is registered on that stream. The promoted stream delivers the full superset of events; each consumer's `ConsumerId` is embedded in every event so that individual consumers only receive the subset relevant to them.

**Shift 3 — Events are deduplicated across overlapping consumers.**
When two consumers have intersecting filter scopes (e.g. Consumer A: `environment=prod`, Consumer B: `environment=prod OR environment=staging`), a single event matching both filters is emitted once on the wire, carrying both `ConsumerId`s in its `recipients` field. Each consumer's observable filters by its own ID, so event delivery is correct per-consumer while wire transmission is minimized.

---

# 2. Core Concept Shift — Services Are Distributed Table Groups

*(unchanged from v3/v4)*

A mesh service represents a namespace of distributed entities:

```
DeploymentMeshService
 ├─ deployments
 ├─ deploymentLogs
 ├─ deploymentReplicas
 ├─ deploymentMetrics
 ├─ deploymentEvents
 ├─ deploymentRouting
 ├─ deploymentSnapshots
 └─ deploymentHealth
```

Each entity behaves like a distributed table: its own item type, item key, operations, join capabilities, and — in v5 — its own isomorphic filter contract.

---

# 3. Problems With The Previous Model

## Problems 1–7 (v2/v3/v4 — unchanged)

See prior versions for: single-entity services, stringly-typed operations, service-oriented joins, transport leakage, one-stream-per-consumer, server-side filtering gap, stream enhancement gap.

---

## Problem 8 — Two Separate Filter Languages (NEW in v5)

In v4, server-side filters were a separate type system (`MeshServerFilter`) with its own `eq`, `and`, `in`, `range` nodes compiled from `.where()` clauses. This creates two parallel filter vocabularies: RxJS predicates for client-side and `MeshServerFilter` trees for the server.

**Consequence:** Developers reason about filters differently depending on where they execute. The compiler mapping is implicit and lossy — not all client-side predicates can be pushed down, and the relationship between the two is opaque.

**The fix (v5):** A single **RxJS-Isomorphic Filter API** (`meshFilter`) where the developer writes one predicate expression that is both executed directly in RxJS pipelines and serialized to a JSON descriptor (`MeshFilterDescriptor`) sent to the server. The server deserializes it into an identical evaluation function. Same language, same semantics, both sides of the wire.

---

## Problem 9 — Enhancement Forks Rather Than Promotes (NEW in v5)

In v4, stream enhancement widened a stream's filter but the fingerprint migration logic was complex — in ambiguous cases it fell back to opening a new parallel stream. The model was additive but not unified.

**Consequence:** Two streams could end up serving overlapping populations, defeating the purpose of stream sharing.

**The fix (v5):** Enhancement is replaced by **promotion**. A stream can only grow (promote to a superset filter). The promoted stream always replaces the prior stream in-place — no parallel fallback streams. A consumer requesting a sub-scope of an already-open stream always attaches to the existing stream via a `ConsumerId` and filters its own view locally.

---

## Problem 10 — No Cross-Consumer Event Deduplication (NEW in v5)

In v4, the `source$` Subject broadcast every event to all consumers. Per-consumer client-side filters then independently evaluated each event. For events matching multiple consumers' filters, the event object was evaluated N times (once per consumer pipeline) — identical work, no coordination.

**The fix (v5):** Every emitted event carries a `recipients: MeshConsumerId[]` list computed server-side. The server evaluates all active consumers' filters against the event once, collects all matching consumer IDs, and emits the event a single time with all recipient IDs attached. Each consumer's observable gate-checks its own ID in `recipients`. One evaluation, one wire transmission, correct delivery to all matching consumers.

---

# 4. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                SystemMeshResourceDiscoveryService            │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                      MeshQueryBuilder                        │
│  where(meshFilter(...))  join()  orderBy()  select()         │
│  limit()  live()  stream()  execute()  explain()             │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│               MeshFilterDescriptor Serializer                │ ← v5
│                                                              │
│  serialize(rxjsFilter) → MeshFilterDescriptor (JSON)         │
│  deserialize(descriptor) → evaluator fn                      │
│  isSubset(a, b) → boolean (for stream reuse check)           │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    SharedStreamRegistry                      │
│                                                              │
│  lookup(fingerprint) → SharedStream | null                   │
│  acquire(spec) → SharedStream + ConsumerId                   │
│  promote(streamId, newFilter) → void                         │
│  release(streamId, consumerId) → void                        │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│               Consumer-Scoped Event Dispatcher               │ ← v5
│                                                              │
│  On each event: evaluate all consumer filters once           │
│  Attach recipients: MeshConsumerId[] to envelope             │
│  Emit once on source$ (deduplicated)                         │
│  Per-consumer Observable: filter by own ConsumerId           │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                       BaseMeshService                        │
│  registerEntity()  callEntity()  distributed transport       │
│  correlation  cancellation  SSE server                       │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│              Mesh Topic & SSE Infrastructure                 │
│  Stream Promotion Protocol  Recipient-Tagged Events          │
└──────────────────────────────────────────────────────────────┘
```

---

# 5. Core Design Principles

- **P1** — Services are distributed schemas
- **P2** — Entities are first-class
- **P3** — Builders are composable
- **P4** — Transport is infrastructure
- **P5** — No string literals
- **P6** — Everything inferable should be inferred
- **P7** — Streams are shared resources, not per-consumer connections
- **P8 (v5 REVISED)** — Filtering is written once in RxJS; it executes everywhere — client, server, stream registry
- **P9 (v5 REVISED)** — Streams promote to supersets; they never fork
- **P10 (NEW)** — Events are evaluated once and tagged with all matching recipients; never duplicated on the wire

---

# 6–42. Core Architecture (v3/v4 — Preserved)

All content from v2, v3, and v4 remains valid and unchanged, covering:

- `meshOperation()`, `meshQuery()`, `meshMutation()`, `meshEntity()`, `meshEntityEnhanced()`
- Distributed query builder, where/select/orderBy/pagination systems
- Join system (builder-based), nested joins, join type inference
- Execution engine, distributed deduplication, streaming
- Reactive live query system, aggregation engine, middleware pipeline
- Entity relations graph, optimistic mutations, distributed saga
- Query plan introspection, typed event subscriptions, query caching
- Full type utilities and DI registration
- Shared SSE Stream Registry, Stream Identity & Unique Stream IDs

---

# 43. RxJS-Isomorphic Server Filter API (v5 REVISED)

## 43.1 Motivation

Filters are conceptually a single thing expressed in two places: client-side (as RxJS `filter()` operators) and server-side (as evaluation predicates applied before SSE emission). In v4, these were two separate systems bridged by a compiler. In v5, they are the same system.

The developer writes one filter expression using `meshFilter` operators. That expression:
- Executes directly as an RxJS predicate when used in `.pipe()`
- Serializes to a `MeshFilterDescriptor` (compact JSON) when registered with a stream
- Deserializes server-side back into an identical evaluation function

The vocabulary is RxJS-idiomatic. The wire format is JSON. The semantics are identical on both sides.

---

## 43.2 meshFilter API

```typescript
// mesh-filter.ts

import type { MonoTypeOperatorFunction } from "rxjs";
import { filter } from "rxjs/operators";

// ─── Operator types ───────────────────────────────────────────────────────────

export type MeshFilterOperator<T> = {
  /** Use as an RxJS operator: stream$.pipe(operator) */
  (source: import("rxjs").Observable<T>): import("rxjs").Observable<T>;

  /** Serialize to wire descriptor */
  readonly descriptor: MeshFilterDescriptor;

  /** Evaluate a single item synchronously */
  readonly evaluate: (item: T) => boolean;
};

// ─── Primitives ───────────────────────────────────────────────────────────────

export function eq<T, K extends keyof T>(
  field: K,
  value: T[K],
): MeshFilterOperator<T>;

export function neq<T, K extends keyof T>(
  field: K,
  value: T[K],
): MeshFilterOperator<T>;

export function gt<T, K extends keyof T>(
  field: K,
  value: T[K],
): MeshFilterOperator<T>;

export function gte<T, K extends keyof T>(
  field: K,
  value: T[K],
): MeshFilterOperator<T>;

export function lt<T, K extends keyof T>(
  field: K,
  value: T[K],
): MeshFilterOperator<T>;

export function lte<T, K extends keyof T>(
  field: K,
  value: T[K],
): MeshFilterOperator<T>;

export function inSet<T, K extends keyof T>(
  field: K,
  values: ReadonlyArray<T[K]>,
): MeshFilterOperator<T>;

export function notIn<T, K extends keyof T>(
  field: K,
  values: ReadonlyArray<T[K]>,
): MeshFilterOperator<T>;

export function exists<T, K extends keyof T>(
  field: K,
): MeshFilterOperator<T>;

export function missing<T, K extends keyof T>(
  field: K,
): MeshFilterOperator<T>;

export function matches<T, K extends keyof T>(
  field: K,
  pattern: RegExp,
): MeshFilterOperator<T>;

// ─── Combinators ─────────────────────────────────────────────────────────────

export function and<T>(
  ...operators: MeshFilterOperator<T>[]
): MeshFilterOperator<T>;

export function or<T>(
  ...operators: MeshFilterOperator<T>[]
): MeshFilterOperator<T>;

export function not<T>(
  operator: MeshFilterOperator<T>,
): MeshFilterOperator<T>;

// ─── Passthrough ─────────────────────────────────────────────────────────────

/** Matches everything — used when no filter is desired */
export const always: MeshFilterOperator<unknown>;

/** Matches nothing — useful as a typed placeholder */
export const never: MeshFilterOperator<unknown>;
```

---

## 43.3 Usage — Identical on Both Sides

```typescript
import { eq, and, or, inSet, meshFilter } from "@mesh/filter";

// 1. Build a filter expression
const prodFilter = and(
  eq("environment", "prod"),
  or(
    eq("status", "running"),
    eq("status", "pending"),
  ),
);

// 2. Use directly as an RxJS operator — no difference from stock filter()
someDeploymentObservable$.pipe(prodFilter).subscribe(...)

// 3. Pass to .where() — automatically serialized and pushed to the server
discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where(prodFilter)
  .listen()
  .subscribe(event => {
    // Server already filtered; event is guaranteed prod + (running|pending)
  });

// 4. Inspect the descriptor — what gets sent over the wire
console.log(prodFilter.descriptor);
// {
//   op: "and",
//   operands: [
//     { op: "eq", field: "environment", value: "prod" },
//     { op: "or", operands: [
//       { op: "eq", field: "status", value: "running" },
//       { op: "eq", field: "status", value: "pending" }
//     ]}
//   ]
// }

// 5. Evaluate synchronously — used by the server reconstructor and stream registry
prodFilter.evaluate({ environment: "prod", status: "running" }) // true
prodFilter.evaluate({ environment: "staging", status: "running" }) // false
```

---

## 43.4 MeshFilterDescriptor (Wire Format)

The descriptor is the JSON representation sent to the server. It is self-contained and requires no schema registration.

```typescript
// mesh-filter-descriptor.ts

export type MeshFilterDescriptor =
  | { op: "always" }
  | { op: "never" }
  | { op: "eq";      field: string; value: Scalar }
  | { op: "neq";     field: string; value: Scalar }
  | { op: "gt";      field: string; value: number | string }
  | { op: "gte";     field: string; value: number | string }
  | { op: "lt";      field: string; value: number | string }
  | { op: "lte";     field: string; value: number | string }
  | { op: "in";      field: string; values: Scalar[] }
  | { op: "notIn";   field: string; values: Scalar[] }
  | { op: "exists";  field: string }
  | { op: "missing"; field: string }
  | { op: "matches"; field: string; pattern: string; flags?: string }
  | { op: "and";     operands: MeshFilterDescriptor[] }
  | { op: "or";      operands: MeshFilterDescriptor[] }
  | { op: "not";     operand: MeshFilterDescriptor };

type Scalar = string | number | boolean | null;
```

---

## 43.5 Server-Side Reconstruction

The server receives a `MeshFilterDescriptor` and reconstructs it into an evaluator function with identical semantics:

```typescript
// mesh-filter-evaluator.ts (server-side)

export function reconstructFilter<T>(
  descriptor: MeshFilterDescriptor,
): (item: T) => boolean {
  switch (descriptor.op) {
    case "always":  return () => true;
    case "never":   return () => false;
    case "eq":      return item => (item as any)[descriptor.field] === descriptor.value;
    case "neq":     return item => (item as any)[descriptor.field] !== descriptor.value;
    case "gt":      return item => (item as any)[descriptor.field] >  descriptor.value;
    case "gte":     return item => (item as any)[descriptor.field] >= descriptor.value;
    case "lt":      return item => (item as any)[descriptor.field] <  descriptor.value;
    case "lte":     return item => (item as any)[descriptor.field] <= descriptor.value;
    case "in":      return item => descriptor.values.includes((item as any)[descriptor.field]);
    case "notIn":   return item => !descriptor.values.includes((item as any)[descriptor.field]);
    case "exists":  return item => (item as any)[descriptor.field] !== undefined
                                && (item as any)[descriptor.field] !== null;
    case "missing": return item => (item as any)[descriptor.field] === undefined
                                || (item as any)[descriptor.field] === null;
    case "matches": {
      const re = new RegExp(descriptor.pattern, descriptor.flags);
      return item => re.test(String((item as any)[descriptor.field]));
    }
    case "and": {
      const fns = descriptor.operands.map(reconstructFilter<T>);
      return item => fns.every(fn => fn(item));
    }
    case "or": {
      const fns = descriptor.operands.map(reconstructFilter<T>);
      return item => fns.some(fn => fn(item));
    }
    case "not": {
      const fn = reconstructFilter<T>(descriptor.operand);
      return item => !fn(item);
    }
  }
}
```

The reconstructed function is semantically identical to the client-side `MeshFilterOperator.evaluate`. No behavior divergence is possible.

---

## 43.6 Filter Subset Relationship

The stream registry needs to determine whether a new consumer's filter is a **subset** of an existing stream's filter. If it is, the consumer can attach to the existing stream without any promotion — the stream already emits a superset of what the consumer needs, and the consumer filters locally.

```typescript
// mesh-filter-subset.ts

/**
 * Returns true if filterA's event set is a subset of filterB's event set.
 * i.e., everything filterA would match, filterB also matches.
 * Used to determine if a consumer can attach to an existing stream without promotion.
 */
export function isFilterSubset(
  filterA: MeshFilterDescriptor,
  filterB: MeshFilterDescriptor,
): boolean {
  // "always" is the universal set — nothing is a subset of "never"
  if (filterB.op === "always") return true;
  if (filterA.op === "never")  return true;
  if (filterB.op === "never")  return false;
  if (filterA.op === "always") return filterB.op === "always";

  // Structural subset rules
  // eq(field, X) ⊆ in(field, [..., X, ...])
  if (filterA.op === "eq" && filterB.op === "in") {
    return filterA.field === filterB.field
        && filterB.values.includes(filterA.value);
  }

  // in(field, [A,B]) ⊆ in(field, [A,B,C])
  if (filterA.op === "in" && filterB.op === "in") {
    return filterA.field === filterB.field
        && filterA.values.every(v => filterB.values.includes(v));
  }

  // and([...]) ⊆ B if any clause of A is a subset of B
  if (filterA.op === "and") {
    return filterA.operands.some(op => isFilterSubset(op, filterB));
  }

  // A ⊆ or([...]) if A is a subset of any clause
  if (filterB.op === "or") {
    return filterB.operands.some(op => isFilterSubset(filterA, op));
  }

  // Identical descriptors are trivially subsets of each other
  return JSON.stringify(filterA) === JSON.stringify(filterB);
}

/**
 * Compute the union (logical OR) of two filter descriptors.
 * Used when promoting a stream to cover a new consumer's broader filter.
 */
export function unionFilters(
  a: MeshFilterDescriptor,
  b: MeshFilterDescriptor,
): MeshFilterDescriptor {
  if (a.op === "always" || b.op === "always") return { op: "always" };
  if (a.op === "never") return b;
  if (b.op === "never") return a;
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  return { op: "or", operands: [a, b] };
}
```

---

## 43.7 Query Plan Reporting

`.explain()` now reports filter pushdown in terms of the isomorphic filter, not a separate system:

```
MeshQueryPlan {
  filter: {
    descriptor: { op: "and", operands: [...] },   // what was sent to server
    serverEvaluated: true,
    clientResidual: null,                          // nothing left client-side
    pushdownRatio: "100%",
  },
  ...
}
```

---

# 44. Stream Promotion Protocol (v5 REVISED)

## 44.1 Concept Shift: Enhancement → Promotion

In v4, "stream enhancement" was additive but ambiguous — it could sometimes fall back to forking. In v5, the concept is replaced by **stream promotion**: a stream's filter can only be widened (promoted to a superset), and this always happens in-place on the same SSE connection. The stream ID does not change. The fingerprint is updated. No parallel streams are created.

A consumer requesting a **sub-scope** of an existing stream always attaches to the existing stream. A consumer requesting a **super-scope** triggers promotion. A consumer requesting an **orthogonal scope** opens a new independent stream.

```
Existing stream:  filter = { environment: "prod" }
                  fingerprint = "abc"

New consumer A:   filter = { environment: "prod", status: "running" }
                  → subset of existing → attach to "abc" (no promotion, local client filter)

New consumer B:   filter = { environment: "prod" } OR { environment: "staging" }
                  → superset of existing → PROMOTE "abc" to new filter
                  → server now emits prod+staging events on stream "abc"

New consumer C:   filter = { projectId: "proj-x" }
                  → orthogonal → new stream "xyz" opened independently
```

---

## 44.2 Promotion Decision Matrix

```typescript
// mesh-stream-promotion.ts

export type PromotionDecision =
  | { action: "attach";  streamId: MeshStreamId }      // consumer filter ⊆ stream filter
  | { action: "promote"; streamId: MeshStreamId; newFilter: MeshFilterDescriptor }  // stream filter must grow
  | { action: "new" }                                  // orthogonal — open a new stream

export function decidePromotion(
  incomingFilter: MeshFilterDescriptor,
  openStreams: SharedStream[],
): PromotionDecision {
  for (const stream of openStreams) {
    // Consumer needs a subset — attach without modification
    if (isFilterSubset(incomingFilter, stream.filter)) {
      return { action: "attach", streamId: stream.id };
    }

    // Consumer needs a superset — promote the stream
    if (isFilterSubset(stream.filter, incomingFilter)) {
      return {
        action: "promote",
        streamId: stream.id,
        newFilter: incomingFilter,
      };
    }

    // Partial overlap — promote to union
    if (hasFilterOverlap(incomingFilter, stream.filter)) {
      return {
        action: "promote",
        streamId: stream.id,
        newFilter: unionFilters(stream.filter, incomingFilter),
      };
    }
  }

  return { action: "new" };
}
```

---

## 44.3 Stream Promotion Flow

```
Consumer B requests filter = env:prod OR env:staging
  → decidePromotion() → { action: "promote", streamId: "abc", newFilter: or(env:prod, env:staging) }
  → registry.promote("abc", newFilter)
      1. Serialize newFilter to MeshFilterDescriptor
      2. Send STREAM_PROMOTE control frame to server on stream "abc"
      3. Server updates its emit predicate for this SSE connection
      4. Server acknowledges with STREAM_PROMOTE_ACK
      5. Registry updates stream.filter and stream.fingerprint
      6. All existing consumers continue receiving events (prod events still flow)
      7. New staging events now also flow
  → ConsumerId "consumer-B" registered on stream "abc"
  → Consumer B's Observable: stream.source$.pipe(filterByRecipient("consumer-B"))
```

---

## 44.4 STREAM_PROMOTE Control Frame

The server receives promotion instructions as a named SSE control event:

```
event: mesh:promote
data: {
  "streamId": "f3a2c1d0-...",
  "newFilter": {
    "op": "or",
    "operands": [
      { "op": "eq", "field": "environment", "value": "prod" },
      { "op": "eq", "field": "environment", "value": "staging" }
    ]
  },
  "consumers": [
    { "consumerId": "consumer-A", "filter": { "op": "eq", "field": "environment", "value": "prod" } },
    { "consumerId": "consumer-B", "filter": { "op": "or", "operands": [...] } }
  ]
}
```

The server responds:

```
event: mesh:promote:ack
data: {
  "streamId": "f3a2c1d0-...",
  "accepted": true,
  "activeFilter": { "op": "or", "operands": [...] }
}
```

The `consumers` array in the promotion frame gives the server the per-consumer filters needed to compute `recipients` in every subsequent event (see §45).

---

## 44.5 Promotion API on the Builder

Consumer B's `.listen()` call is entirely automatic — promotion happens transparently inside the stream registry:

```typescript
// Consumer A — opens stream "abc" with filter env:prod
const a$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where(eq("environment", "prod"))
  .listen(); // stream "abc" opened

// Consumer B — requests a superset: env:prod OR env:staging
// Stream "abc" is promoted automatically. No new SSE connection.
const b$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where(or(eq("environment", "prod"), eq("environment", "staging")))
  .listen(); // stream "abc" promoted in-place

// Consumer C — requests a subset: env:prod AND status:running
// Attaches to "abc" without any promotion (local client filter applied)
const c$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where(and(eq("environment", "prod"), eq("status", "running")))
  .listen(); // attaches to "abc", no server change needed
```

---

## 44.6 Promotion and Stream Handle

```typescript
const handle = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where(eq("environment", "prod"))
  .connect();

console.log(handle.streamId);       // "abc"
console.log(handle.filter);         // { op: "eq", field: "environment", value: "prod" }

// Manually promote the stream (advanced use case)
await handle.promote(
  or(eq("environment", "prod"), eq("environment", "staging"))
);

console.log(handle.filter);         // { op: "or", operands: [...] } — updated in-place
console.log(handle.streamId);       // "abc" — unchanged
```

---

## 44.7 Adding Entity Types to a Stream (Multi-Entity Promotion)

A stream can be promoted to carry multiple entity types. This is expressed as an array of entity scopes on the promotion frame:

```typescript
// Add deploymentMetrics events to the existing deployment stream
await handle.promoteWithEntity({
  entityKey: "deploymentMetrics",
  methodName: "list",
  filter: always,
  consumerId: generateConsumerId(),
});
```

Wire frame:

```
event: mesh:promote
data: {
  "streamId": "f3a2c1d0-...",
  "addEntities": [
    {
      "entityKey": "deploymentMetrics",
      "methodName": "list",
      "filter": { "op": "always" },
      "consumerId": "consumer-metrics-X"
    }
  ]
}
```

Multi-entity streams are fully multiplexed — events carry an `entityKey` field in their envelope so consumers can demultiplex correctly.

---

# 45. Consumer-Scoped Event Delivery & Cross-Consumer Deduplication (v5 REVISED)

## 45.1 Core Model

Every event emitted on a `SharedStream` carries a `recipients` field: the list of `MeshConsumerId`s whose filter matched this event. This computation happens once — server-side, at emit time. Each consumer's Observable then gates on its own `ConsumerId` appearing in `recipients`.

```typescript
export interface MeshStreamEnvelope<TPayload = unknown> {
  readonly streamId: MeshStreamId;
  /**
   * All consumers on this stream whose filter matched this event.
   * Computed once on the server. Each consumer's Observable self-selects by ID.
   */
  readonly recipients: MeshConsumerId[];
  readonly entityKey: string;
  readonly eventType: string;
  readonly payload: TPayload;
  readonly timestamp: string;
  readonly sourceNodeId: string;
}
```

---

## 45.2 Server-Side Recipient Computation

When an event is ready to emit, the node iterates over all registered consumers on that stream, evaluates each consumer's filter against the event payload, and collects matching IDs:

```typescript
// Inside BaseMeshService SSE emitter (server-side)

function computeRecipients(
  event: unknown,
  consumers: Map<MeshConsumerId, { evaluator: (item: unknown) => boolean }>,
): MeshConsumerId[] {
  const recipients: MeshConsumerId[] = [];
  for (const [consumerId, consumer] of consumers) {
    if (consumer.evaluator(event)) {
      recipients.push(consumerId);
    }
  }
  return recipients;
}

function shouldEmit(recipients: MeshConsumerId[]): boolean {
  // Emit only if at least one consumer cares about this event
  return recipients.length > 0;
}

// In the emit pipeline:
const recipients = computeRecipients(event.payload, stream.consumers);
if (shouldEmit(recipients)) {
  const envelope: MeshStreamEnvelope = {
    streamId: stream.id,
    recipients,
    entityKey: event.entityKey,
    eventType: event.eventType,
    payload: event.payload,
    timestamp: new Date().toISOString(),
    sourceNodeId: this.nodeId,
  };
  sseConnection.emit(envelope);
}
```

---

## 45.3 Client-Side Consumer Gate

Each consumer's Observable subscribes to `source$` and gates on its own ID:

```typescript
// Inside SharedStreamRegistry.acquire() — per-consumer Observable construction

function buildConsumerObservable<TItem>(
  source$: Observable<MeshStreamEnvelope<TItem>>,
  consumerId: MeshConsumerId,
): Observable<TItem> {
  return source$.pipe(
    // Gate: only process events addressed to this consumer
    filter(envelope => envelope.recipients.includes(consumerId)),
    // Unwrap to the item payload
    map(envelope => envelope.payload),
  );
}
```

---

## 45.4 Deduplication Scenarios

### Scenario 1 — Identical Filters

```
Consumer A: env=prod
Consumer B: env=prod

Stream filter: env=prod (no promotion needed, same filter)

Event: { environment: "prod", deploymentId: "dep-1" }
  → recipients: ["consumer-A", "consumer-B"]
  → Wire: ONE emission

Consumer A Observable: receives dep-1  ✓
Consumer B Observable: receives dep-1  ✓
Wire transmissions: 1 (not 2)
```

---

### Scenario 2 — Overlapping Filters

```
Consumer A: env=prod
Consumer B: env=prod OR env=staging

Stream filter: env=prod OR env=staging (promoted to cover B)

Event 1: { environment: "prod", deploymentId: "dep-1" }
  → A's filter matches ✓, B's filter matches ✓
  → recipients: ["consumer-A", "consumer-B"]
  → Wire: ONE emission

Event 2: { environment: "staging", deploymentId: "dep-2" }
  → A's filter: NO MATCH
  → B's filter: matches ✓
  → recipients: ["consumer-B"]
  → Wire: ONE emission (consumer-A's Observable ignores it)
```

---

### Scenario 3 — Nested Filters (Subset)

```
Consumer A: env=prod
Consumer C: env=prod AND status=running

Stream filter: env=prod (C attached without promotion)

Event 1: { environment: "prod", status: "running", deploymentId: "dep-1" }
  → A's filter: ✓, C's filter: ✓
  → recipients: ["consumer-A", "consumer-C"]
  → Wire: ONE emission

Event 2: { environment: "prod", status: "stopped", deploymentId: "dep-2" }
  → A's filter: ✓, C's filter: NO MATCH (status ≠ running)
  → recipients: ["consumer-A"]
  → Wire: ONE emission (consumer-C's Observable ignores it)
```

---

### Scenario 4 — Full Miss After Superset Promotion

```
Stream filter: env=prod OR env=staging (promoted for consumer B)

Event: { environment: "canary", deploymentId: "dep-3" }
  → A's filter: NO MATCH
  → B's filter: NO MATCH
  → recipients: []
  → shouldEmit: false
  → Wire: ZERO emissions (server suppresses entirely)
```

The stream's server-side filter (the union of all consumer filters) acts as a first-pass gate. If the event doesn't match the union, it is never written to the wire at all.

---

## 45.5 Consumer Registry on the Server

The server maintains a consumer registry per SSE connection. When consumers are added (via promotion or initial connection), the server registers their serialized filters:

```typescript
// Server-side consumer registry (per SSE connection)

interface ServerConsumerRegistration {
  consumerId: MeshConsumerId;
  filterDescriptor: MeshFilterDescriptor;
  evaluator: (item: unknown) => boolean; // reconstructed from descriptor
  registeredAt: Date;
}

class ServerStreamConsumerRegistry {
  private consumers = new Map<MeshConsumerId, ServerConsumerRegistration>();

  register(consumerId: MeshConsumerId, descriptor: MeshFilterDescriptor): void {
    this.consumers.set(consumerId, {
      consumerId,
      filterDescriptor: descriptor,
      evaluator: reconstructFilter(descriptor),
      registeredAt: new Date(),
    });
  }

  deregister(consumerId: MeshConsumerId): void {
    this.consumers.delete(consumerId);
  }

  computeRecipients(item: unknown): MeshConsumerId[] {
    const result: MeshConsumerId[] = [];
    for (const [id, reg] of this.consumers) {
      if (reg.evaluator(item)) result.push(id);
    }
    return result;
  }

  getUnionFilter(): MeshFilterDescriptor {
    const filters = [...this.consumers.values()].map(r => r.filterDescriptor);
    if (filters.length === 0) return { op: "never" };
    if (filters.length === 1) return filters[0];
    return filters.reduce(unionFilters);
  }
}
```

---

## 45.6 Consumer Deregistration

When a consumer releases its reference, the server deregisters the consumer and recomputes the stream's union filter. If the union filter narrows (because the released consumer had the broadest filter), the server updates its emit predicate accordingly — the stream effectively "demotes" itself:

```typescript
// mesh-stream-registry.ts (client-side, excerpt)

release(streamId: MeshStreamId, consumerId: MeshConsumerId): void {
  const stream = this.streams.get(streamId);
  if (!stream) return;

  stream.consumers.delete(consumerId);

  if (stream.consumers.size === 0) {
    this.closeStream(stream);
    return;
  }

  // Recompute union filter — stream may narrow (demote)
  const newFilter = computeUnionFilter(stream.consumers);
  if (!filtersEqual(newFilter, stream.filter)) {
    this.sendDemotion(stream, newFilter);
    stream.filter = newFilter;
    stream.fingerprint = deriveStreamFingerprint({ ...stream.spec, filter: newFilter });
  }

  // Notify server to deregister the consumer
  this.sendConsumerDeregistration(stream, consumerId);

  this.lifecycle$.next({
    type: "consumer_detached",
    streamId,
    consumerId,
    refCount: stream.consumers.size,
  });
}
```

---

## 45.7 Stream Demotion

When all consumers with a broad filter release, the stream's server-side filter narrows back. This is sent as a `mesh:demote` control frame — the symmetric inverse of `mesh:promote`:

```
event: mesh:demote
data: {
  "streamId": "f3a2c1d0-...",
  "newFilter": { "op": "eq", "field": "environment", "value": "prod" },
  "removedConsumers": ["consumer-B"]
}
```

The stream shrinks its scope without disconnecting, reducing unnecessary server-side event evaluation for the remaining consumers.

---

# 46. Stream Multiplexing & Reference Counting

*(v4 content — unchanged except for the updated consumer model)*

Every consumer that calls `.listen()` or `.live()` gets a unique `MeshConsumerId`. The `SharedStream` tracks all active consumers with their individual filter descriptors.

All consumers sharing a `SharedStream` receive events from the same `source$` Subject. Each consumer's Observable is:

```typescript
stream.source$.pipe(
  filter(envelope => envelope.recipients.includes(consumerId)),
  map(envelope => envelope.payload),
  finalize(() => registry.release(stream.id, consumerId)),
)
```

This means:
- Zero-cost filtering for events not addressed to a consumer (simple `Array.includes` check)
- No redundant predicate evaluation client-side (the server already computed recipients)
- Correct isolation — Consumer A never sees Consumer B's exclusive events

---

# 47. Stream Store API

*(v4 content updated for v5 types)*

```typescript
@Injectable()
export class MeshStreamStore {
  constructor(private readonly registry: SharedStreamRegistry) {}

  async subscribe<TItem>(
    spec: TypedStreamSpec<TItem>,
    options?: StreamSubscribeOptions,
  ): Promise<TypedStreamHandle<TItem>> {
    // Serialize the MeshFilterOperator to a descriptor for the wire
    const filterDescriptor = spec.filter.descriptor;

    // Decide: attach, promote, or new stream
    const decision = decidePromotion(
      filterDescriptor,
      this.registry.listOpen().filter(s => s.entityKey === spec.entityKey),
    );

    const { stream, consumerId } = await this.registry.resolve(spec, decision);

    const events$ = buildConsumerObservable(stream.source$, consumerId);

    return {
      streamId: stream.id,
      consumerId,
      fingerprint: stream.fingerprint,
      filter: filterDescriptor,
      refCount$: stream.refCount$.asObservable(),
      status$: stream.status$.asObservable(),
      events$,
      promote: (newFilter) => this.registry.promote(stream.id, newFilter, consumerId),
      release: () => this.registry.release(stream.id, consumerId),
    };
  }

  inspect(): StreamInspectionResult[] {
    return this.registry.listOpen().map(stream => ({
      streamId: stream.id,
      fingerprint: stream.fingerprint,
      entityKey: stream.entityKey,
      consumerCount: stream.consumers.size,
      openedAt: stream.openedAt,
      status: stream.status,
      activeFilter: stream.filter,
      consumers: [...stream.consumers.entries()].map(([id, reg]) => ({
        consumerId: id,
        filter: reg.filterDescriptor,
        attachedAt: reg.attachedAt,
      })),
    }));
  }

  get lifecycle$(): Observable<StreamLifecycleEvent> {
    return this.registry.lifecycle$;
  }
}
```

---

# 48. File Structure (v5)

```
src/core/modules/mesh/
│
├── mesh-operation.ts
├── mesh-query.ts
├── mesh-mutation.ts
├── mesh-entity.ts
├── mesh-relation.ts
├── mesh-entity.types.ts
├── mesh-query.types.ts
├── mesh-type-utils.ts
│
├── query/
│   ├── mesh-query-builder.ts
│   ├── mesh-query-executor.ts
│   ├── mesh-query-join-executor.ts
│   ├── mesh-query-subquery.ts
│   ├── mesh-query-fingerprint.ts
│   ├── mesh-query-plan.ts
│   ├── mesh-where.ts
│   ├── mesh-select.ts
│   ├── mesh-order.ts
│   ├── mesh-pagination.ts
│   └── mesh-aggregate.ts
│
├── filter/                                       ← v5 (replaces v4 filter/)
│   ├── mesh-filter.ts                            ← isomorphic RxJS filter API
│   ├── mesh-filter.types.ts                      ← MeshFilterOperator, MeshFilterDescriptor
│   ├── mesh-filter-evaluator.ts                  ← reconstructFilter() — server-side
│   ├── mesh-filter-subset.ts                     ← isFilterSubset(), unionFilters()
│   └── mesh-filter-serializer.ts                 ← serialize/deserialize utilities
│
├── stream/
│   ├── mesh-stream-id.ts
│   ├── mesh-stream-fingerprint.ts
│   ├── mesh-stream-registry.ts
│   ├── mesh-stream-store.ts
│   ├── mesh-stream-promotion.ts                  ← v5 (replaces enhancement)
│   ├── mesh-stream-promotion-negotiator.ts       ← v5
│   ├── mesh-stream-demotion.ts                   ← v5 (NEW)
│   ├── mesh-stream-multiplexer.ts
│   └── mesh-stream.types.ts
│
├── consumer/                                     ← v5 (NEW)
│   ├── mesh-consumer-registry.ts                 ← per-stream consumer registration
│   ├── mesh-consumer-dispatcher.ts               ← recipient computation + envelope tagging
│   └── mesh-consumer.types.ts
│
├── live/
│   ├── mesh-live-query.ts
│   └── mesh-entity-event-bus.ts
│
├── mutation/
│   ├── mesh-mutation-builder.ts
│   ├── mesh-mutation-executor.ts
│   └── mesh-optimistic-cache.ts
│
├── saga/
│   ├── mesh-saga-builder.ts
│   ├── mesh-saga-executor.ts
│   └── mesh-saga-context.ts
│
├── middleware/
│   ├── mesh-query-middleware.ts
│   ├── mesh-tracing-middleware.ts
│   ├── mesh-logging-middleware.ts
│   ├── mesh-circuit-breaker-middleware.ts
│   └── mesh-cache-middleware.ts
│
├── cache/
│   ├── mesh-query-cache.ts
│   └── mesh-query-cache.types.ts
│
├── events/
│   ├── mesh-entity-event.ts
│   ├── mesh-entity-event-emitter.ts
│   └── mesh-entity-event-subscriber.ts
│
├── services/
│   ├── base-mesh.service.ts
│   └── system-mesh-resource-discovery.service.ts
│
└── tokens.ts
```

---

# 49. Implementation Order (v5)

## Phases 1–12 (v3 — unchanged)

Core primitives → transport → query builder → joins → execution → aggregation → mutations → saga → reactive layer → middleware & cache → introspection → API stabilization.

---

## Phase 13 — Isomorphic Filter System ← v5

- `MeshFilterOperator<T>` type (RxJS operator + descriptor + evaluate)
- All primitives: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `inSet`, `notIn`, `exists`, `missing`, `matches`
- All combinators: `and`, `or`, `not`, `always`, `never`
- `MeshFilterDescriptor` type hierarchy
- `reconstructFilter()` server-side evaluator
- `isFilterSubset()` and `unionFilters()` utilities
- Integration into `.where()` on the query builder

---

## Phase 14 — Stream Identity ← v4 (unchanged)

- `MeshStreamId` / `MeshConsumerId` branded types
- `MeshStreamEnvelope` with `recipients: MeshConsumerId[]` field ← v5 change
- Stream lifecycle event types

---

## Phase 15 — Consumer Registry & Dispatcher ← v5 (NEW)

- `ServerStreamConsumerRegistry` (server-side)
- `computeRecipients()` dispatcher
- `getUnionFilter()` for stream-level pre-filtering
- Consumer registration/deregistration via control frames

---

## Phase 16 — Shared Stream Registry ← v4 + v5 updates

- `SharedStream` interface (updated for v5 consumer model)
- `SharedStreamRegistry` implementation:
  - `decidePromotion()` using `isFilterSubset`
  - `acquire()` with attach/promote/new logic
  - `promote()` in-place filter widening
  - `release()` with demotion recomputation
  - Idle TTL
  - `lifecycle$` Subject

---

## Phase 17 — Stream Promotion Protocol ← v5

- `STREAM_PROMOTE` / `STREAM_PROMOTE_ACK` SSE control frames
- `STREAM_DEMOTE` control frame (symmetric)
- `PromotionNegotiator` (ack/reject)
- Multi-entity promotion (`promoteWithEntity`)
- Builder `.connect()` → `TypedStreamHandle` with `.promote()`

---

## Phase 18 — Stream Store & Integration ← v4 + v5 updates

- `MeshStreamStore` service (updated for promotion decision)
- `TypedStreamHandle` with `.promote()` replacing `.enhance()`
- Integration into `.listen()` / `.live()` terminals
- `buildConsumerObservable()` using `recipients` gate
- `.inspect()` including per-consumer filter breakdown

---

# 50. Invariants & Guarantees (v5)

## v3 Invariants I1–I20 (unchanged)

| # | Invariant |
|---|---|
| I1 | Services expose entities, not raw operations |
| I2 | Everything is strongly typed |
| I3 | No string operation names |
| I4 | Builders are immutable |
| I5 | Joins operate on builders |
| I6 | Joins are infinitely nestable |
| I7 | Filtering is post-distribution (for request) |
| I8 | Distributed execution is hidden |
| I9 | Deduplication is entity-driven |
| I10 | Result types are fully inferred |
| I11 | Live queries are consistent with last known distributed state |
| I12 | Aggregations execute in two phases |
| I13 | Middleware is composable and order-preserving |
| I14 | Relations declared on entities are single source of truth for auto-joins |
| I15 | Optimistic mutations always roll back on failure |
| I16 | Sagas always execute compensating actions in reverse order |
| I17 | Query plans are always computable without executing |
| I18 | Event subscriptions are always scoped to entity + event type |
| I19 | Cache invalidation is always tag-driven |
| I20 | All capabilities compose with all builder methods |

## v4 Invariants (I21–I30 — unchanged)

| # | Invariant |
|---|---|
| I21 | At most one SSE connection exists per unique stream fingerprint at any time |
| I22 | Streams are reference-counted — closed only when all consumers have released |
| I23 | Server-side filter evaluation always occurs before an event reaches the wire |
| I24 | Stream promotion never tears down the existing SSE connection |
| I25 | Every stream has a globally unique, immutable `MeshStreamId` for its lifetime |
| I26 | Every consumer within a shared stream has a unique `MeshConsumerId` |
| I27 | Per-consumer filtering never affects other consumers sharing the same stream |
| I28 | Stream fingerprints are deterministic |
| I29 | Filter pushdown is transparent — consumer API unchanged |
| I30 | Idle streams are held alive for their configured TTL, then closed |

## v5 Additions

| # | Invariant |
|---|---|
| I31 | Filter operators are isomorphic — `meshFilter` primitives serialize to wire descriptors and reconstruct to semantically identical server evaluators |
| I32 | Streams only promote (widen filter), never fork — at most one SSE connection per logical stream scope |
| I33 | A consumer whose filter is a subset of an existing stream's filter always attaches without any server change |
| I34 | A consumer whose filter is a superset of or overlapping with an existing stream's filter always triggers in-place promotion |
| I35 | Every event is evaluated against all consumer filters exactly once, server-side |
| I36 | Events carry a `recipients` list — computed once at emit time, never recomputed client-side |
| I37 | An event is suppressed entirely (zero wire transmission) when no consumer's filter matches it |
| I38 | When all consumers with the broadest filter release, the stream demotes in-place — server scope narrows without reconnection |
| I39 | Consumer deregistration is always notified to the server so server-side recipient computation stays accurate |
| I40 | The union of all active consumer filters is always the effective server-side emit predicate for that stream |

---

# Complete v5 Developer Experience

```typescript
import { eq, and, or, inSet, always } from "@mesh/filter";

// ─── 1. Isomorphic filter — same expression, both sides ──────────────────────

const prodRunning = and(
  eq("environment", "prod"),
  eq("status", "running"),
);

// As RxJS operator (client-side)
deployments$.pipe(prodRunning).subscribe(...);

// As .where() argument (automatically pushed to server)
discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where(prodRunning)
  .listen()
  .subscribe(event => {
    // Guaranteed: environment=prod AND status=running
    // Server filtered — nothing wasted on the wire
  });

// ─── 2. Stream sharing — automatic, zero configuration ───────────────────────

// Consumer A opens stream "abc" with filter: env=prod AND status=running
const a$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where(and(eq("environment", "prod"), eq("status", "running")))
  .listen();

// Consumer B requests a superset: env=prod (no status restriction)
// → stream "abc" is PROMOTED in-place — no new connection
const b$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where(eq("environment", "prod"))
  .listen();

// Consumer C requests a sub-scope: env=prod AND status=running AND nodeId=node-1
// → ATTACHES to stream "abc" — no promotion, local gate only
const c$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where(and(eq("environment", "prod"), eq("status", "running"), eq("nodeId", "node-1")))
  .listen();

// ─── 3. Cross-consumer deduplication — automatic ─────────────────────────────

// Event: { environment: "prod", status: "running", nodeId: "node-1" }
//   → A's filter matches ✓
//   → B's filter matches ✓
//   → C's filter matches ✓
//   → Wire: ONE emission with recipients: ["consumer-A", "consumer-B", "consumer-C"]

// Event: { environment: "prod", status: "stopped" }
//   → A's filter: NO (status ≠ running)
//   → B's filter: ✓
//   → C's filter: NO (status ≠ running)
//   → Wire: ONE emission with recipients: ["consumer-B"]
//   → a$ and c$ Observables silently ignore it (O(1) ID check)

// ─── 4. Stream handle for advanced promotion control ─────────────────────────

const handle = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where(eq("environment", "prod"))
  .connect();

console.log(handle.streamId);    // stable for the stream's lifetime
console.log(handle.consumerId);  // this consumer's unique ID
console.log(handle.filter);      // current effective filter descriptor

// Promote to wider scope on demand (e.g. user adds "staging" to their view)
await handle.promote(
  or(eq("environment", "prod"), eq("environment", "staging"))
);
// → server updates emit predicate, no reconnect, stream ID unchanged

// Add a second entity type to the same stream
await handle.promoteWithEntity({
  entityKey: "deploymentMetrics",
  methodName: "list",
  filter: always,
  consumerId: generateConsumerId(),
});

// ─── 5. Stream introspection ─────────────────────────────────────────────────

const open = streamStore.inspect();
// [{
//   streamId: "abc",
//   entityKey: "deployments",
//   consumerCount: 3,
//   activeFilter: { op: "eq", field: "environment", value: "prod" },
//   consumers: [
//     { consumerId: "consumer-A", filter: { op: "and", operands: [...] } },
//     { consumerId: "consumer-B", filter: { op: "eq", field: "environment", value: "prod" } },
//     { consumerId: "consumer-C", filter: { op: "and", operands: [...] } },
//   ]
// }]

// ─── 6. Stream lifecycle observability ───────────────────────────────────────

streamStore.lifecycle$.subscribe(event => {
  switch (event.type) {
    case "stream_opened":     // new SSE connection established
    case "stream_promoted":   // filter widened in-place
    case "stream_demoted":    // filter narrowed after consumer release
    case "consumer_attached": // new consumer registered
    case "consumer_detached": // consumer released
    case "stream_closed":     // refCount hit 0, connection closed
  }
});

// ─── 7. All v3 capabilities compose naturally ─────────────────────────────────

const deployments$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .where(and(eq("environment", "prod"), inSet("status", ["running", "pending"])))
  .include("service")
  .cache({ ttlMs: 3_000, tags: ["deployments"] })
  .live({ debounceMs: 200 });

// Typed event subscription — also uses the stream registry
mesh
  .on(DeploymentMeshService.entities.deployments)
  .event("updated")
  .where(eq("environment", "prod"))
  .asObservable()
  .pipe(
    filter(e => e.item.status !== e.previous?.status),
  )
  .subscribe(e => console.log("Status changed:", e));
```

---

# Summary of v5 Changes

| Area | v4 Model | v5 Model |
|---|---|---|
| **Filter API** | Separate `MeshServerFilter` type compiled from `.where()` | Single `MeshFilterOperator` — isomorphic, serializes to `MeshFilterDescriptor`, reconstructs identically server-side |
| **Stream Enhancement** | Optional enhancement that could fall back to a new stream | **Stream Promotion** — always in-place, streams only widen, never fork |
| **Sub-scope consumers** | Not explicitly modeled | Consumers with sub-scope filters attach without server change; client-side gate via `recipients` |
| **Event delivery** | `source$` broadcasts to all; each consumer's RxJS pipeline re-evaluates independently | Server computes `recipients[]` once per event; consumers gate on own ID — O(1), no re-evaluation |
| **Wire efficiency** | Events matching N consumers travel the wire once but are re-evaluated N times | Events carry `recipients[]` computed once; events matching no consumer are suppressed entirely |
| **Stream narrowing** | Not modeled (streams only grew) | **Stream Demotion** — when broad-filter consumers release, server scope narrows automatically |
| **Filter introspection** | Per-stream only | Per-consumer filter breakdown available in `.inspect()` |

from the pasted doc please update how the filtering should work. instead of having a dedicated things we should when calling the call for the listen pass argument of what the endpoint to listen on the event require that is validated from a schema and all event returned should be deduplicated and send to the right consumer.
the promote is not a promote but a new call made to the mesh and if the mesh detecte an already existing connexion for this node it should just add new events (with event deduplication) with the right consumerIds. the goal is to do all the things then a .request(params) or .listen(params) or a things like that. make the builder more simple but with all the control we need

# Mesh Resource Discovery & Distributed Query Architecture — v6

> **Status:** Design finalized, implementation pending
> **Scope:** All v5 concepts + Simplified Builder API, Schema-Validated Call Params, Connection-Level Multiplexing, Consumer-Scoped Event Deduplication
> **Goal:** A single ergonomic call surface — `.request(params)` / `.listen(params)` — where params are schema-validated at call time, the mesh detects existing connections to the same node and multiplexes onto them, and all events are deduplicated and routed to the right consumer IDs automatically

---

# Table of Contents

1. Vision & v6 Shifts
2. Core Concept: Services Are Distributed Table Groups
3. Problems Addressed in v6
4. High-Level Architecture
5. Core Design Principles
6. Entity & Operation Definitions (unchanged)
7. The Simplified Builder API
8. Schema-Validated Call Parameters
9. Connection-Level Multiplexing (no promotion, just attach)
10. Consumer Registry & Event Deduplication
11. Isomorphic Filter API (from v5)
12. Execution Engine
13. Reactive Live Queries
14. Distributed Aggregation
15. Query Middleware Pipeline
16. Entity Relations & Auto-Joins
17. Optimistic Mutations
18. Distributed Saga / Transaction Coordinator
19. Query Plan Introspection
20. Typed Event Subscriptions
21. Query Caching
22. Stream Store & Lifecycle
23. Full End-to-End Examples
24. File Structure (v6)
25. Implementation Order (v6)
26. Invariants & Guarantees (v6)

---

# 1. Vision & v6 Shifts

All prior versions built toward a clean distributed execution engine. v6 makes three final simplifications:

**Shift 1 — One call shape, fully typed params.**
`.request(params)` and `.listen(params)` replace the multi-step builder chain for specifying what you want from an endpoint. Params are declared in the entity's operation schema and validated at call time. The builder still exists for composing joins, projections, and ordering — but the filtering and scoping intent is expressed as typed params directly on the terminal call.

**Shift 2 — No promotion. Connection reuse is automatic.**
When `.listen(params)` is called and the mesh detects an existing open SSE connection to the same node(s) for the same entity, it registers the new consumer on that connection rather than opening a new one. There is no explicit "promote" or "enhance" step. The connection simply accumulates consumers. Each consumer's params-derived filter is registered server-side so the server knows which events to tag with which consumer IDs.

**Shift 3 — Events carry recipient IDs; deduplication is automatic.**
When an event matches multiple consumers on the same connection, the server emits it once with all matching consumer IDs in a `recipients` array. Each consumer's Observable gates on its own ID. Events that match no consumer are suppressed entirely on the wire.

The resulting API surface is the simplest it has ever been, while retaining all the power of the prior architecture.

---

# 2. Core Concept: Services Are Distributed Table Groups

A mesh service is not a list of remote procedure calls. It is a namespace of distributed entities — each behaving like a distributed relational table:

```
DeploymentMeshService
 ├─ deployments
 ├─ deploymentLogs
 ├─ deploymentReplicas
 ├─ deploymentMetrics
 ├─ deploymentEvents
 └─ deploymentHealth
```

The consumer queries entities, not topics. The mesh handles routing, transport, and connection reuse invisibly.

---

# 3. Problems Addressed in v6

## Problem A — Builder chains duplicated filter intent

In v2–v5, filtering was expressed via `.where()` chained on the builder, separately from the actual operation being called. This meant the developer had to think about "what entity" and "what filter" as two distinct concerns.

**Fix:** Params are passed directly to `.request(params)` or `.listen(params)`. The params type is inferred from the operation's input schema. No separate `.where()` step is needed for the common case — it is one expression.

## Problem B — "Promotion" was a leaky abstraction

In v5, stream promotion required the consumer to know that a stream existed and explicitly call `.promote()`. In practice, consumers should not care about the underlying stream topology at all.

**Fix:** The mesh checks for an existing connection to the same node at the moment `.listen(params)` is called. If one exists, the consumer is added to it. If not, a new connection is opened. This is entirely automatic — the consumer API has no concept of promotion.

## Problem C — Two call shapes for the same operation

In prior versions, `.request()` and `.listen()` shared the same builder but terminated differently. Params were spread across the builder chain, making it hard to see at a glance what a given call actually requires.

**Fix:** All operation-specific input — filters, scoping, pagination hints — goes into the typed params argument. Builder methods are reserved for cross-cutting concerns: joins, projections, ordering, and execution hints. The terminal call is unambiguous.

---

# 4. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                SystemMeshResourceDiscoveryService            │
│                                                              │
│  .from(Entity.queries.list).join(...).select(...).orderBy()  │
│       ↓                    ↓                                 │
│  .request(params)     .listen(params)                        │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                 Param Validator & Filter Compiler             │
│                                                              │
│  validate params against operation.inputSchema               │
│  extract filter descriptor (MeshFilterDescriptor)            │
│  extract scope hints (nodeId, pagination, etc.)              │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│              Connection Registry (per node)                  │
│                                                              │
│  lookup(nodeId, entityKey) → Connection | null               │
│  attach(connection, consumerId, filterDescriptor) → void     │
│  open(nodeId, entityKey, initialConsumer) → Connection       │
│  release(connection, consumerId) → void                      │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│           Server-Side Consumer Registry (per connection)     │
│                                                              │
│  register(consumerId, filterDescriptor → evaluator fn)       │
│  computeRecipients(event) → MeshConsumerId[]                 │
│  getUnionFilter() → MeshFilterDescriptor                     │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    SSE Wire                                   │
│                                                              │
│  Each event: { recipients: ConsumerId[], payload, ... }      │
│  Events with recipients=[] are suppressed                    │
└──────────────────────────────────────────────────────────────┘
```

---

# 5. Core Design Principles

- **P1** — Services are distributed schemas; entities are first-class
- **P2** — Builders compose cross-cutting concerns (joins, projections, ordering)
- **P3** — Operation-specific input (filters, scopes) lives in typed params
- **P4** — Transport, routing, and connection reuse are invisible to the consumer
- **P5** — No string literals — operations are referenced as static typed objects
- **P6** — Everything inferable is inferred — result types, item types, param types
- **P7** — Connections are shared resources — one SSE connection per node per entity at most
- **P8** — Filtering is isomorphic — same filter expression works client-side and server-side
- **P9** — Events carry recipient IDs — evaluated once, delivered correctly, never duplicated on the wire

---

# 6. Entity & Operation Definitions

Entity and operation definitions are unchanged from v5. Each entity declares its item schema, item key, queries, and mutations:

```typescript
import { z } from "zod";
import { meshEntity, meshQuery, meshMutation } from "@mesh/core";

const deploymentSchema = z.object({
  deploymentId: z.string(),
  serviceId: z.string(),
  environment: z.enum(["prod", "staging", "canary"]),
  status: z.enum(["running", "pending", "stopped", "failed"]),
  nodeId: z.string(),
  replicaCount: z.number(),
  createdAt: z.string(),
});

const listDeploymentsInput = z.object({
  environment: z.enum(["prod", "staging", "canary"]).optional(),
  status: z.enum(["running", "pending", "stopped", "failed"]).optional(),
  serviceId: z.string().optional(),
  nodeId: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

export const deployments = meshEntity({
  key: "deployments",
  item: deploymentSchema,
  itemKey: "deploymentId",
  config: { scope: "node-owned", nodeIdField: "nodeId" },

  queries: {
    list: meshQuery(listDeploymentsInput, z.object({ items: z.array(deploymentSchema) })),
    findById: meshQuery(z.object({ deploymentId: z.string() }), deploymentSchema.nullable()),
  },

  mutations: {
    create: meshMutation(deploymentSchema.omit({ deploymentId: true, createdAt: true }), deploymentSchema),
    update: meshMutation(deploymentSchema.partial().required({ deploymentId: true }), deploymentSchema),
    delete: meshMutation(z.object({ deploymentId: z.string() }), z.object({ deleted: z.boolean() })),
  },
});

export class DeploymentMeshService extends BaseMeshService({
  namespace: "deployment",
  entities: { deployments, deploymentLogs, deploymentMetrics },
}) {
  static readonly entities = { deployments, deploymentLogs, deploymentMetrics } as const;
}
```

The operation input schema is the **single source of truth** for what params are valid on `.request()` and `.listen()`. No separate filter type is needed.

---

# 7. The Simplified Builder API

## 7.1 Entry Point

```typescript
const builder = discovery.from(DeploymentMeshService.entities.deployments.queries.list);
```

This creates a `MeshQueryBuilder` bound to the `deployments.queries.list` operation. The builder knows:
- the entity key and method name
- the input schema (for param validation)
- the item type (for result typing)
- the item key (for deduplication)

## 7.2 Builder Methods (Cross-Cutting Concerns Only)

```typescript
builder
  .join(subquery, joinConfig)      // relational join against another builder
  .include("relation")             // auto-join via declared entity relation
  .select({ field: true, ... })    // projection
  .orderBy("field", "asc" | "desc")
  .limit(n)
  .offset(n)
  .scope(scopeHints)               // execution strategy overrides
  .cache(cacheConfig)              // query-level caching
```

**Notably absent from the builder:** `.where()`. Filtering is expressed as params on the terminal call.

## 7.3 Terminal Calls

```typescript
// One-time query — returns Promise<MeshQueryResult<TItem>>
const result = await builder.request(params);

// Real-time stream — returns Observable<TItem>
const stream$ = builder.listen(params);

// Access the underlying connection handle
const handle = await builder.connect(params);

// Streaming async iterator
for await (const item of builder.stream(params)) { ... }

// Aggregation
const stats = await builder.aggregate(params, { total: count(), ... });

// Reactive live query (re-executes on change)
const live$ = builder.live(params, { debounceMs: 200 });

// Query plan without executing
const plan = await builder.explain(params);
```

The `params` argument type is inferred directly from the operation's input schema:

```typescript
// TypeScript infers this automatically — no manual annotation needed
type ListDeploymentsParams = z.infer<typeof listDeploymentsInput>;
// { environment?: "prod" | "staging" | "canary"; status?: ...; serviceId?: string; ... }
```

## 7.4 The Builder is Immutable

Every builder method returns a new builder. Builders can be stored and reused as fragments:

```typescript
const prodDeployments = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .orderBy("createdAt", "desc")
  .limit(100);

// Reuse with different params at call time
const runningProd = await prodDeployments.request({ environment: "prod", status: "running" });
const stoppedProd = await prodDeployments.request({ environment: "prod", status: "stopped" });

// Or stream with different params
const running$ = prodDeployments.listen({ environment: "prod", status: "running" });
const staging$ = prodDeployments.listen({ environment: "staging" });
```

---

# 8. Schema-Validated Call Parameters

## 8.1 Validation at Call Time

When `.request(params)` or `.listen(params)` is called, the params are validated against the operation's `inputSchema` using Zod. Validation errors surface immediately, before any network call is made:

```typescript
// This throws a MeshParamValidationError at call time — no network call made
await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .request({ environment: "invalid-env" });
// ZodError: Invalid enum value for "environment"
```

## 8.2 Params to Filter Descriptor Compilation

After validation, the params are compiled into a `MeshFilterDescriptor`. This is the serialized form sent to the server so it can evaluate which events to tag with which consumer IDs.

The compilation is based on the operation's input schema structure:

```typescript
// mesh-params-compiler.ts

export function compileParamsToFilterDescriptor(
  params: Record<string, unknown>,
  schema: z.ZodObject<any>,
): MeshFilterDescriptor {
  const clauses: MeshFilterDescriptor[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    // Pagination / ordering hints are not filter predicates
    if (["limit", "offset", "orderBy", "cursor"].includes(key)) continue;

    const fieldSchema = schema.shape[key];
    if (!fieldSchema) continue;

    if (Array.isArray(value)) {
      clauses.push({ op: "in", field: key, values: value as Scalar[] });
    } else {
      clauses.push({ op: "eq", field: key, value: value as Scalar });
    }
  }

  if (clauses.length === 0) return { op: "always" };
  if (clauses.length === 1) return clauses[0];
  return { op: "and", operands: clauses };
}
```

## 8.3 Params Are the Filter

There is no distinction between "query params" and "filter params." Every field in the input schema that is not a pagination or ordering hint is treated as a filter predicate. This is intentional: the consumer tells the mesh what they want, and the mesh ensures only matching events flow.

```typescript
// params = { environment: "prod", status: "running" }
// compiles to: { op: "and", operands: [
//   { op: "eq", field: "environment", value: "prod" },
//   { op: "eq", field: "status", value: "running" }
// ]}
```

For more complex filter logic (OR conditions, range queries, etc.), the operation's input schema can declare array fields or dedicated range fields:

```typescript
const listDeploymentsInput = z.object({
  // Multiple statuses → compiled as { op: "in", field: "status", values: [...] }
  status: z.array(z.enum(["running", "pending", "stopped", "failed"])).optional(),

  // Range → compiled as { op: "and", operands: [{ op: "gte", ... }, { op: "lte", ... }] }
  replicaCountMin: z.number().optional(),
  replicaCountMax: z.number().optional(),

  // OR across environments
  environments: z.array(z.enum(["prod", "staging", "canary"])).optional(),
});
```

The schema structure drives the compilation strategy. No manual filter expression writing is needed for the typical case.

## 8.4 Advanced Filters via meshFilter

For cases where the schema-derived compilation is insufficient, the caller can pass a pre-built `MeshFilterDescriptor` via a reserved `$filter` field in params:

```typescript
import { and, or, eq, gt } from "@mesh/filter";

await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .request({
    environment: "prod",
    // $filter overrides or augments the compiled param filter
    $filter: or(
      eq("status", "running"),
      and(eq("status", "pending"), gt("replicaCount", 0)),
    ),
  });
```

When `$filter` is present, it is AND-merged with the compiled param filter:

```typescript
finalFilter = and(compiledParamFilter, params.$filter)
```

The `$filter` field is stripped from the params before schema validation (it is always allowed as an escape hatch).

---

# 9. Connection-Level Multiplexing

## 9.1 The Core Idea

When `.listen(params)` is called, the mesh does not immediately open a new SSE connection. Instead it checks:

> Is there already an open SSE connection to the relevant node(s) for this entity key?

If yes → register this consumer on the existing connection and inform the server of the new consumer's filter.
If no → open a new connection with this consumer as the first registrant.

This is not "stream promotion." The stream does not change its filter. The server simply gains knowledge of a new consumer and begins including that consumer's ID in events that match its filter.

## 9.2 Connection Registry

```typescript
// mesh-connection-registry.ts

export interface MeshConnection<TItem = unknown> {
  /** Stable connection ID */
  readonly id: MeshConnectionId;

  /** The node this connection is open to */
  readonly nodeId: string;

  /** The entity key this connection serves */
  readonly entityKey: string;

  /** The method name */
  readonly methodName: string;

  /** All registered consumers with their filter descriptors */
  readonly consumers: Map<MeshConsumerId, ConsumerRegistration>;

  /** The RxJS Subject that receives all raw envelopes from the SSE stream */
  readonly source$: Subject<MeshStreamEnvelope<TItem>>;

  /** Current connection status */
  readonly status: "connecting" | "open" | "degraded" | "closed";

  /** When the connection was established */
  readonly openedAt: Date;
}

export interface ConsumerRegistration {
  readonly consumerId: MeshConsumerId;
  readonly filterDescriptor: MeshFilterDescriptor;
  readonly attachedAt: Date;
}

export interface MeshConnectionRegistry {
  /** Find an open connection for this node + entity + method */
  lookup(nodeId: string, entityKey: string, methodName: string): MeshConnection | null;

  /** Attach a new consumer to an existing connection */
  attach(
    connectionId: MeshConnectionId,
    consumerId: MeshConsumerId,
    filterDescriptor: MeshFilterDescriptor,
  ): Promise<void>;

  /** Open a new connection and register the first consumer */
  open(
    nodeId: string,
    entityKey: string,
    methodName: string,
    consumerId: MeshConsumerId,
    filterDescriptor: MeshFilterDescriptor,
  ): Promise<MeshConnection>;

  /** Remove a consumer from a connection; close the connection if empty */
  release(connectionId: MeshConnectionId, consumerId: MeshConsumerId): void;

  /** List all open connections */
  listOpen(): MeshConnection[];

  /** Lifecycle event stream */
  lifecycle$: Observable<ConnectionLifecycleEvent>;
}
```

## 9.3 Attach Flow

When `.listen(params)` is called for `DeploymentMeshService.entities.deployments` targeting `node-A`:

```
1. Compile params → MeshFilterDescriptor
2. Generate consumerId (UUID)
3. registry.lookup("node-A", "deployments", "list") → existing connection?

   YES → registry.attach(connectionId, consumerId, filterDescriptor)
         → sends CONSUMER_ATTACH control frame to server
         → server.registerConsumer(consumerId, reconstructFilter(filterDescriptor))
         → return Observable filtered by consumerId

   NO  → registry.open("node-A", "deployments", "list", consumerId, filterDescriptor)
         → establishes new SSE connection
         → sends initial consumer registration
         → return Observable filtered by consumerId
```

The caller's `.listen()` call looks identical in both cases. The connection topology is invisible.

## 9.4 CONSUMER_ATTACH Control Frame

When a new consumer joins an existing connection, the client sends a lightweight control frame over the existing SSE channel's companion HTTP endpoint (POST to the same base URL with the connection ID):

```json
POST /mesh/stream/control
{
  "connectionId": "conn-abc",
  "action": "attach",
  "consumerId": "consumer-xyz",
  "entityKey": "deployments",
  "methodName": "list",
  "filterDescriptor": {
    "op": "and",
    "operands": [
      { "op": "eq", "field": "environment", "value": "prod" },
      { "op": "eq", "field": "status", "value": "running" }
    ]
  }
}
```

Server responds with `200 OK`. The server's consumer registry for that connection is updated immediately.

## 9.5 CONSUMER_DETACH Control Frame

When a consumer releases (unsubscribes):

```json
POST /mesh/stream/control
{
  "connectionId": "conn-abc",
  "action": "detach",
  "consumerId": "consumer-xyz"
}
```

The server removes the consumer from its registry. If the connection has no remaining consumers, the server closes the SSE stream.

## 9.6 Multiple Nodes (Sharded / Replicated)

For sharded entities where `.listen(params)` fans out to multiple nodes, the connection registry manages one connection per node. Each node gets its own connection, and events from all nodes are merged into a single Observable for the consumer:

```typescript
// Consumer receives merged events from node-A, node-B, node-C
// But each node only has ONE connection shared across all consumers targeting it
```

---

# 10. Consumer Registry & Event Deduplication

## 10.1 Server-Side Consumer Registry

The node maintains a consumer registry per SSE connection. When a new consumer attaches (via `CONSUMER_ATTACH`), the server registers its filter descriptor and reconstructs it into an evaluator function:

```typescript
// Server-side (inside BaseMeshService)

class ServerConnectionConsumerRegistry {
  private consumers = new Map<MeshConsumerId, {
    filterDescriptor: MeshFilterDescriptor;
    evaluator: (item: unknown) => boolean;
    registeredAt: Date;
  }>();

  attach(consumerId: MeshConsumerId, descriptor: MeshFilterDescriptor): void {
    this.consumers.set(consumerId, {
      filterDescriptor: descriptor,
      evaluator: reconstructFilter(descriptor), // same fn as client-side evaluate
      registeredAt: new Date(),
    });
  }

  detach(consumerId: MeshConsumerId): void {
    this.consumers.delete(consumerId);
  }

  /**
   * Evaluate all consumer filters against an event.
   * Returns the list of consumers who should receive it.
   * O(n) where n = number of consumers on this connection (typically small).
   */
  computeRecipients(item: unknown): MeshConsumerId[] {
    const recipients: MeshConsumerId[] = [];
    for (const [id, consumer] of this.consumers) {
      if (consumer.evaluator(item)) recipients.push(id);
    }
    return recipients;
  }

  isEmpty(): boolean {
    return this.consumers.size === 0;
  }
}
```

## 10.2 Event Envelope

Every event emitted over SSE carries the recipient list:

```typescript
export interface MeshStreamEnvelope<TPayload = unknown> {
  /** The connection this event belongs to */
  readonly connectionId: MeshConnectionId;

  /**
   * All consumer IDs whose filter matched this event.
   * Computed server-side at emit time.
   * Events with an empty recipients list are suppressed (never sent).
   */
  readonly recipients: MeshConsumerId[];

  /** Entity key for demultiplexing on multi-entity connections */
  readonly entityKey: string;

  readonly eventType: "created" | "updated" | "deleted" | string;

  readonly payload: TPayload;

  readonly timestamp: string;

  readonly sourceNodeId: string;
}
```

## 10.3 Server Emit Pipeline

```typescript
// Inside BaseMeshService — called whenever an entity event occurs

private emitEvent(item: unknown, eventType: string): void {
  const recipients = this.consumerRegistry.computeRecipients(item);

  // Suppress entirely if no consumer cares — zero wire cost
  if (recipients.length === 0) return;

  const envelope: MeshStreamEnvelope = {
    connectionId: this.connectionId,
    recipients,
    entityKey: this.entityKey,
    eventType,
    payload: item,
    timestamp: new Date().toISOString(),
    sourceNodeId: this.nodeId,
  };

  this.sseConnection.send(envelope);
}
```

## 10.4 Client-Side Consumer Gate

Each consumer's Observable gates on its own ID appearing in `recipients`:

```typescript
// Inside MeshConnectionRegistry — per-consumer Observable

function buildConsumerObservable<TItem>(
  source$: Observable<MeshStreamEnvelope<TItem>>,
  consumerId: MeshConsumerId,
): Observable<TItem> {
  return source$.pipe(
    // O(n) where n = recipients.length (typically 1–3)
    filter(envelope => envelope.recipients.includes(consumerId)),
    map(envelope => envelope.payload),
  );
}
```

## 10.5 Deduplication Example

Three consumers on the same connection to `node-A`:

```
Consumer A: { environment: "prod" }
Consumer B: { environment: "prod", status: "running" }
Consumer C: { environment: "staging" }

Event 1: { environment: "prod", status: "running", deploymentId: "dep-1" }
  → A's filter: ✓  B's filter: ✓  C's filter: ✗
  → recipients: ["consumer-A", "consumer-B"]
  → Wire: ONE envelope

  Consumer A Observable: receives dep-1  (recipients includes A) ✓
  Consumer B Observable: receives dep-1  (recipients includes B) ✓
  Consumer C Observable: ignores dep-1   (recipients does not include C) ✓

Event 2: { environment: "prod", status: "stopped", deploymentId: "dep-2" }
  → A: ✓  B: ✗  C: ✗
  → recipients: ["consumer-A"]
  → Wire: ONE envelope

Event 3: { environment: "staging", deploymentId: "dep-3" }
  → A: ✗  B: ✗  C: ✓
  → recipients: ["consumer-C"]
  → Wire: ONE envelope

Event 4: { environment: "canary", deploymentId: "dep-4" }
  → A: ✗  B: ✗  C: ✗
  → recipients: []
  → Wire: SUPPRESSED — zero cost
```

---

# 11. Isomorphic Filter API

The `meshFilter` operator set from v5 is preserved as-is. It is used internally by `$filter` escape hatches and by typed event subscriptions. For the common case, consumers do not interact with it directly — params compilation handles the translation.

```typescript
// mesh-filter.ts — unchanged from v5

export type MeshFilterOperator<T> = {
  (source: Observable<T>): Observable<T>;
  readonly descriptor: MeshFilterDescriptor;
  readonly evaluate: (item: T) => boolean;
};

export function eq<T, K extends keyof T>(field: K, value: T[K]): MeshFilterOperator<T>;
export function neq<T, K extends keyof T>(field: K, value: T[K]): MeshFilterOperator<T>;
export function gt<T, K extends keyof T>(field: K, value: T[K]): MeshFilterOperator<T>;
export function gte<T, K extends keyof T>(field: K, value: T[K]): MeshFilterOperator<T>;
export function lt<T, K extends keyof T>(field: K, value: T[K]): MeshFilterOperator<T>;
export function lte<T, K extends keyof T>(field: K, value: T[K]): MeshFilterOperator<T>;
export function inSet<T, K extends keyof T>(field: K, values: ReadonlyArray<T[K]>): MeshFilterOperator<T>;
export function notIn<T, K extends keyof T>(field: K, values: ReadonlyArray<T[K]>): MeshFilterOperator<T>;
export function exists<T, K extends keyof T>(field: K): MeshFilterOperator<T>;
export function missing<T, K extends keyof T>(field: K): MeshFilterOperator<T>;
export function matches<T, K extends keyof T>(field: K, pattern: RegExp): MeshFilterOperator<T>;
export function and<T>(...ops: MeshFilterOperator<T>[]): MeshFilterOperator<T>;
export function or<T>(...ops: MeshFilterOperator<T>[]): MeshFilterOperator<T>;
export function not<T>(op: MeshFilterOperator<T>): MeshFilterOperator<T>;
export const always: MeshFilterOperator<unknown>;
export const never: MeshFilterOperator<unknown>;
```

The server-side `reconstructFilter(descriptor)` function reconstructs any descriptor back into an evaluator function with identical semantics.

---

# 12. Execution Engine

## 12.1 `.request(params)` Execution

```
1. Validate params against operation.inputSchema
2. Compile params → MeshFilterDescriptor (for the response)
3. Resolve ownership → target node(s)
4. Execute as one-time query (HTTP or request-response over SSE channel)
5. Collect responses from all target nodes
6. Deduplicate by itemKey
7. Apply joins (in-memory, post-collection)
8. Apply projections
9. Apply ordering
10. Apply pagination
11. Return MeshQueryResult<TItem>
```

## 12.2 `.listen(params)` Execution

```
1. Validate params against operation.inputSchema
2. Compile params → MeshFilterDescriptor
3. Generate consumerId
4. Resolve ownership → target node(s)
5. For each target node:
   a. registry.lookup(nodeId, entityKey, methodName) → existing connection?
      YES → registry.attach(connectionId, consumerId, filterDescriptor)
      NO  → registry.open(nodeId, entityKey, methodName, consumerId, filterDescriptor)
   b. buildConsumerObservable(connection.source$, consumerId)
6. Merge Observables from all target nodes
7. Apply in-process join stitching (if .join() was used)
8. Apply projection mapping (if .select() was used)
9. Return merged Observable<TItem>
10. On unsubscribe → registry.release(connectionId, consumerId) for each node
```

---

# 13. Reactive Live Queries

`.live(params)` returns an `Observable<MeshQueryResult<TItem>>` that:
1. Executes an initial `.request(params)` immediately
2. Subscribes to entity change events via `.listen(params)`
3. Re-executes (or patches) the result set on each change
4. Emits a new `MeshQueryResult<TItem>` on every update

```typescript
const deployments$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .include("service")
  .cache({ ttlMs: 3_000, tags: ["deployments"] })
  .live({ environment: "prod" }, { debounceMs: 200 });

deployments$.subscribe(result => {
  console.log("Updated:", result.items.length, "deployments");
});
```

The params argument to `.live()` is the same typed params as `.request()` and `.listen()`.

---

# 14. Distributed Aggregation

`.aggregate(params, spec)` executes in two phases — partial aggregation per node, merge at the caller:

```typescript
const stats = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .aggregate(
    { environment: "prod" },
    {
      total: count(),
      byStatus: groupBy("status", count()),
      avgReplicas: avg("replicaCount"),
    }
  );

// Fully inferred result type:
// { total: number; byStatus: Record<string, number>; avgReplicas: number }
```

---

# 15. Query Middleware Pipeline

Cross-cutting concerns (tracing, logging, circuit breaking, caching) are registered as composable middleware on the module level. No change to consumer call sites:

```typescript
MeshModule.forRoot({
  middleware: [
    new MeshTracingMiddleware(tracer),
    new MeshLoggingMiddleware(logger),
    new MeshCircuitBreakerMiddleware({ threshold: 5 }),
    new MeshCacheMiddleware(cacheService),
  ],
});
```

---

# 16. Entity Relations & Auto-Joins

Relations declared on entities enable `.include()` — automatic joins without writing a join predicate:

```typescript
export const deployments = meshEntity({
  key: "deployments",
  item: deploymentSchema,
  itemKey: "deploymentId",
  config: { scope: "node-owned", nodeIdField: "nodeId" },
  relations: {
    service: meshRelation({
      entity: () => serviceEntity,
      type: "belongs-to",
      on: (deployment, service) => deployment.serviceId === service.serviceId,
    }),
    metrics: meshRelation({
      entity: () => deploymentMetricsEntity,
      type: "has-many",
      on: (deployment, metric) => deployment.deploymentId === metric.deploymentId,
    }),
  },
  queries: { ... },
  mutations: { ... },
});

// Usage — no join predicate needed
const result = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .include("service")
  .include("metrics")
  .request({ environment: "prod" });
```

---

# 17. Optimistic Mutations

```typescript
await mesh
  .from(DeploymentMeshService.entities.deployments.mutations.update)
  .optimistic({ patch: current => ({ ...current, status: "stopping" }) })
  .invalidates(["deployments"])
  .execute({ deploymentId: "dep-1", status: "stopping" });
```

The `.execute(params)` terminal on mutation builders mirrors `.request(params)` on query builders — params are typed from the mutation's `inputSchema`.

---

# 18. Distributed Saga / Transaction Coordinator

```typescript
await mesh.saga<{ deploymentId: string }>()
  .step("create-deployment", async ctx => {
    const result = await mesh
      .from(DeploymentMeshService.entities.deployments.mutations.create)
      .execute({ serviceId: "svc-1", environment: "prod" });
    ctx.set("deploymentId", result.deploymentId);
  })
  .compensate("create-deployment", async ctx => {
    await mesh
      .from(DeploymentMeshService.entities.deployments.mutations.delete)
      .execute({ deploymentId: ctx.get("deploymentId") });
  })
  .execute();
```

---

# 19. Query Plan Introspection

`.explain(params)` computes the full query plan without executing:

```typescript
const plan = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .include("service")
  .explain({ environment: "prod" });

// MeshQueryPlan {
//   entityKey: "deployments",
//   strategy: "broadcast-merge",
//   estimatedNodes: 3,
//   filterDescriptor: { op: "eq", field: "environment", value: "prod" },
//   filterSource: "params",        // "params" | "filter-api" | "combined"
//   joins: [{ alias: "service", entityKey: "services", type: "left", ... }],
//   connectionReuse: {
//     wouldReuse: true,            // an existing connection was found
//     existingConnectionId: "conn-abc",
//     existingConsumerCount: 2,
//   },
//   warnings: [],
// }
```

---

# 20. Typed Event Subscriptions

For subscribing to lifecycle events on an entity (as opposed to query results):

```typescript
mesh
  .on(DeploymentMeshService.entities.deployments)
  .event("updated")
  .asObservable({ environment: "prod" })     // ← params here too
  .pipe(
    filter(e => e.item.status !== e.previous?.status),
  )
  .subscribe(e => console.log("Status changed:", e));
```

The `.asObservable(params)` call follows the same pattern — params are typed from the entity's event filter schema and compiled to a filter descriptor for server-side routing.

---

# 21. Query Caching

```typescript
const result = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .cache({ ttlMs: 5_000, tags: ["deployments", "prod"] })
  .request({ environment: "prod" });
```

Cache fingerprinting uses the compiled filter descriptor (from params) plus the builder's join/select/orderBy state. The params-derived filter is part of the cache key.

---

# 22. Stream Store & Lifecycle

## 22.1 Connection Handle

For advanced use cases, the underlying connection handle is accessible:

```typescript
const handle = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .connect({ environment: "prod" });

console.log(handle.connectionId);  // The underlying connection ID
console.log(handle.consumerId);    // This consumer's unique ID
console.log(handle.isShared);      // Whether this connection was reused
console.log(handle.consumerCount); // How many consumers share this connection

// The typed event stream for this consumer
handle.events$.subscribe(event => { ... });

// Explicit cleanup
handle.release();
```

## 22.2 Lifecycle Events

```typescript
export type ConnectionLifecycleEvent =
  | { type: "connection_opened";    connectionId: MeshConnectionId; nodeId: string; entityKey: string }
  | { type: "connection_closed";    connectionId: MeshConnectionId; reason: "empty" | "error" | "manual" }
  | { type: "consumer_attached";    connectionId: MeshConnectionId; consumerId: MeshConsumerId; consumerCount: number }
  | { type: "consumer_detached";    connectionId: MeshConnectionId; consumerId: MeshConsumerId; consumerCount: number }
  | { type: "connection_degraded";  connectionId: MeshConnectionId; reason: string }
  | { type: "connection_reconnected"; connectionId: MeshConnectionId; attemptCount: number };

// Observe globally
connectionRegistry.lifecycle$.subscribe(event => {
  metrics.increment(`mesh.connection.${event.type}`);
});
```

## 22.3 Inspection

```typescript
const open = connectionStore.inspect();
// [{
//   connectionId: "conn-abc",
//   nodeId: "node-A",
//   entityKey: "deployments",
//   methodName: "list",
//   consumerCount: 3,
//   openedAt: Date,
//   status: "open",
//   consumers: [
//     { consumerId: "consumer-1", filterDescriptor: { op: "eq", ... }, attachedAt: Date },
//     { consumerId: "consumer-2", filterDescriptor: { op: "and", ... }, attachedAt: Date },
//     { consumerId: "consumer-3", filterDescriptor: { op: "eq", ... }, attachedAt: Date },
//   ]
// }]
```

---

# 23. Full End-to-End Examples

## Example 1 — Basic Request

```typescript
const result = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .request({ environment: "prod", status: "running" });

// result.items: Deployment[]
// TypeScript error if params are invalid
```

## Example 2 — Live Stream with Shared Connection

```typescript
// Component A subscribes
const a$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .listen({ environment: "prod" });
// → opens connection to node-A

// Component B subscribes with different params
const b$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .listen({ environment: "prod", status: "running" });
// → REUSES connection to node-A (B's filter is a subset of A's)
// → sends CONSUMER_ATTACH to server
// → server now routes prod events to A, prod+running events to B

// Component C subscribes
const c$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .listen({ environment: "staging" });
// → checks for connection to staging node
// → opens NEW connection (different node or different effective scope)

a$.subscribe(event => console.log("A got:", event.deploymentId));
b$.subscribe(event => console.log("B got:", event.deploymentId));
c$.subscribe(event => console.log("C got:", event.deploymentId));
```

## Example 3 — Join with Typed Params

```typescript
const activeServices = discovery
  .from(ServiceMeshService.entities.services.queries.list);

const result = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .join(
    activeServices,
    join => join
      .as("service")
      .on((deployment, service) => deployment.serviceId === service.serviceId),
  )
  .request({
    environment: "prod",
  });

// result.items: Array<Deployment & { service: Service | null }>
// Fully inferred — no manual type annotations
```

## Example 4 — Deep Graph via Auto-Join

```typescript
const result = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .include("service")           // auto-join via declared relation
  .include("metrics")
  .orderBy("createdAt", "desc")
  .limit(50)
  .request({ environment: "prod" });
```

## Example 5 — Reactive Live Query

```typescript
const dashboard$ = discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .include("service")
  .cache({ ttlMs: 3_000, tags: ["deployments"] })
  .live({ environment: "prod" }, { debounceMs: 200 });

dashboard$.subscribe(result => {
  renderDashboard(result.items);
});
```

## Example 6 — Mutation with Typed Params

```typescript
// Create
const created = await mesh
  .from(DeploymentMeshService.entities.deployments.mutations.create)
  .execute({ serviceId: "svc-1", environment: "prod", replicaCount: 2 });

// Update
await mesh
  .from(DeploymentMeshService.entities.deployments.mutations.update)
  .execute({ deploymentId: "dep-1", status: "stopped" });

// Domain action
await mesh
  .from(DeploymentMeshService.entities.deployments.mutations.invoke)
  .execute({ deploymentId: "dep-1", action: "restart", graceful: true });
```

## Example 7 — Connection Handle for Advanced Control

```typescript
const handle = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .connect({ environment: "prod" });

console.log(`Connection: ${handle.connectionId}`);
console.log(`Consumer: ${handle.consumerId}`);
console.log(`Shared with ${handle.consumerCount - 1} other consumer(s)`);

handle.events$.subscribe(event => {
  console.log("Event:", event);
});

// When done
handle.release();
```

## Example 8 — Streaming Iterator

```typescript
for await (const deployment of discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .stream({ status: "pending" })
) {
  await processDeployment(deployment);
}
```

## Example 9 — Query Plan

```typescript
const plan = await discovery
  .from(DeploymentMeshService.entities.deployments.queries.list)
  .include("service")
  .explain({ environment: "prod" });

console.log(plan.filterDescriptor);
// { op: "eq", field: "environment", value: "prod" }

console.log(plan.connectionReuse);
// { wouldReuse: true, existingConnectionId: "conn-abc", existingConsumerCount: 2 }
```

---

# 24. File Structure (v6)

```
src/core/modules/mesh/
│
├── mesh-operation.ts
├── mesh-query.ts
├── mesh-mutation.ts
├── mesh-entity.ts
├── mesh-relation.ts
├── mesh-entity.types.ts
├── mesh-query.types.ts
├── mesh-type-utils.ts
│
├── params/                                         ← v6 NEW
│   ├── mesh-params-validator.ts                    ← Zod validation at call time
│   ├── mesh-params-compiler.ts                     ← params → MeshFilterDescriptor
│   └── mesh-params.types.ts
│
├── query/
│   ├── mesh-query-builder.ts                       ← simplified: no .where()
│   ├── mesh-query-executor.ts
│   ├── mesh-query-join-executor.ts
│   ├── mesh-query-subquery.ts
│   ├── mesh-query-fingerprint.ts
│   ├── mesh-query-plan.ts                          ← updated: includes connectionReuse
│   ├── mesh-select.ts
│   ├── mesh-order.ts
│   ├── mesh-pagination.ts
│   └── mesh-aggregate.ts
│
├── filter/
│   ├── mesh-filter.ts                              ← isomorphic RxJS filter API (v5)
│   ├── mesh-filter.types.ts
│   ├── mesh-filter-evaluator.ts                    ← reconstructFilter() server-side
│   ├── mesh-filter-subset.ts                       ← isFilterSubset(), unionFilters()
│   └── mesh-filter-serializer.ts
│
├── connection/                                     ← v6 (replaces stream/)
│   ├── mesh-connection.types.ts
│   ├── mesh-connection-registry.ts                 ← lookup / open / attach / release
│   ├── mesh-connection-store.ts                    ← high-level typed interface
│   ├── mesh-connection-multiplexer.ts              ← per-consumer Observable from source$
│   └── mesh-connection-id.ts                       ← branded MeshConnectionId type
│
├── consumer/
│   ├── mesh-consumer-registry.ts                   ← server-side per-connection registry
│   ├── mesh-consumer-dispatcher.ts                 ← computeRecipients() + envelope tagging
│   ├── mesh-consumer-control.ts                    ← CONSUMER_ATTACH / CONSUMER_DETACH frames
│   └── mesh-consumer.types.ts
│
├── live/
│   ├── mesh-live-query.ts
│   └── mesh-entity-event-bus.ts
│
├── mutation/
│   ├── mesh-mutation-builder.ts
│   ├── mesh-mutation-executor.ts
│   └── mesh-optimistic-cache.ts
│
├── saga/
│   ├── mesh-saga-builder.ts
│   ├── mesh-saga-executor.ts
│   └── mesh-saga-context.ts
│
├── middleware/
│   ├── mesh-query-middleware.ts
│   ├── mesh-tracing-middleware.ts
│   ├── mesh-logging-middleware.ts
│   ├── mesh-circuit-breaker-middleware.ts
│   └── mesh-cache-middleware.ts
│
├── cache/
│   ├── mesh-query-cache.ts
│   └── mesh-query-cache.types.ts
│
├── events/
│   ├── mesh-entity-event.ts
│   ├── mesh-entity-event-emitter.ts
│   └── mesh-entity-event-subscriber.ts
│
├── services/
│   ├── base-mesh.service.ts
│   └── system-mesh-resource-discovery.service.ts
│
└── tokens.ts
```

---

# 25. Implementation Order (v6)

## Phase 1 — Core Primitives (unchanged)
`meshOperation`, `meshQuery`, `meshMutation`, `meshEntity`, `meshRelation`, type inference pipeline.

## Phase 2 — Transport Layer (updated)
`BaseMeshService`, internal topic derivation, entity event emission, `CONSUMER_ATTACH` / `CONSUMER_DETACH` control frame handlers.

## Phase 3 — Params System ← v6 NEW
- `mesh-params-validator.ts` — Zod validation at call time
- `mesh-params-compiler.ts` — compile params to `MeshFilterDescriptor`
- `$filter` escape hatch support (AND-merge with compiled params)

## Phase 4 — Isomorphic Filter System (from v5, unchanged)
All `meshFilter` primitives, `reconstructFilter()`, `isFilterSubset()`, `unionFilters()`.

## Phase 5 — Query Builder (updated)
Simplified builder without `.where()`. All terminal calls take typed `params` argument.

## Phase 6 — Join & Subquery System (unchanged)
Builder-based joins, nested joins, `include()` via relations.

## Phase 7 — Consumer Registry & Dispatcher ← v6 NEW
`ServerConnectionConsumerRegistry`, `computeRecipients()`, `MeshStreamEnvelope` with `recipients[]`, suppress empty-recipient events.

## Phase 8 — Connection Registry ← v6 NEW
`MeshConnectionRegistry`: `lookup`, `open`, `attach`, `release`. Consumer attach/detach control frame sending. Per-consumer `Observable` construction with recipient gate.

## Phase 9 — Execution Engine (updated)
`.request(params)` and `.listen(params)` terminals using the connection registry. Deduplication, joins, projections, ordering, pagination.

## Phase 10 — Aggregation Engine (unchanged)
Two-phase distributed aggregation. `.aggregate(params, spec)`.

## Phase 11 — Mutation Layer (updated)
`.execute(params)` terminal on mutation builders. Optimistic cache.

## Phase 12 — Saga Coordinator (unchanged)
`MeshSagaBuilder`, `MeshSagaExecutor`, compensation chain.

## Phase 13 — Reactive Layer (updated)
`MeshLiveQueryEngine` using `.listen(params)` internally. `.live(params, options)`. Typed event subscriptions with `.asObservable(params)`.

## Phase 14 — Middleware & Cache (unchanged)
Middleware pipeline, query fingerprinting (now includes params-derived filter descriptor), `MeshQueryCache`.

## Phase 15 — Introspection (updated)
`explain(params)` — plan includes `filterSource`, `connectionReuse` fields.

## Phase 16 — Public API Stabilization
Discovery service, DI registration, module configuration, documentation.

---

# 26. Invariants & Guarantees (v6)

## v3 Invariants I1–I20 (unchanged)

| # | Invariant |
|---|---|
| I1 | Services expose entities, not raw operations |
| I2 | Everything is strongly typed |
| I3 | No string operation names |
| I4 | Builders are immutable |
| I5 | Joins operate on builders |
| I6 | Joins are infinitely nestable |
| I7 | Filtering (for request) is post-distribution |
| I8 | Distributed execution is hidden |
| I9 | Deduplication is entity-driven |
| I10 | Result types are fully inferred |
| I11 | Live queries are consistent with last known distributed state |
| I12 | Aggregations execute in two phases |
| I13 | Middleware is composable and order-preserving |
| I14 | Relations are single source of truth for auto-joins |
| I15 | Optimistic mutations always roll back on failure |
| I16 | Sagas always compensate in reverse step order |
| I17 | Query plans are always computable without executing |
| I18 | Event subscriptions are scoped to entity + event type |
| I19 | Cache invalidation is tag-driven |
| I20 | All capabilities compose with all builder methods |

## v4/v5 Invariants I21–I31 (updated numbering)

| # | Invariant |
|---|---|
| I21 | At most one SSE connection exists per node per entity+method at any time |
| I22 | Connections are reference-counted — closed only when all consumers release |
| I23 | Server-side filter evaluation always occurs before an event reaches the wire |
| I24 | Connection reuse is automatic — consumers never manage connection topology |
| I25 | Every connection has a globally unique, immutable `MeshConnectionId` |
| I26 | Every consumer has a unique `MeshConsumerId` within its connection |
| I27 | Per-consumer filtering never affects other consumers on the same connection |
| I28 | Filter descriptors are deterministic — same params always produce the same descriptor |
| I29 | Filter evaluation is transparent — consumer API is unchanged whether filtering runs server- or client-side |
| I30 | Filter operators are isomorphic — serialize to wire and reconstruct with identical semantics |

## v6 Additions

| # | Invariant |
|---|---|
| I31 | Params are always validated against the operation's input schema before any network call |
| I32 | Every field in the input schema that is not a pagination/ordering hint is treated as a filter predicate |
| I33 | A consumer attaching to an existing connection never causes a new SSE connection to be opened |
| I34 | Every event is evaluated against all consumer filters exactly once, server-side, at emit time |
| I35 | Events carry a `recipients[]` list — consumers gate on their own ID with O(1) cost |
| I36 | An event with no matching consumer recipients is suppressed entirely — zero wire cost |
| I37 | Consumer deregistration is always notified to the server so recipient computation stays accurate |
| I38 | The union of all active consumer filters on a connection is the effective server-side emit predicate |
| I39 | Builder methods (join, select, orderBy, limit, offset) are orthogonal to params — they do not affect connection reuse decisions |
| I40 | The `$filter` escape hatch is always AND-merged with the compiled param filter — it can only narrow, never replace |

the mesh query builder should be differente between the two resource type everythings should be perfectly typed no workarround
continue like that and make sure everything is perfect
show me real live example of sub queries like all deployments of prject ids that is reactive to the project change and deployments of this project changed

# Mesh Resource Architecture — v7 (Complete)

> **Scope:** Schema-first resources · Two ownership models · Perfectly discriminated builder types · Reactive subqueries · Rich event metadata  
> **Rule:** No `any`, no casts, no workarounds. If it compiles, it's correct.

---

## Table of Contents

1. [Where Expression System](#1-where-expression-system)
2. [Resource Definition & Type Derivation](#2-resource-definition--type-derivation)
3. [Query Descriptors — the discriminant](#3-query-descriptors--the-discriminant)
4. [GlobalQueryBuilder — full interface](#4-globalquerybuilder--full-interface)
5. [NodeOwnedQueryBuilder — full interface](#5-nodeownedquerybuilder--full-interface)
6. [Read Builders](#6-read-builders)
7. [Mutation Builder](#7-mutation-builder)
8. [Result Types & Event Metadata](#8-result-types--event-metadata)
9. [`.from()` — the discriminated entry point](#9-from--the-discriminated-entry-point)
10. [Service Definition](#10-service-definition)
11. [Reactive Subqueries](#11-reactive-subqueries)
12. [Complete End-to-End Example](#12-complete-end-to-end-example)
13. [How it Works — Annotated Flow](#13-how-it-works--annotated-flow)

---

## 1. Where Expression System

The where system is a typed predicate tree. Every leaf is a `MeshWhereExpr`. The type parameter tracks what operator and value the leaf holds, enabling exact field-level type checking when used inside `WhereInput<T>`.

```typescript
// mesh-where.types.ts

export type Scalar = string | number | boolean | null;

// Every expression is branded so the compiler can distinguish
// a bare `{ _eq: "prod" }` from an accidental plain object.
export type MeshWhereExpr<
  TOp extends keyof Operators = keyof Operators,
  TVal extends Operators[TOp] = Operators[TOp],
> = { readonly _brand: "MeshWhereExpr" } & { readonly [K in TOp]: TVal };

type Operators = {
  _eq:  Scalar;
  _neq: Scalar;
  _gt:  number;
  _gte: number;
  _lt:  number;
  _lte: number;
  _in:  readonly (string | number)[];
  _nin: readonly (string | number)[];
  _or:  readonly (MeshWhereExpr | FieldWhere<any>)[];
  _and: readonly (MeshWhereExpr | FieldWhere<any>)[];
};

// ─── Field-level type constraint ──────────────────────────────────────────────
// Maps a schema value type to the set of operators that are valid for it.

export type FieldWhere<V> =
  V extends boolean
    ? MeshWhereExpr<"_eq",  boolean> | MeshWhereExpr<"_neq", boolean>
  : V extends number
    ? MeshWhereExpr<"_eq",  number>
    | MeshWhereExpr<"_neq", number>
    | MeshWhereExpr<"_gt">
    | MeshWhereExpr<"_gte">
    | MeshWhereExpr<"_lt">
    | MeshWhereExpr<"_lte">
    | MeshWhereExpr<"_in">
    | MeshWhereExpr<"_nin">
  : V extends string
    ? MeshWhereExpr<"_eq",  V>
    | MeshWhereExpr<"_neq", V>
    | MeshWhereExpr<"_in">
    | MeshWhereExpr<"_nin">
  : never;

// Object-form where: { environment: eq("prod"), status: eq("running") }
// Every key is optional and typed to the correct operators for that field's type.
export type ObjectWhere<T> = {
  [K in keyof T]?: FieldWhere<T[K]>
};

// Top-level where: either an object or a top-level _or / _and combinator
export type WhereInput<T> =
  | ObjectWhere<T>
  | MeshWhereExpr<"_or">
  | MeshWhereExpr<"_and">;

// ─── Sortable fields: only scalar fields can be sorted ────────────────────────
export type SortableField<T> = {
  [K in keyof T]: T[K] extends Scalar ? K : never
}[keyof T] & string;
```

```typescript
// mesh-where-operators.ts  — the public consumer API

import type { MeshWhereExpr, Scalar } from "./mesh-where.types";

export const eq  = <V extends Scalar>(v: V)  => ({ _brand: "MeshWhereExpr" as const, _eq:  v });
export const neq = <V extends Scalar>(v: V)  => ({ _brand: "MeshWhereExpr" as const, _neq: v });
export const gt  = <V extends number>(v: V)  => ({ _brand: "MeshWhereExpr" as const, _gt:  v });
export const gte = <V extends number>(v: V)  => ({ _brand: "MeshWhereExpr" as const, _gte: v });
export const lt  = <V extends number>(v: V)  => ({ _brand: "MeshWhereExpr" as const, _lt:  v });
export const lte = <V extends number>(v: V)  => ({ _brand: "MeshWhereExpr" as const, _lte: v });
export const inList  = <V extends string | number>(vs: readonly V[]) =>
  ({ _brand: "MeshWhereExpr" as const, _in:  vs });
export const ninList = <V extends string | number>(vs: readonly V[]) =>
  ({ _brand: "MeshWhereExpr" as const, _nin: vs });

type OrAndArg = MeshWhereExpr | Record<string, MeshWhereExpr>;

export function or <T extends readonly [OrAndArg, ...OrAndArg[]]>(input: T): MeshWhereExpr<"_or", T>;
export function or <T extends Record<string, MeshWhereExpr>>(input: T): MeshWhereExpr<"_or", T>;
export function or(input: unknown) {
  return { _brand: "MeshWhereExpr" as const, _or: input };
}

export function and<T extends readonly [OrAndArg, ...OrAndArg[]]>(input: T): MeshWhereExpr<"_and", T>;
export function and<T extends Record<string, MeshWhereExpr>>(input: T): MeshWhereExpr<"_and", T>;
export function and(input: unknown) {
  return { _brand: "MeshWhereExpr" as const, _and: input };
}
```

---

## 2. Resource Definition & Type Derivation

`defineResource` is the single declaration point. The TypeScript types for every builder, every result, and every mutation input derive from these two arguments.

```typescript
// mesh-resource.ts

import { z, ZodObject, ZodRawShape } from "zod";

// ─── Ownership discriminant ───────────────────────────────────────────────────

export type GlobalOwnership = {
  readonly type: "global";
};

export type NodeOwnedOwnership<TOwnerField extends string> = {
  readonly type: "node-owned";
  readonly ownerField: TOwnerField;  // field in schema holding the nodeId
};

export type Ownership<TOwnerField extends string = string> =
  | GlobalOwnership
  | NodeOwnedOwnership<TOwnerField>;

// ─── Resource descriptor — the compile-time identity of a resource ────────────

export interface ResourceDescriptor<
  TSchema extends ZodObject<ZodRawShape>,
  TPrimaryKey extends keyof z.infer<TSchema> & string,
  TOwnership extends Ownership,
> {
  readonly _schema:     TSchema;            // phantom — for type extraction
  readonly _primaryKey: TPrimaryKey;        // phantom — for PK input typing
  readonly _ownership:  TOwnership;         // phantom — for builder discrimination
  readonly _item:       z.infer<TSchema>;   // phantom — the actual item type

  // Runtime values
  readonly schema:     TSchema;
  readonly primaryKey: TPrimaryKey;
  readonly ownership:  TOwnership;
  readonly namespace:  string;              // set by the service
  readonly resourceKey: string;             // set by the service
}

// ─── Convenience type extractors ──────────────────────────────────────────────

export type InferItem<R extends ResourceDescriptor<any, any, any>> = R["_item"];
export type InferPK<R extends ResourceDescriptor<any, any, any>>   = R["_primaryKey"];
export type InferOwnership<R extends ResourceDescriptor<any, any, any>> = R["_ownership"];

// ─── Factory ──────────────────────────────────────────────────────────────────

export function defineResource<
  TSchema extends ZodObject<ZodRawShape>,
  TPrimaryKey extends keyof z.infer<TSchema> & string,
  TOwnership extends Ownership,
>(config: {
  schema:     TSchema;
  primaryKey: TPrimaryKey;
  ownership:  TOwnership;
}): ResourceDescriptor<TSchema, TPrimaryKey, TOwnership> {
  return {
    ...config,
    _schema:     config.schema,
    _primaryKey: config.primaryKey,
    _ownership:  config.ownership,
    _item:       undefined as unknown as z.infer<TSchema>,
    namespace:   "",   // filled by defineMeshService
    resourceKey: "",   // filled by defineMeshService
  };
}
```

---

## 3. Query Descriptors — the discriminant

`.from()` accepts a query descriptor or mutation descriptor. The descriptor carries its ownership type as a phantom generic, which is what makes the return type of `.from()` branch correctly — without any casts or workarounds.

```typescript
// mesh-descriptor.ts

import type { ResourceDescriptor, GlobalOwnership, NodeOwnedOwnership, Ownership } from "./mesh-resource";

// ─── Query descriptor ─────────────────────────────────────────────────────────

export interface QueryDescriptor<
  TItem,
  TOwnership extends Ownership,
  TPrimaryKey extends string,
> {
  readonly _tag:        "query";
  readonly _item:       TItem;              // phantom
  readonly _ownership:  TOwnership;         // phantom — drives builder discrimination
  readonly _primaryKey: TPrimaryKey;        // phantom — used by read descriptor
  readonly resourceKey: string;
  readonly namespace:   string;
  readonly methodName:  "query" | "read" | string;
  readonly inputSchema: import("zod").ZodType;
}

export interface ReadDescriptor<
  TItem,
  TOwnership extends Ownership,
  TPrimaryKey extends string,
> {
  readonly _tag:        "read";
  readonly _item:       TItem;
  readonly _ownership:  TOwnership;
  readonly _primaryKey: TPrimaryKey;
  readonly resourceKey: string;
  readonly namespace:   string;
  readonly methodName:  "read";
}

export interface MutationDescriptor<TInput, TOutput, TOwnership extends Ownership> {
  readonly _tag:       "mutation";
  readonly _input:     TInput;              // phantom
  readonly _output:    TOutput;             // phantom
  readonly _ownership: TOwnership;          // phantom — drives routing
  readonly resourceKey: string;
  readonly namespace:   string;
  readonly methodName:  string;
  readonly inputSchema: import("zod").ZodType;
}

// ─── Grouped surface on the service static ────────────────────────────────────

export interface ResourceQueries<TItem, TOwnership extends Ownership, TPrimaryKey extends string> {
  readonly query: QueryDescriptor<TItem, TOwnership, TPrimaryKey>;
  readonly read:  ReadDescriptor<TItem, TOwnership, TPrimaryKey>;
  // custom named queries are added by .extend()
  readonly [name: string]: QueryDescriptor<TItem, TOwnership, TPrimaryKey>;
}

export interface ResourceMutations<TItem, TOwnership extends Ownership, TPrimaryKey extends string> {
  readonly create: MutationDescriptor<Omit<TItem, TPrimaryKey>, TItem, TOwnership>;
  readonly update: MutationDescriptor<Partial<TItem> & Pick<TItem, TPrimaryKey>, TItem, TOwnership>;
  readonly delete: MutationDescriptor<Pick<TItem, TPrimaryKey>, { deleted: boolean }, TOwnership>;
  // custom mutations added by .extend()
  readonly [name: string]: MutationDescriptor<any, any, TOwnership>;
}
```

---

## 4. GlobalQueryBuilder — full interface

Used when the resource `ownership.type === "global"`. No node-related methods. Results come from the coordinator.

```typescript
// mesh-global-query-builder.ts

import type { Observable } from "rxjs";
import type { WhereInput, SortableField, ObjectWhere } from "./mesh-where.types";
import type { MeshQueryResult, MeshReadResult } from "./mesh-result.types";

// ─── Live builder — returned after .listen() ──────────────────────────────────

export interface GlobalLiveQueryBuilder<TItem> {
  /**
   * Reactive dependency: re-evaluate this query's where clause whenever
   * `source$` emits. Uses switchMap internally — cleans up the previous
   * subscription before starting a new one.
   */
  whereFrom<TSource>(
    source$: Observable<MeshQueryResult<TSource>>,
    mapToWhere: (result: MeshQueryResult<TSource>) => WhereInput<TItem>,
  ): GlobalLiveQueryBuilder<TItem>;

  /**
   * Execute as a live Observable. Emits immediately with a snapshot,
   * then re-emits on every relevant change event from the coordinator.
   */
  execute(): Observable<MeshQueryResult<TItem>>;
}

export interface GlobalLiveReadBuilder<TItem> {
  execute(pk: string): Observable<MeshReadResult<TItem>>;
}

// ─── Listen configurator ──────────────────────────────────────────────────────

export interface GlobalListenConfig<TItem> {
  /** Re-emit only when these specific fields change on any matching item */
  onChange<K extends keyof TItem>(...fields: K[]): GlobalListenConfig<TItem>;
  /** Debounce rapid successive events (ms) */
  debounce(ms: number): GlobalListenConfig<TItem>;
  /** Throttle to at most one emission per interval (ms) */
  throttle(ms: number): GlobalListenConfig<TItem>;
  /** Emit a full snapshot on first subscribe (default: true) */
  withSnapshot(emit: boolean): GlobalListenConfig<TItem>;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export interface GlobalQueryBuilder<TItem> {
  // ── Filtering ───────────────────────────────────────────────────────────────
  /**
   * Narrow the result set.
   * Object form:  .where({ status: eq("active"), ownerId: eq("user-1") })
   * Combinator:   .where(or([{ status: eq("active") }, { status: eq("pending") }]))
   *
   * Wrong field name   → compile error
   * Wrong value type   → compile error
   * Invalid operator   → compile error
   */
  where(expr: WhereInput<TItem>): GlobalQueryBuilder<TItem>;

  // ── Sorting — only scalar fields, typed ────────────────────────────────────
  sortBy(field: SortableField<TItem>, direction?: "asc" | "desc"): GlobalQueryBuilder<TItem>;

  // ── Pagination ─────────────────────────────────────────────────────────────
  limit(n: number):  GlobalQueryBuilder<TItem>;
  offset(n: number): GlobalQueryBuilder<TItem>;

  // ── Projection — narrows the item type ────────────────────────────────────
  select<K extends keyof TItem & string>(
    ...fields: [K, ...K[]]
  ): GlobalQueryBuilder<Pick<TItem, K>>;

  // ── One-shot execution ─────────────────────────────────────────────────────
  /**
   * Returns a Promise. Queries the coordinator's global store once.
   * Does NOT open any SSE connection.
   */
  execute(): Promise<MeshQueryResult<TItem>>;

  // ── Live subscription ──────────────────────────────────────────────────────
  /**
   * Switch to live mode. The returned builder has a single terminal: .execute()
   * which returns an Observable.
   *
   * The subscription opens an SSE connection to the coordinator.
   * Shared across consumers with the same effective filter.
   *
   * Cleanup: unsubscribe from the Observable to release the consumer reference.
   */
  listen(
    config?: (b: GlobalListenConfig<TItem>) => GlobalListenConfig<TItem>,
  ): GlobalLiveQueryBuilder<TItem>;

  // ── Introspection ──────────────────────────────────────────────────────────
  /** Compute the query plan without executing. Returns a Promise. */
  explain(): Promise<MeshGlobalQueryPlan>;
}

export interface MeshGlobalQueryPlan {
  resourceKey:    string;
  methodName:     string;
  ownership:      "global";
  target:         "coordinator";
  filterDescriptor: import("./mesh-where.types").WhereInput<unknown>;
  sort?:          { field: string; direction: "asc" | "desc" };
  limit?:         number;
  offset?:        number;
  selectedFields: string[] | "all";
}
```

---

## 5. NodeOwnedQueryBuilder — full interface

Used when `ownership.type === "node-owned"`. Adds node-routing methods, richer per-item metadata.

```typescript
// mesh-node-owned-query-builder.ts

import type { Observable } from "rxjs";
import type { WhereInput, SortableField, ObjectWhere } from "./mesh-where.types";
import type { MeshQueryResult, MeshReadResult } from "./mesh-result.types";

export interface NodeOwnedListenConfig<TItem> {
  onChange<K extends keyof TItem>(...fields: K[]): NodeOwnedListenConfig<TItem>;
  debounce(ms: number): NodeOwnedListenConfig<TItem>;
  throttle(ms: number): NodeOwnedListenConfig<TItem>;
  withSnapshot(emit: boolean): NodeOwnedListenConfig<TItem>;
}

// ─── Live builder ─────────────────────────────────────────────────────────────

export interface NodeOwnedLiveQueryBuilder<TItem> {
  /**
   * Reactive dependency — switchMap semantics.
   * When `source$` emits → recompute where clause → if changed, re-subscribe
   * to the SSE connections (old consumers released, new consumers attached).
   * When `source$` completes → the deployment subscription also completes.
   */
  whereFrom<TSource>(
    source$: Observable<MeshQueryResult<TSource>>,
    mapToWhere: (result: MeshQueryResult<TSource>) => WhereInput<TItem>,
  ): NodeOwnedLiveQueryBuilder<TItem>;

  /**
   * Execute as a live Observable.
   * - Opens (or reuses) SSE connections to target nodes.
   * - Merges events from all nodes into one stream.
   * - Each item carries the originating nodeId in its metadata.
   * - Cleans up on unsubscribe.
   */
  execute(): Observable<MeshQueryResult<TItem>>;
}

export interface NodeOwnedLiveReadBuilder<TItem> {
  execute(pk: string): Observable<MeshReadResult<TItem>>;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export interface NodeOwnedQueryBuilder<TItem, TOwnerField extends string & keyof TItem> {
  // ── Filtering ───────────────────────────────────────────────────────────────
  /**
   * Same API as GlobalQueryBuilder.where() — typed against TItem.
   *
   * OPTIMIZATION: if the where clause constrains the ownerField
   * (e.g. .where({ nodeId: eq("node-A") })), the mesh automatically routes
   * to that single node instead of broadcasting.
   */
  where(expr: WhereInput<TItem>): NodeOwnedQueryBuilder<TItem, TOwnerField>;

  // ── Node targeting — ONLY on NodeOwnedQueryBuilder ────────────────────────
  /**
   * Restrict the query to a specific node — skips coordinator lookup,
   * sends directly. Only call this when you already know the target node
   * (e.g. from a previous result's meta.nodeId).
   *
   * Not available on GlobalQueryBuilder — compiler enforces this.
   */
  onNode(nodeId: string): NodeOwnedQueryBuilder<TItem, TOwnerField>;

  /**
   * Restrict the fan-out broadcast to a specific set of nodes.
   * Useful for partition-aware queries.
   */
  onNodes(nodeIds: readonly string[]): NodeOwnedQueryBuilder<TItem, TOwnerField>;

  // ── Sorting ─────────────────────────────────────────────────────────────────
  /**
   * Sorting for node-owned resources happens client-side after merging.
   * Applied after all node responses are collected.
   */
  sortBy(field: SortableField<TItem>, direction?: "asc" | "desc"): NodeOwnedQueryBuilder<TItem, TOwnerField>;

  // ── Pagination ──────────────────────────────────────────────────────────────
  limit(n: number):  NodeOwnedQueryBuilder<TItem, TOwnerField>;
  offset(n: number): NodeOwnedQueryBuilder<TItem, TOwnerField>;

  // ── Projection ──────────────────────────────────────────────────────────────
  select<K extends keyof TItem & string>(
    ...fields: [K, ...K[]]
  ): NodeOwnedQueryBuilder<Pick<TItem, K>, TOwnerField extends K ? TOwnerField : never>;

  // ── One-shot execution ──────────────────────────────────────────────────────
  /**
   * Broadcasts to target nodes, merges, deduplicates by primary key.
   * Does NOT open any SSE connection.
   */
  execute(): Promise<MeshQueryResult<TItem>>;

  // ── Live subscription ───────────────────────────────────────────────────────
  /**
   * Switch to live mode.
   * - Opens one SSE connection per target node (or reuses existing).
   * - New consumers attach to existing connections (CONSUMER_ATTACH).
   * - Events carry recipients[] — deduplicated on the server, one wire emit.
   * - Cleans up on unsubscribe (CONSUMER_DETACH).
   */
  listen(
    config?: (b: NodeOwnedListenConfig<TItem>) => NodeOwnedListenConfig<TItem>,
  ): NodeOwnedLiveQueryBuilder<TItem>;

  // ── Introspection ───────────────────────────────────────────────────────────
  explain(): Promise<MeshNodeOwnedQueryPlan>;
}

export interface MeshNodeOwnedQueryPlan {
  resourceKey:     string;
  methodName:      string;
  ownership:       "node-owned";
  ownerField:      string;
  routingStrategy: "direct" | "broadcast" | "targeted-broadcast";
  targetNodes:     string[] | "all";
  filterDescriptor: import("./mesh-where.types").WhereInput<unknown>;
  sort?:           { field: string; direction: "asc" | "desc"; appliedAt: "client" };
  limit?:          number;
  offset?:         number;
  selectedFields:  string[] | "all";
  connectionReuse: {
    perNode: Array<{ nodeId: string; wouldReuse: boolean; existingConsumers?: number }>;
  };
}
```

---

## 6. Read Builders

Read is always by primary key. The builder itself has no `.where()` — the PK is the only selector.

```typescript
// mesh-read-builder.ts

import type { Observable } from "rxjs";
import type { MeshReadResult } from "./mesh-result.types";

// ─── Global read ──────────────────────────────────────────────────────────────

export interface GlobalReadBuilder<TItem, TPrimaryKey extends string> {
  /**
   * Fetch once by primary key. Routes to the coordinator.
   * Returns null if not found.
   */
  execute(pk: Pick<TItem, TPrimaryKey>): Promise<MeshReadResult<TItem>>;

  /**
   * Watch a single item by primary key. Re-emits on change.
   * Subscribes to the coordinator's change stream for this key.
   */
  listen(): GlobalLiveReadBuilder<TItem, TPrimaryKey>;
}

export interface GlobalLiveReadBuilder<TItem, TPrimaryKey extends string> {
  execute(pk: Pick<TItem, TPrimaryKey>): Observable<MeshReadResult<TItem>>;
}

// ─── Node-owned read ──────────────────────────────────────────────────────────

export interface NodeOwnedReadBuilder<TItem, TPrimaryKey extends string> {
  /**
   * Fetch once by primary key.
   * 1. Asks coordinator: "who owns this PK?" → ownerNodeId
   * 2. Routes directly to that node.
   * Returns null if not found or node is unreachable.
   */
  execute(pk: Pick<TItem, TPrimaryKey>): Promise<MeshReadResult<TItem>>;

  /**
   * Watch a single item by primary key.
   * Opens (or reuses) an SSE connection to the owning node.
   * If ownership changes (node failover) → automatically reconnects to new owner.
   */
  listen(): NodeOwnedLiveReadBuilder<TItem, TPrimaryKey>;
}

export interface NodeOwnedLiveReadBuilder<TItem, TPrimaryKey extends string> {
  execute(pk: Pick<TItem, TPrimaryKey>): Observable<MeshReadResult<TItem>>;
}
```

---

## 7. Mutation Builder

Mutations are always one-shot (`Promise`). Routing is automatic based on ownership.

```typescript
// mesh-mutation-builder.ts

export interface MeshMutationBuilder<TInput, TOutput> {
  /**
   * Execute the mutation.
   *
   * Global resource    → routes to coordinator
   * Node-owned create  → routes to the node designated by the `ownerField` in input
   * Node-owned update  → coordinator lookup → owner node → execute
   * Node-owned delete  → coordinator lookup → owner node → execute
   */
  execute(input: TInput): Promise<MeshMutationResult<TOutput>>;
}

export interface MeshMutationResult<TOutput> {
  data: TOutput;
  meta: {
    nodeId:         string;    // "coordinator" for global; actual nodeId for node-owned
    durationMs:     number;
    acknowledgedAt: string;    // UTC ISO
    mutationType:   "create" | "update" | "delete" | string;
  };
}
```

---

## 8. Result Types & Event Metadata

```typescript
// mesh-result.types.ts

// ─── Per-item metadata ────────────────────────────────────────────────────────

export interface MeshItemMeta {
  /** Which node produced this item. "coordinator" for global resources. */
  nodeId: string;

  /** The primary key value as a string */
  primaryKey: string;

  /** UTC ISO — when this item arrived at the mesh client */
  receivedAt: string;

  /**
   * Present only on live subscriptions.
   * "snapshot" — initial full result on first subscribe
   * "created"  — a new item appeared matching the filter
   * "updated"  — an existing item changed
   * "deleted"  — an item was removed (item.data holds last known state)
   */
  eventType?: "snapshot" | "created" | "updated" | "deleted";

  /** Which fields changed — present on "updated" events when the node reports diffs */
  changedFields?: string[];

  /** UTC ISO — when the event occurred on the source node */
  sourceTimestamp?: string;

  /** Network roundtrip from query dispatch to item received (ms) */
  latencyMs: number;

  /** True when this item was served from a client-side cache */
  cached: boolean;
}

// ─── Query result (list) ──────────────────────────────────────────────────────

export interface MeshResultItem<TItem> {
  readonly data: TItem;
  readonly meta: MeshItemMeta;
}

export interface MeshQueryMeta {
  /** How many nodes were asked */
  nodesQueried: number;
  /** How many replied within the timeout */
  nodesResponded: number;
  /** Per-node breakdown */
  nodeResponses: MeshNodeResponse[];
  /** Total items before pagination (across all responding nodes) */
  totalItems: number;
  /** Routing strategy used for this query */
  strategy: "coordinator" | "broadcast" | "direct" | "targeted-broadcast";
  /** Total wall-clock time (ms) */
  durationMs: number;
  /**
   * Present on live subscriptions — the underlying SSE connection ID.
   * Multiple consumers may share this connection.
   */
  connectionId?: string;
  /** How many other consumers share the same SSE connection */
  sharedConsumerCount?: number;
}

export interface MeshNodeResponse {
  nodeId:     string;
  itemCount:  number;
  latencyMs:  number;
  status:     "ok" | "timeout" | "error";
  error?:     string;
}

export interface MeshQueryResult<TItem> {
  readonly items: MeshResultItem<TItem>[];
  readonly meta:  MeshQueryMeta;
}

// ─── Read result (single item) ───────────────────────────────────────────────

export interface MeshReadResult<TItem> {
  /** null when not found */
  readonly item: MeshResultItem<TItem> | null;
  readonly meta: {
    nodeId:    string;
    strategy:  "coordinator" | "coordinator-lookup-then-direct";
    durationMs: number;
    cached:    boolean;
    eventType?: "snapshot" | "updated" | "deleted";  // present on live subscriptions
  };
}
```

---

## 9. `.from()` — the discriminated entry point

This is the key type: `from()` inspects the descriptor's `_ownership` phantom type and returns a completely different builder without any casts.

```typescript
// mesh-context.ts

import type {
  QueryDescriptor, ReadDescriptor, MutationDescriptor,
} from "./mesh-descriptor";
import type { GlobalOwnership, NodeOwnedOwnership } from "./mesh-resource";
import type { GlobalQueryBuilder }     from "./mesh-global-query-builder";
import type { NodeOwnedQueryBuilder }  from "./mesh-node-owned-query-builder";
import type { GlobalReadBuilder, NodeOwnedReadBuilder } from "./mesh-read-builder";
import type { MeshMutationBuilder }    from "./mesh-mutation-builder";

// ─── Discriminated return type for queries ────────────────────────────────────

type QueryBuilderFor<TItem, TOwnership, TPrimaryKey extends string> =
  TOwnership extends GlobalOwnership
    ? GlobalQueryBuilder<TItem>
    : TOwnership extends NodeOwnedOwnership<infer TOwnerField>
      ? TOwnerField extends keyof TItem & string
        ? NodeOwnedQueryBuilder<TItem, TOwnerField>
        : never
      : never;

type ReadBuilderFor<TItem, TOwnership, TPrimaryKey extends string> =
  TOwnership extends GlobalOwnership
    ? GlobalReadBuilder<TItem, TPrimaryKey>
    : TOwnership extends NodeOwnedOwnership<string>
      ? NodeOwnedReadBuilder<TItem, TPrimaryKey>
      : never;

// ─── createMeshContext ────────────────────────────────────────────────────────

export interface MeshContext {
  /**
   * Entry point for queries (list).
   * Returns GlobalQueryBuilder when the resource is global.
   * Returns NodeOwnedQueryBuilder when the resource is node-owned.
   * No workarounds. No casts. Purely from phantom generics.
   */
  from<TItem, TOwnership, TPrimaryKey extends string>(
    descriptor: QueryDescriptor<TItem, TOwnership, TPrimaryKey>,
  ): QueryBuilderFor<TItem, TOwnership, TPrimaryKey>;

  /**
   * Entry point for reads (by primary key).
   * Returns GlobalReadBuilder or NodeOwnedReadBuilder.
   */
  from<TItem, TOwnership, TPrimaryKey extends string>(
    descriptor: ReadDescriptor<TItem, TOwnership, TPrimaryKey>,
  ): ReadBuilderFor<TItem, TOwnership, TPrimaryKey>;

  /**
   * Entry point for mutations.
   * Routing is automatic based on TOwnership.
   */
  from<TInput, TOutput, TOwnership>(
    descriptor: MutationDescriptor<TInput, TOutput, TOwnership>,
  ): MeshMutationBuilder<TInput, TOutput>;
}

export declare function createMeshContext(): MeshContext;
```

---

## 10. Service Definition

```typescript
// mesh-service.ts

import type { ResourceDescriptor, Ownership, InferItem, InferPK } from "./mesh-resource";
import type { QueryDescriptor, ReadDescriptor, MutationDescriptor } from "./mesh-descriptor";
import type { z } from "zod";

// Auto-derive the static surface for one resource slot
type ResourceSurface<R extends ResourceDescriptor<any, any, any>> = {
  queries: {
    query: QueryDescriptor<InferItem<R>, InferOwnership<R>, InferPK<R>>;
    read:  ReadDescriptor<InferItem<R>, InferOwnership<R>, InferPK<R>>;
  };
  mutations: {
    create: MutationDescriptor<
      Omit<InferItem<R>, InferPK<R>>,
      InferItem<R>,
      InferOwnership<R>
    >;
    update: MutationDescriptor<
      Partial<InferItem<R>> & Pick<InferItem<R>, InferPK<R>>,
      InferItem<R>,
      InferOwnership<R>
    >;
    delete: MutationDescriptor<
      Pick<InferItem<R>, InferPK<R>>,
      { deleted: boolean },
      InferOwnership<R>
    >;
  };
};

// Build the full static surface for all resources in a service
type ServiceSurface<TResources extends Record<string, ResourceDescriptor<any, any, any>>> = {
  queries:   { [K in keyof TResources]: ResourceSurface<TResources[K]>["queries"] };
  mutations: { [K in keyof TResources]: ResourceSurface<TResources[K]>["mutations"] };
};

export function defineMeshService<
  TResources extends Record<string, ResourceDescriptor<any, any, any>>,
>(config: {
  namespace: string;
  resources: TResources;
}): new () => {} & { readonly _surface: ServiceSurface<TResources> } {
  // Runtime builds the static surface and attaches it to the class
  // Implementation detail — consumers only use the static .queries / .mutations properties
  return class {} as any;
}

// Usage produces a class with fully typed static properties:
//
// DeploymentMeshService.queries.deployments.query
//   → QueryDescriptor<Deployment, NodeOwnedOwnership<"nodeId">, "deploymentId">
//
// DeploymentMeshService.queries.projects.query
//   → QueryDescriptor<Project, GlobalOwnership, "projectId">
```

---

## 11. Reactive Subqueries

This is the core of the reactive pattern: a live query that depends on the results of another live query. When the parent result changes, the child re-subscribes automatically.

### 11.1 First-class `.whereFrom()`

The method lives on both `GlobalLiveQueryBuilder` and `NodeOwnedLiveQueryBuilder`. It uses `switchMap` internally with automatic connection management:

```typescript
// Inside the mesh internals — what .whereFrom() does

function whereFromImpl<TSource, TItem>(
  source$: Observable<MeshQueryResult<TSource>>,
  mapToWhere: (result: MeshQueryResult<TSource>) => WhereInput<TItem>,
  baseBuilder: NodeOwnedQueryBuilder<TItem, any>,
): NodeOwnedLiveQueryBuilder<TItem> {
  return {
    execute(): Observable<MeshQueryResult<TItem>> {
      return source$.pipe(
        // Extract the where clause from the parent result
        map(parentResult => mapToWhere(parentResult)),
        // Only re-subscribe if the where clause actually changed
        distinctUntilChanged((a, b) => deepEqual(serialize(a), serialize(b))),
        // switchMap: cancel previous child subscription, start new one
        switchMap(childWhere =>
          baseBuilder
            .where(childWhere)
            .listen()
            .execute()
        ),
      );
    },
  };
}
```

Key behaviors:
- If the parent emits but the derived where clause is identical → **no reconnect** (distinctUntilChanged)
- If the where clause changes → **old SSE consumers are detached**, new ones attached
- The combined observable emits when **either** parent or child changes
- Unsubscribing from the combined observable cleans up **both** SSE subscriptions

### 11.2 Manual composition with RxJS

For advanced cases, you can always compose with raw RxJS:

```typescript
import { switchMap, map, distinctUntilChanged } from "rxjs";

const projectIds$ = mesh
  .from(ProjectMeshService.queries.projects.query)   // GlobalQueryBuilder<Project>
  .where({ organizationId: eq("org-123") })
  .listen()
  .execute()                                          // Observable<MeshQueryResult<Project>>
  .pipe(
    map(result => result.items.map(i => i.data.projectId)),
    distinctUntilChanged((a, b) => a.join(",") === b.join(",")),
  );

const deployments$ = projectIds$.pipe(
  switchMap(projectIds =>
    mesh
      .from(DeploymentMeshService.queries.deployments.query)  // NodeOwnedQueryBuilder
      .where({ projectId: inList(projectIds) })
      .listen()
      .execute()
  ),
);
```

---

## 12. Complete End-to-End Example

### 12.1 Resource & Service definitions

```typescript
// ─── project.resource.ts ──────────────────────────────────────────────────────

import { z } from "zod";
import { defineResource } from "@mesh/core";

const projectSchema = z.object({
  projectId:      z.string().uuid(),
  organizationId: z.string().uuid(),
  name:           z.string(),
  status:         z.enum(["active", "archived"]),
  ownerId:        z.string().uuid(),
  createdAt:      z.string().datetime(),
});

export const projectResource = defineResource({
  schema:     projectSchema,
  primaryKey: "projectId",
  ownership:  { type: "global" } as const,
});

// TypeScript knows:
// projectResource._item     → { projectId: string; organizationId: string; name: string; status: "active" | "archived"; ... }
// projectResource._primaryKey → "projectId"
// projectResource._ownership  → GlobalOwnership
```

```typescript
// ─── deployment.resource.ts ───────────────────────────────────────────────────

import { z } from "zod";
import { defineResource, defineMutation } from "@mesh/core";

const deploymentSchema = z.object({
  deploymentId: z.string().uuid(),
  projectId:    z.string().uuid(),
  serviceId:    z.string().uuid(),
  nodeId:       z.string(),
  environment:  z.enum(["prod", "staging", "canary"]),
  status:       z.enum(["running", "pending", "stopped", "failed"]),
  replicaCount: z.number().int().min(0).max(50),
  image:        z.string(),
  createdAt:    z.string().datetime(),
  updatedAt:    z.string().datetime(),
});

export const deploymentResource = defineResource({
  schema:     deploymentSchema,
  primaryKey: "deploymentId",
  ownership:  { type: "node-owned", ownerField: "nodeId" } as const,
}).extend({
  mutations: {
    restart: defineMutation({
      input:  z.object({ deploymentId: z.string(), graceful: z.boolean().default(true) }),
      output: z.object({ restarting: z.boolean(), estimatedSeconds: z.number() }),
    }),
    scale: defineMutation({
      input:  z.object({ deploymentId: z.string(), replicas: z.number().int().min(0).max(50) }),
      output: z.object({ deploymentId: z.string(), replicaCount: z.number() }),
    }),
  },
});

// TypeScript knows:
// deploymentResource._item       → { deploymentId: string; projectId: string; nodeId: string; ... }
// deploymentResource._primaryKey → "deploymentId"
// deploymentResource._ownership  → NodeOwnedOwnership<"nodeId">
```

```typescript
// ─── project-mesh.service.ts ──────────────────────────────────────────────────

import { defineMeshService } from "@mesh/core";
import { projectResource }   from "./project.resource";

export class ProjectMeshService extends defineMeshService({
  namespace: "project",
  resources: { projects: projectResource },
}) {}

// Static surface (fully inferred, zero manual declarations):
//
// ProjectMeshService.queries.projects.query
//   → QueryDescriptor<Project, GlobalOwnership, "projectId">
//
// ProjectMeshService.queries.projects.read
//   → ReadDescriptor<Project, GlobalOwnership, "projectId">
//
// ProjectMeshService.mutations.projects.create
//   → MutationDescriptor<Omit<Project,"projectId">, Project, GlobalOwnership>
//
// ProjectMeshService.mutations.projects.update
//   → MutationDescriptor<Partial<Project> & {projectId:string}, Project, GlobalOwnership>
```

```typescript
// ─── deployment-mesh.service.ts ───────────────────────────────────────────────

import { defineMeshService } from "@mesh/core";
import { deploymentResource } from "./deployment.resource";

export class DeploymentMeshService extends defineMeshService({
  namespace: "deployment",
  resources: { deployments: deploymentResource },
}) {}

// Static surface (fully inferred):
//
// DeploymentMeshService.queries.deployments.query
//   → QueryDescriptor<Deployment, NodeOwnedOwnership<"nodeId">, "deploymentId">
//
// DeploymentMeshService.mutations.deployments.restart
//   → MutationDescriptor<{deploymentId:string, graceful:boolean}, {...}, NodeOwnedOwnership<"nodeId">>
```

### 12.2 Consumer — reactive subquery (the main example)

```typescript
// ─── org-dashboard.service.ts ─────────────────────────────────────────────────

import { createMeshContext }      from "@mesh/core";
import { eq, inList, or }         from "@mesh/where";
import { ProjectMeshService }     from "./project-mesh.service";
import { DeploymentMeshService }  from "./deployment-mesh.service";
import { map, tap, distinctUntilChanged } from "rxjs";

const mesh = createMeshContext();

const ORG_ID = "org-123";

// ── Step 1: Live project list for the org ────────────────────────────────────
//
// mesh.from(ProjectMeshService.queries.projects.query)
//   → returns GlobalQueryBuilder<Project>         ← NO .onNode(), correct ✓
//   .listen() → GlobalLiveQueryBuilder<Project>
//   .execute() → Observable<MeshQueryResult<Project>>

const activeProjects$ = mesh
  .from(ProjectMeshService.queries.projects.query)
  .where({ organizationId: eq(ORG_ID), status: eq("active") })
  .sortBy("createdAt", "desc")
  .listen(b => b.onChange("status", "name").debounce(100))
  .execute();

// ── Step 2: Reactive deployments — depends on active project IDs ─────────────
//
// mesh.from(DeploymentMeshService.queries.deployments.query)
//   → returns NodeOwnedQueryBuilder<Deployment, "nodeId">  ← HAS .onNode(), correct ✓
//   .listen() → NodeOwnedLiveQueryBuilder<Deployment>
//   .whereFrom() → re-subscribes via switchMap when activeProjects$ emits
//   .execute() → Observable<MeshQueryResult<Deployment>>

const orgDeployments$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })                 // base filter always applied
  .sortBy("createdAt", "desc")
  .listen(b => b.onChange("status", "replicaCount").debounce(50))
  .whereFrom(
    activeProjects$,
    (projectsResult) => ({
      // Typed: projectId is a valid field, inList is valid for string fields  ✓
      // Wrong field name here → compile error                                 ✓
      // Wrong value type here → compile error                                 ✓
      projectId: inList(projectsResult.items.map(i => i.data.projectId)),
    }),
  )
  .execute();

// ── Step 3: Subscribe and handle rich metadata ───────────────────────────────

orgDeployments$.subscribe({
  next: (result) => {
    console.log("╔══ DEPLOYMENT UPDATE ═══════════════════════════════════");
    console.log(`║  Strategy:  ${result.meta.strategy}`);
    console.log(`║  Nodes:     ${result.meta.nodesResponded}/${result.meta.nodesQueried}`);
    console.log(`║  Total:     ${result.meta.totalItems} deployments`);
    console.log(`║  Conn:      ${result.meta.connectionId} (${result.meta.sharedConsumerCount} consumers sharing)`);
    console.log("╠════════════════════════════════════════════════════════");

    for (const { data: d, meta: m } of result.items) {
      console.log(`║  [${m.nodeId.padEnd(8)}] ${d.deploymentId}`);
      console.log(`║             ${d.image}  ×${d.replicaCount} replicas`);
      console.log(`║             status=${d.status}  env=${d.environment}`);

      if (m.eventType === "snapshot") {
        console.log(`║             ← initial snapshot (latency: ${m.latencyMs}ms)`);
      } else if (m.eventType === "updated") {
        console.log(`║             ← updated  changed=[${m.changedFields?.join(", ")}]  Δ${m.latencyMs}ms`);
      } else if (m.eventType === "created") {
        console.log(`║             ← new deployment appeared  Δ${m.latencyMs}ms`);
      } else if (m.eventType === "deleted") {
        console.log(`║             ← removed from cluster`);
      }
    }

    console.log("╚════════════════════════════════════════════════════════");
  },
  error: (err) => console.error("Stream error:", err),
});

// ── Alternative: manual composition for full control ─────────────────────────

// const deployments$ = activeProjects$.pipe(
//   map(result => result.items.map(i => i.data.projectId)),
//   distinctUntilChanged((a, b) => a.slice().sort().join() === b.slice().sort().join()),
//   switchMap(projectIds =>
//     mesh
//       .from(DeploymentMeshService.queries.deployments.query) // NodeOwnedQueryBuilder<Deployment, "nodeId">
//       .where(and([
//         { projectId: inList(projectIds) },
//         { environment: eq("prod") },
//       ]))
//       .listen(b => b.onChange("status", "replicaCount"))
//       .execute()
//   ),
// );
```

### 12.3 Other usage examples

```typescript
// ── Read a single deployment (by primary key) ────────────────────────────────

// mesh.from(DeploymentMeshService.queries.deployments.read)
//   → NodeOwnedReadBuilder<Deployment, "deploymentId">
//   → .execute() routes: coordinator → "who owns dep-abc?" → node-B → direct

const readResult = await mesh
  .from(DeploymentMeshService.queries.deployments.read)
  .execute({ deploymentId: "dep-abc-123" });

if (readResult.item) {
  const { data: d, meta: m } = readResult.item;
  console.log(`Found on ${m.nodeId}: ${d.deploymentId} (${d.status})`);
  console.log(`Routing strategy: ${readResult.meta.strategy}`);
  // → "coordinator-lookup-then-direct"
}

// ── Live watch on a single item ──────────────────────────────────────────────

const deployment$ = mesh
  .from(DeploymentMeshService.queries.deployments.read)
  .listen()
  .execute({ deploymentId: "dep-abc-123" });

deployment$.subscribe(result => {
  if (!result.item) return;
  const { data, meta } = result.item;
  console.log(`[${meta.nodeId}] ${data.status}  event=${meta.eventType}`);
});

// ── Target a specific node explicitly ────────────────────────────────────────
// .onNode() is ONLY available on NodeOwnedQueryBuilder — GlobalQueryBuilder does NOT have it.
// Attempting it on a global resource → compile error ✓

const nodeADeployments = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .onNode("node-A")                             // valid: node-owned resource ✓
  .where({ status: eq("running") })
  .execute();

// mesh.from(ProjectMeshService.queries.projects.query)
//   .onNode("node-A")                          // COMPILE ERROR: Property 'onNode' does not exist
//                                              // on type 'GlobalQueryBuilder<Project>'  ✓

// ── Mutations ─────────────────────────────────────────────────────────────────

// Create (node-owned: must supply nodeId = the ownerField)
const created = await mesh
  .from(DeploymentMeshService.mutations.deployments.create)
  .execute({
    // deploymentId is omitted — it's the primaryKey, auto-generated
    projectId:    "proj-xyz",
    serviceId:    "svc-api",
    nodeId:       "node-B",         // designates the owner node
    environment:  "staging",
    status:       "pending",
    replicaCount: 2,
    image:        "my-api:v2.0.0",
  });
console.log(`Created ${created.data.deploymentId} on ${created.meta.nodeId}`);

// Scale (custom mutation — routes to owning node automatically)
const scaled = await mesh
  .from(DeploymentMeshService.mutations.deployments.scale)
  .execute({ deploymentId: "dep-abc-123", replicas: 5 });
console.log(`Scaled on ${scaled.meta.nodeId} in ${scaled.meta.durationMs}ms`);

// Create a project (global — no nodeId needed)
const project = await mesh
  .from(ProjectMeshService.mutations.projects.create)
  .execute({
    // projectId omitted — auto-generated
    organizationId: ORG_ID,
    name:           "New Service",
    status:         "active",
    ownerId:        "user-456",
  });
console.log(`Created project on ${project.meta.nodeId}`);
// → meta.nodeId === "coordinator"
```

### 12.4 Query plan introspection

```typescript
const plan = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .explain();

// MeshNodeOwnedQueryPlan {
//   resourceKey:     "deployments",
//   ownership:       "node-owned",
//   ownerField:      "nodeId",
//   routingStrategy: "broadcast",           // no ownerField constraint in where
//   targetNodes:     "all",
//   filterDescriptor: { environment: { _eq: "prod" } },
//   connectionReuse: {
//     perNode: [
//       { nodeId: "node-A", wouldReuse: true,  existingConsumers: 3 },
//       { nodeId: "node-B", wouldReuse: true,  existingConsumers: 1 },
//       { nodeId: "node-C", wouldReuse: false },
//     ]
//   }
// }

const globalPlan = await mesh
  .from(ProjectMeshService.queries.projects.query)
  .where({ organizationId: eq(ORG_ID) })
  .explain();

// MeshGlobalQueryPlan {
//   resourceKey: "projects",
//   ownership:   "global",
//   target:      "coordinator",
//   filterDescriptor: { organizationId: { _eq: "org-123" } },
// }
```

---

## 13. How it Works — Annotated Flow

### 13.1 Reactive subquery execution timeline

```
t=0  orgDeployments$.subscribe()
     │
     ├─ activeProjects$ subscribes
     │    │ mesh.from(projects.query)   → GlobalQueryBuilder<Project>
     │    │ coordinator SSE connection opens (or reuses)
     │    │ CONSUMER_ATTACH: { consumerId: "cid-P1", filter: {orgId=org-123, status=active} }
     │
     ├─ activeProjects$ emits first snapshot
     │    items: [proj-1, proj-2]  (both active, org-123)
     │    meta.eventType: "snapshot"
     │
     ├─ .whereFrom() maps → { projectId: inList(["proj-1", "proj-2"]) }
     │
     └─ switchMap fires: deployments subscription starts
          │ mesh.from(deployments.query)  → NodeOwnedQueryBuilder<Deployment, "nodeId">
          │
          │ Fan-out: resolve target nodes for inList filter
          │   → all nodes (no ownerField constraint in filter)
          │
          │ Per node: lookup(nodeId, "deployments", "query")
          │   node-A: no existing connection → open new SSE
          │           CONSUMER_ATTACH: { cid: "cid-D1", filter: {projectId∈[proj-1,proj-2], env=prod} }
          │   node-B: existing connection ✓ → attach
          │           CONSUMER_ATTACH: { cid: "cid-D1", filter: {projectId∈[proj-1,proj-2], env=prod} }
          │   node-C: no existing connection → open new SSE
          │           CONSUMER_ATTACH: { cid: "cid-D1", filter: {projectId∈[proj-1,proj-2], env=prod} }
          │
          └─ deployments$ emits first snapshot
               items from node-A: [dep-1 (proj-1), dep-2 (proj-2)]
               items from node-B: [dep-3 (proj-1)]
               items from node-C: []
               merged + deduplicated by deploymentId
               each item.meta.nodeId = source node

t=5s  A deployment on node-A changes status: "running" → "stopped"

      node-A server-side:
        computeRecipients(event):
          cid-D1 filter: projectId∈[proj-1,proj-2] AND env=prod  ✓ matches
          recipients: ["cid-D1"]
        emit ONE envelope: { recipients: ["cid-D1"], payload: dep-1-updated }

      node-A client-side:
        cid-D1 gate: envelope.recipients.includes("cid-D1") → true
        map to MeshResultItem { data: dep-1, meta: { nodeId: "node-A", eventType: "updated",
                                                      changedFields: ["status", "updatedAt"] } }

      orgDeployments$ emits updated result
      (only changed item is updated; other items from node-B etc. unchanged)

t=10s A new project "proj-3" is added to org-123

      coordinator:
        emits change event { projectId: "proj-3", organizationId: "org-123", status: "active" }

      activeProjects$ emits:
        items: [proj-1, proj-2, proj-3]
        meta.eventType: "created"

      .whereFrom() recomputes:
        OLD where: { projectId: inList(["proj-1", "proj-2"]) }
        NEW where: { projectId: inList(["proj-1", "proj-2", "proj-3"]) }
        distinctUntilChanged: CHANGED → proceed

      switchMap fires:
        OLD deployment subscription → CONSUMER_DETACH cid-D1 from all nodes
        NEW deployment subscription starts with new filter
          CONSUMER_ATTACH: { cid: "cid-D2", filter: {projectId∈[proj-1,proj-2,proj-3], env=prod} }

      orgDeployments$ emits new snapshot (all proj-1+proj-2+proj-3 deployments)

t=15s A deployment on node-B for proj-3 changes

      node-B:
        cid-D2 filter: projectId∈[proj-1,proj-2,proj-3] ✓
        recipients: ["cid-D2"]
        ONE wire emit

      orgDeployments$ emits updated result  ✓
```

### 13.2 SSE connection sharing across multiple subscribers

```
Component A subscribes: .where({ environment: eq("prod") })
Component B subscribes: .where({ environment: eq("prod"), status: eq("running") })
Component C subscribes: .where({ environment: eq("staging") })

All three use DeploymentMeshService.queries.deployments.query
(targeting the same nodes)

Connection to node-A:
  ONE SSE connection  ←  3 consumers sharing it
  ┌───────────────────────────────────────────────────────┐
  │  node-A SSE server                                    │
  │                                                       │
  │  Consumer registry:                                   │
  │    cid-A: { env=prod }              ← Component A    │
  │    cid-B: { env=prod, status=run }  ← Component B    │
  │    cid-C: { env=staging }           ← Component C    │
  └───────────────────────────────────────────────────────┘

Event: { environment: "prod", status: "running" }
  cid-A: ✓  cid-B: ✓  cid-C: ✗
  Wire: { recipients: ["cid-A", "cid-B"], payload: ... }  ← ONE emit

Event: { environment: "prod", status: "stopped" }
  cid-A: ✓  cid-B: ✗  cid-C: ✗
  Wire: { recipients: ["cid-A"], payload: ... }            ← ONE emit

Event: { environment: "canary", status: "running" }
  cid-A: ✗  cid-B: ✗  cid-C: ✗
  Wire: SUPPRESSED                                          ← ZERO emits

Event: { environment: "staging", status: "pending" }
  cid-A: ✗  cid-B: ✗  cid-C: ✓
  Wire: { recipients: ["cid-C"], payload: ... }            ← ONE emit
```

### 13.3 Node discovery for `.read(pk)`

```
mesh.from(deployments.read).execute({ deploymentId: "dep-abc" })

Client                   Coordinator (cache)               node-B
  │                            │                              │
  │  "who owns dep-abc?"       │                              │
  │ ──────────────────────────►│                              │
  │                            │  lookup ownership registry   │
  │                            │  { "dep-abc": "node-B" }     │
  │  "node-B"                  │                              │
  │ ◄──────────────────────────│                              │
  │                            │                              │
  │  direct HTTP/SSE to node-B  ─────────────────────────────►│
  │                            │                              │  findByPk("dep-abc")
  │                            │                              │
  │  MeshReadResult {           ◄──────────────────────────────│
  │    item: { data: dep, meta: { nodeId: "node-B", ... } }   │
  │  }                         │                              │

If node-B is unreachable:
  → coordinator marks node-B degraded
  → triggers ownership reassignment (cluster-specific recovery protocol)
  → coordinator updates registry: { "dep-abc": "node-C" }
  → client retries against node-C
```

---

## Summary: Type Discrimination Table

| Call | Resource Ownership | Builder Type | `.onNode()` | `.execute()` return |
|------|-------------------|--------------|-------------|---------------------|
| `mesh.from(projects.query)` | `global` | `GlobalQueryBuilder<Project>` | ✗ compile error | `Promise<MeshQueryResult<Project>>` |
| `mesh.from(projects.query).listen()` | `global` | `GlobalLiveQueryBuilder<Project>` | n/a | `Observable<MeshQueryResult<Project>>` |
| `mesh.from(projects.read)` | `global` | `GlobalReadBuilder<Project, "projectId">` | ✗ | `Promise<MeshReadResult<Project>>` |
| `mesh.from(deployments.query)` | `node-owned` | `NodeOwnedQueryBuilder<Deployment, "nodeId">` | ✓ | `Promise<MeshQueryResult<Deployment>>` |
| `mesh.from(deployments.query).listen()` | `node-owned` | `NodeOwnedLiveQueryBuilder<Deployment>` | n/a | `Observable<MeshQueryResult<Deployment>>` |
| `mesh.from(deployments.read)` | `node-owned` | `NodeOwnedReadBuilder<Deployment, "deploymentId">` | ✗ | `Promise<MeshReadResult<Deployment>>` |
| `mesh.from(projects.mutations.create)` | `global` | `MeshMutationBuilder<...>` | ✗ | `Promise<MeshMutationResult<Project>>` |
| `mesh.from(deployments.mutations.scale)` | `node-owned` | `MeshMutationBuilder<...>` | ✗ | `Promise<MeshMutationResult<...>>` |

The discrimination is entirely from the phantom `_ownership` generic on the descriptor. No runtime checks, no casts, no `as` anywhere in consumer code.

# Mesh Use Cases & Complete API Reference — v8

> **Scope:** Every consumer-facing use case catalogued and mapped to its precise API shape.
> **Rule:** No `any`, no casts, no string literals in operation references. Correct types enforce correct usage at compile time.

---

## Table of Contents

1. [Use Case Catalogue](#1-use-case-catalogue)
2. [Foundation: Where Expressions & Dynamic Variables](#2-foundation-where-expressions--dynamic-variables)
3. [Resource & Service Definitions](#3-resource--service-definitions)
4. [Multi-Item Query Builder vs Single-Item Read Builder — The Discriminated Split](#4-multi-item-query-builder-vs-single-item-read-builder----the-discriminated-split)
5. [One-Shot Queries — `.execute()`](#5-one-shot-queries----execute)
6. [Single-Item Read — `.read(id)`](#6-single-item-read----readid)
7. [Live Subscriptions — `.listen().execute()`](#7-live-subscriptions----listenexecute)
8. [Reactive Subqueries — `.whereFrom()`](#8-reactive-subqueries----wherefrom)
9. [Aggregations — `.aggregate()` and `.listen().aggregate()`](#9-aggregations----aggregate-and-listenaggregate)
10. [Aggregate Plugin System — `AggregateService`](#10-aggregate-plugin-system----aggregateservice)
11. [Server-Side Joins](#11-server-side-joins)
12. [Mutations](#12-mutations)
13. [Optimistic Mutations](#13-optimistic-mutations)
14. [Distributed Sagas — with Descriptions & Diagnostics](#14-distributed-sagas----with-descriptions--diagnostics)
15. [Streaming Iterator — `.stream()`](#15-streaming-iterator----stream)
16. [Typed Event Subscriptions — `.on()`](#16-typed-event-subscriptions----on)
17. [Query Plan Introspection — `.explain()`](#17-query-plan-introspection----explain)
18. [Connection Diagnostics, Lifecycle & Direct Node Access](#18-connection-diagnostics-lifecycle--direct-node-access)
19. [Mesh Discovery — Resource Location](#19-mesh-discovery----resource-location)
20. [Pagination — Offset & Cursor](#20-pagination----offset--cursor)
21. [Projections — `.select()`](#21-projections----select)
22. [Caching Layer](#22-caching-layer)
23. [Query Middleware Pipeline](#23-query-middleware-pipeline)
24. [Diagnostic Tracing — Named Steps & Event Descriptions](#24-diagnostic-tracing----named-steps--event-descriptions)
25. [Additional Concepts & APIs](#25-additional-concepts--apis)
26. [Combined Patterns — Real-World Scenarios](#26-combined-patterns----real-world-scenarios)
27. [Complete Type Appendix](#27-complete-type-appendix)

---

## 1. Use Case Catalogue

| Category | # | Use Case | Terminal |
|----------|---|----------|----------|
| **Read** | R1 | List with filters | `.execute()` |
| **Read** | R2 | Single item by PK | `.read(id)` |
| **Read** | R3 | Single item live watch | `.read(id).listen().execute()` |
| **Read** | R4 | Offset pagination | `.limit().offset().execute()` |
| **Read** | R5 | Cursor pagination | `.cursor().execute()` |
| **Read** | R6 | Projected fetch | `.select().execute()` |
| **Read** | R7 | Sorted list | `.sortBy().execute()` |
| **Read** | R8 | Fan-out all nodes | `.execute()` (node-owned default) |
| **Read** | R9 | Specific node | `.onNode(id).execute()` |
| **Read** | R10 | Node set | `.onNodes([...]).execute()` |
| **Live** | L1 | Real-time list | `.listen().execute()` |
| **Live** | L2 | Debounced stream | `.listen(b => b.debounce()).execute()` |
| **Live** | L3 | Field-change-only | `.listen(b => b.onChange()).execute()` |
| **Live** | L4 | Reactive subquery | `.listen().whereFrom().execute()` |
| **Live** | L5 | Live query (full re-exec) | `.live()` |
| **Aggregate** | A1 | One-shot aggregate | `.aggregate({ ... })` |
| **Aggregate** | A2 | Reactive aggregate | `.listen().aggregate({ ... })` |
| **Aggregate** | A3 | Grouped aggregate | `.aggregate({ x: groupBy(...) })` |
| **Aggregate** | A4 | Custom plugin aggregate | `aggregateService.utils.myAgg(...)` |
| **Mutation** | M1–M6 | CRUD + domain actions | `.mutations.X.execute()` |
| **Mutation** | M7 | Optimistic mutation | `.optimistic({}).execute()` |
| **Mutation** | M8 | With cache invalidation | `.invalidates([]).execute()` |
| **Saga** | S1 | Multi-step distributed transaction | `mesh.saga().step().compensate().execute()` |
| **Saga** | S2 | Named/described saga steps | `.step("id", { description: "..." }, handler)` |
| **Stream** | ST1 | Async iterator | `.stream()` |
| **Event** | E1 | Lifecycle event subscription | `.on().event().asObservable()` |
| **Event** | E2 | Custom domain event | `.on().event("restarted").asObservable()` |
| **Join** | J1 | Server-side join | `.join(subBuilder, config).execute()` |
| **Join** | J2 | Auto-join via relation | `.include("relation").execute()` |
| **Discovery** | DV1 | Locate resource owner | `mesh.discovery.locate(resource, pk)` |
| **Discovery** | DV2 | List nodes for entity | `mesh.discovery.nodesFor(resource)` |
| **Discovery** | DV3 | Watch node topology | `mesh.discovery.topology$` |
| **Diagnostics** | D1 | Inspect open connections | `connectionStore.inspect()` |
| **Diagnostics** | D2 | Connection lifecycle events | `connectionStore.lifecycle$` |
| **Diagnostics** | D3 | Direct node connection | `connectionStore.connectToNode(nodeId, entity)` |
| **Diagnostics** | D4 | Explicit connection handle | `.connect()` |
| **Diagnostics** | D5 | Named runner/diagnostic context | `mesh.withDiagnostics({ name, tags })` |
| **Introspection** | I1 | Query plan | `.explain()` |
| **Composition** | C1 | Reusable builder fragments | `const base = mesh.from(...).where(...)` |
| **Composition** | C2 | Where with dynamic variables | `.where({ status: variable("currentStatus") })` |

---

## 2. Foundation: Where Expressions & Dynamic Variables

The where system is a typed predicate tree that works identically on both sides of the wire. The same expression serializes to JSON for server evaluation and executes as a predicate locally.

### 2.1 Static expressions

```typescript
// mesh-where.types.ts

export type Scalar = string | number | boolean | null;

export type MeshWhereExpr<
  TOp extends keyof Operators = keyof Operators,
  TVal extends Operators[TOp] = Operators[TOp],
> = { readonly _brand: "MeshWhereExpr" } & { readonly [K in TOp]: TVal };

type Operators = {
  _eq:         Scalar;
  _neq:        Scalar;
  _gt:         number;
  _gte:        number;
  _lt:         number;
  _lte:        number;
  _in:         readonly (string | number)[];
  _nin:        readonly (string | number)[];
  _contains:   string;
  _startsWith: string;
  _endsWith:   string;
  _between:    readonly [number, number];
  _isNull:     boolean;
  _or:         readonly (MeshWhereExpr | FieldWhere<any>)[];
  _and:        readonly (MeshWhereExpr | FieldWhere<any>)[];
  // Dynamic variable — resolved at execute() time
  _var:        MeshVariable<Scalar>;
  // Contextual — resolved from the current mesh request context (user, org, etc.)
  _ctx:        MeshContextKey;
};

export type FieldWhere<V> =
  V extends boolean
    ? MeshWhereExpr<"_eq", boolean>  | MeshWhereExpr<"_neq", boolean>
                                     | MeshWhereExpr<"_isNull", boolean>
  : V extends number
    ? MeshWhereExpr<"_eq", number>   | MeshWhereExpr<"_neq", number>
    | MeshWhereExpr<"_gt">           | MeshWhereExpr<"_gte">
    | MeshWhereExpr<"_lt">           | MeshWhereExpr<"_lte">
    | MeshWhereExpr<"_in">           | MeshWhereExpr<"_nin">
    | MeshWhereExpr<"_between">      | MeshWhereExpr<"_isNull", boolean>
    | MeshWhereExpr<"_var", MeshVariable<number>>
  : V extends string
    ? MeshWhereExpr<"_eq", V>        | MeshWhereExpr<"_neq", V>
    | MeshWhereExpr<"_in">           | MeshWhereExpr<"_nin">
    | MeshWhereExpr<"_contains">     | MeshWhereExpr<"_startsWith">
    | MeshWhereExpr<"_endsWith">     | MeshWhereExpr<"_isNull", boolean>
    | MeshWhereExpr<"_var", MeshVariable<string>>
    | MeshWhereExpr<"_ctx", MeshContextKey>
  : never;

export type ObjectWhere<T> = { [K in keyof T]?: FieldWhere<T[K]> };

export type WhereInput<T> =
  | ObjectWhere<T>
  | MeshWhereExpr<"_or">
  | MeshWhereExpr<"_and">;

export type SortableField<T> = {
  [K in keyof T]: T[K] extends Scalar ? K : never;
}[keyof T] & string;
```

### 2.2 Dynamic variables

Variables let you build a where clause once and resolve it differently per call. This is particularly useful for reactive subqueries and reusable builder fragments.

```typescript
// mesh-variable.ts

export interface MeshVariable<T extends Scalar> {
  readonly _brand:   "MeshVariable";
  readonly name:     string;
  readonly type:     "string" | "number" | "boolean";
  readonly default?: T;
}

/**
 * Declare a variable reference inside a where clause.
 * The actual value is supplied at execute() / listen() call time.
 */
export function variable<T extends Scalar>(
  name: string,
  options?: { default?: T },
): MeshVariable<T> {
  return { _brand: "MeshVariable", name, type: typeof (options?.default ?? "") as any, default: options?.default };
}

/**
 * Contextual shortcuts — resolved from the current mesh request context.
 * No value is supplied by the consumer; the mesh resolves it internally.
 */
export type MeshContextKey =
  | "ctx.userId"
  | "ctx.organizationId"
  | "ctx.nodeId"
  | "ctx.requestId";

export function ctx(key: MeshContextKey): MeshWhereExpr<"_ctx", MeshContextKey> {
  return { _brand: "MeshWhereExpr", _ctx: key };
}
```

```typescript
// ── Usage: dynamic variables ──────────────────────────────────────────────────

import { eq, inList, variable, ctx } from "@mesh/where";

// Build a reusable fragment with a variable placeholder
const deploymentsByEnv = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: variable<"prod" | "staging" | "canary">("env") });

// Resolve the variable at execute time
const prod    = await deploymentsByEnv.execute({ vars: { env: "prod" } });
const staging = await deploymentsByEnv.execute({ vars: { env: "staging" } });

// Live stream with variables resolved reactively
const env$ = new BehaviorSubject<"prod" | "staging">("prod");
const live$ = env$.pipe(
  switchMap(env =>
    deploymentsByEnv
      .listen()
      .execute({ vars: { env } })
  ),
);

// Context-based filter — resolved from the authenticated request context
const myDeployments = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ ownerId: ctx("ctx.userId") })   // userId from mesh request context
  .execute();
```

---

## 3. Resource & Service Definitions

```typescript
// schemas.ts
import { z } from "zod";

export const projectSchema = z.object({
  projectId:      z.string().uuid(),
  organizationId: z.string().uuid(),
  name:           z.string(),
  status:         z.enum(["active", "archived"]),
  ownerId:        z.string().uuid(),
  createdAt:      z.string().datetime(),
});

export const deploymentSchema = z.object({
  deploymentId:  z.string().uuid(),
  projectId:     z.string().uuid(),
  serviceId:     z.string().uuid(),
  nodeId:        z.string(),
  environment:   z.enum(["prod", "staging", "canary"]),
  status:        z.enum(["running", "pending", "stopped", "failed"]),
  replicaCount:  z.number().int().min(0).max(50),
  image:         z.string(),
  cpuMillicores: z.number(),
  memoryMb:      z.number(),
  createdAt:     z.string().datetime(),
  updatedAt:     z.string().datetime(),
});

export const deploymentMetricSchema = z.object({
  metricId:     z.string().uuid(),
  deploymentId: z.string().uuid(),
  nodeId:       z.string(),
  cpuUsage:     z.number(),
  memoryUsage:  z.number(),
  requestRate:  z.number(),
  errorRate:    z.number(),
  p99LatencyMs: z.number(),
  recordedAt:   z.string().datetime(),
});
```

```typescript
// resources.ts
import { defineResource, defineMutation, defineRelation } from "@mesh/core";

export const projectResource = defineResource({
  schema:     projectSchema,
  primaryKey: "projectId",
  ownership:  { type: "global" } as const,
  events: {
    archived: z.object({ archivedBy: z.string(), reason: z.string().optional() }),
  },
});

export const deploymentResource = defineResource({
  schema:     deploymentSchema,
  primaryKey: "deploymentId",
  ownership:  { type: "node-owned", ownerField: "nodeId" } as const,
  events: {
    restarted: z.object({ jobId: z.string(), graceful: z.boolean() }),
    scaled:    z.object({ from: z.number(), to: z.number() }),
  },
}).extend({
  mutations: {
    restart: defineMutation({
      input:       z.object({ deploymentId: z.string(), graceful: z.boolean().default(true) }),
      output:      z.object({ restarting: z.boolean(), estimatedSeconds: z.number(), jobId: z.string() }),
      description: "Gracefully restart a running deployment",
    }),
    scale: defineMutation({
      input:       z.object({ deploymentId: z.string(), replicas: z.number().int().min(0).max(50) }),
      output:      z.object({ deploymentId: z.string(), replicaCount: z.number(), scaledAt: z.string() }),
      description: "Scale replica count up or down",
    }),
  },
  relations: {
    project: defineRelation({
      entity: () => projectResource,
      type:   "belongs-to",
      on:     (d, p) => d.projectId === p.projectId,
    }),
    metrics: defineRelation({
      entity: () => deploymentMetricResource,
      type:   "has-many",
      on:     (d, m) => d.deploymentId === m.deploymentId,
    }),
  },
});

export const deploymentMetricResource = defineResource({
  schema:     deploymentMetricSchema,
  primaryKey: "metricId",
  ownership:  { type: "node-owned", ownerField: "nodeId" } as const,
});
```

```typescript
// services.ts
import { defineMeshService } from "@mesh/core";

export class ProjectMeshService extends defineMeshService({
  namespace: "project",
  resources: { projects: projectResource },
}) {}

export class DeploymentMeshService extends defineMeshService({
  namespace: "deployment",
  resources: {
    deployments: deploymentResource,
    metrics:     deploymentMetricResource,
  },
}) {}
```

---

## 4. Multi-Item Query Builder vs Single-Item Read Builder — The Discriminated Split

This is the central type-safety invariant of the builder API. The compiler enforces that multi-item methods and single-item methods cannot be mixed.

```typescript
// mesh-builder-split.types.ts

/**
 * MULTI-ITEM builder — the entry state from mesh.from().
 * Methods that make sense only on collections are available here.
 * Calling .read(id) on this builder is a COMPILE ERROR.
 */
export interface MultiItemQueryBuilder<TItem, TOwner extends string | never> {
  // ── Filtering ─────────────────────────────────────────────────────────────
  where(expr: WhereInput<TItem>): MultiItemQueryBuilder<TItem, TOwner>;

  // ── Sorting ────────────────────────────────────────────────────────────────
  sortBy(field: SortableField<TItem>, dir?: "asc" | "desc"): MultiItemQueryBuilder<TItem, TOwner>;

  // ── Pagination ─────────────────────────────────────────────────────────────
  limit(n: number):                  MultiItemQueryBuilder<TItem, TOwner>;
  offset(n: number):                 MultiItemQueryBuilder<TItem, TOwner>;
  cursor(token: string | null):      MultiItemQueryBuilder<TItem, TOwner>;

  // ── Projection ─────────────────────────────────────────────────────────────
  select<K extends keyof TItem & string>(
    ...fields: [K, ...K[]]
  ): MultiItemQueryBuilder<Pick<TItem, K>, TOwner extends K ? TOwner : never>;

  // ── Server-side joins ──────────────────────────────────────────────────────
  join<TRight>(
    right: MultiItemQueryBuilder<TRight, any>,
    config: (j: JoinConfigurator<TItem, TRight>) => JoinResult,
  ): MultiItemQueryBuilder<TItem & Record<string, unknown>, TOwner>;

  include(relation: keyof typeof resource["_relations"]): MultiItemQueryBuilder<TItem, TOwner>;

  // ── Node routing (ONLY on node-owned; compile error on global) ────────────
  onNode(nodeId: string):              TOwner extends string ? MultiItemQueryBuilder<TItem, TOwner> : never;
  onNodes(nodeIds: readonly string[]): TOwner extends string ? MultiItemQueryBuilder<TItem, TOwner> : never;

  // ── Terminal: one-shot ──────────────────────────────────────────────────────
  execute(options?: ExecuteOptions): Promise<MeshQueryResult<TItem>>;

  // ── Terminal: async iterator ───────────────────────────────────────────────
  stream(options?: StreamOptions): AsyncIterable<MeshResultItem<TItem>>;

  // ── Terminal: plan introspection ───────────────────────────────────────────
  explain(): Promise<MeshQueryPlan>;

  // ── Terminal: aggregation (one-shot) ──────────────────────────────────────
  aggregate<TSpec extends AggregateSpec>(spec: TSpec): Promise<AggregateResult<TSpec>>;

  // ── Intermediate: enter live mode ─────────────────────────────────────────
  // NOTE: This returns a LiveMultiItemBuilder, NOT the same builder.
  // Live mode has different terminal methods.
  listen(
    config?: (b: ListenConfig<TItem>) => ListenConfig<TItem>,
  ): LiveMultiItemBuilder<TItem, TOwner>;

  // ── Terminal: live query (re-execute on change) ────────────────────────────
  live(options?: LiveOptions): Observable<MeshQueryResult<TItem>>;

  // ── .read() is NOT on this interface — it would be a compile error ─────────
  // read(id: ...) — does NOT exist here
}

/**
 * LIVE multi-item builder — returned by .listen().
 * Can no longer call .where(), .sortBy(), .limit() etc. here —
 * those must be set BEFORE .listen().
 * Terminal is .execute() → Observable, or .aggregate() → Observable,
 * or .whereFrom() for reactive dependency.
 */
export interface LiveMultiItemBuilder<TItem, TOwner extends string | never> {
  whereFrom<TSource>(
    source$: Observable<MeshQueryResult<TSource>>,
    mapToWhere: (result: MeshQueryResult<TSource>) => WhereInput<TItem>,
  ): LiveMultiItemBuilder<TItem, TOwner>;

  /** Terminal: Observable<MeshQueryResult<TItem>> */
  execute(): Observable<MeshQueryResult<TItem>>;

  /** Terminal: Observable<AggregateResult<TSpec>> — reactive aggregation */
  aggregate<TSpec extends AggregateSpec>(spec: TSpec): Observable<AggregateResult<TSpec>>;
}

/**
 * SINGLE-ITEM read builder — created by calling mesh.from(resource.read).
 * Methods like .where(), .sortBy(), .limit(), .cursor() do NOT exist here
 * because they apply to collections, not single items.
 */
export interface SingleItemReadBuilder<TItem, TPK extends keyof TItem & string> {
  /** Terminal: one-shot fetch by primary key */
  read(pk: Pick<TItem, TPK>): Promise<MeshReadResult<TItem>>;

  /** Enter live mode for a single item */
  listen(): SingleItemLiveBuilder<TItem, TPK>;

  /** Plan introspection */
  explain(pk: Pick<TItem, TPK>): Promise<MeshReadPlan>;

  // .where() does NOT exist here — compile error ✓
  // .sortBy() does NOT exist here — compile error ✓
  // .limit() does NOT exist here — compile error ✓
  // .cursor() does NOT exist here — compile error ✓
}

export interface SingleItemLiveBuilder<TItem, TPK extends keyof TItem & string> {
  /** Terminal: Observable<MeshReadResult<TItem>> */
  execute(pk: Pick<TItem, TPK>): Observable<MeshReadResult<TItem>>;
}
```

### 4.1 How `.from()` returns the correct builder type

```typescript
// mesh-context.ts

export interface MeshContext {
  /**
   * Multi-item query — returns MultiItemQueryBuilder.
   * .read() does NOT exist on this builder.
   */
  from<TItem, TOwner extends string | never, TPK extends string>(
    descriptor: QueryDescriptor<TItem, TOwner, TPK>,
  ): MultiItemQueryBuilder<TItem, TOwner>;

  /**
   * Single-item read — returns SingleItemReadBuilder.
   * .where(), .sortBy(), .limit(), .cursor() do NOT exist on this builder.
   */
  from<TItem, TOwner, TPK extends keyof TItem & string>(
    descriptor: ReadDescriptor<TItem, TOwner, TPK>,
  ): SingleItemReadBuilder<TItem, TPK>;

  /**
   * Mutation — returns MeshMutationBuilder.
   */
  from<TInput, TOutput, TOwner>(
    descriptor: MutationDescriptor<TInput, TOutput, TOwner>,
  ): MeshMutationBuilder<TInput, TOutput>;

  /**
   * Discovery — resource location and cluster topology.
   * Accessed as a property; no injection required.
   */
  readonly discovery: MeshDiscovery;
}
```

### 4.2 Compile-time enforcement examples

```typescript
// ✓ CORRECT: multi-item query uses .execute() — no .read()
const result = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ status: eq("running") })
  .limit(10)
  .sortBy("createdAt", "desc")
  .execute();

// ✓ CORRECT: single-item read uses .read(pk) — no collection methods
const single = await mesh
  .from(DeploymentMeshService.queries.deployments.read)
  .read({ deploymentId: "dep-abc-123" });

// ✗ COMPILE ERROR: .where() does not exist on SingleItemReadBuilder
mesh.from(DeploymentMeshService.queries.deployments.read)
  .where({ status: eq("running") })   // ← Property 'where' does not exist

// ✗ COMPILE ERROR: .read() does not exist on MultiItemQueryBuilder
mesh.from(DeploymentMeshService.queries.deployments.query)
  .where({ status: eq("running") })
  .read({ deploymentId: "dep-abc-123" });  // ← Property 'read' does not exist

// ✗ COMPILE ERROR: .limit() does not exist on LiveMultiItemBuilder
mesh.from(DeploymentMeshService.queries.deployments.query)
  .listen()
  .limit(10)   // ← set limit BEFORE .listen(), not after
  .execute();
```

---

## 5. One-Shot Queries — `.execute()`

```typescript
// R1 — basic filtered list (global)
const projects = await mesh
  .from(ProjectMeshService.queries.projects.query)
  .where({ organizationId: eq("org-123"), status: eq("active") })
  .execute();

// R1 — filtered list (node-owned, broadcasts to all nodes by default)
const deployments = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({
    environment: eq("prod"),
    status:      inList(["running", "pending"] as const),
    replicaCount: gte(1),
  })
  .execute();
// deployments.meta.strategy → "broadcast"

// R7 — sorted
const sorted = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .sortBy("createdAt", "desc")
  .execute();

// R4 — offset pagination
const page2 = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .sortBy("createdAt", "desc")
  .limit(25)
  .offset(25)
  .execute();
// page2.meta.totalItems, page2.meta.hasMore

// R5 — cursor pagination
const first = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .sortBy("createdAt", "desc")
  .limit(25)
  .cursor(null)
  .execute();

const second = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .sortBy("createdAt", "desc")
  .limit(25)
  .cursor(first.meta.nextCursor ?? null)
  .execute();

// R6 — projection (narrows TItem)
const slim = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .select("deploymentId", "status", "nodeId")
  .execute();
// slim.items[0].data.deploymentId  ✓
// slim.items[0].data.image         ✗  compile error

// R9 — target specific node (node-owned ONLY)
const nodeAOnly = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .onNode("node-A")
  .where({ status: eq("running") })
  .execute();
// nodeAOnly.meta.strategy → "direct"

// mesh.from(ProjectMeshService.queries.projects.query).onNode("node-A")
// ✗ COMPILE ERROR — GlobalQueryBuilder does not have .onNode()

// Dynamic variable at execute time
const deploymentsByEnv = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: variable<"prod" | "staging">("env") });

const prodResult    = await deploymentsByEnv.execute({ vars: { env: "prod" } });
const stagingResult = await deploymentsByEnv.execute({ vars: { env: "staging" } });
```

---

## 6. Single-Item Read — `.read(id)`

`.read(id)` is the ONLY way to fetch a single item. It lives on `SingleItemReadBuilder`, which is returned by `mesh.from(resource.read)`. Collection builder methods are absent by design.

```typescript
// ── One-shot read (global resource) ──────────────────────────────────────────
const projectResult = await mesh
  .from(ProjectMeshService.queries.projects.read)
  .read({ projectId: "proj-abc-123" });

// projectResult.item: MeshResultItem<Project> | null
if (projectResult.item) {
  const { data: p, meta: m } = projectResult.item;
  console.log(p.name);
  console.log(m.nodeId);        // "coordinator" for global
  console.log(m.latencyMs);
}
console.log(projectResult.meta.strategy); // "coordinator"

// ── One-shot read (node-owned resource) ──────────────────────────────────────
// Step 1: coordinator lookup → "dep-abc lives on node-B"
// Step 2: direct request to node-B

const depResult = await mesh
  .from(DeploymentMeshService.queries.deployments.read)
  .read({ deploymentId: "dep-abc-123" });

console.log(depResult.meta.strategy);        // "coordinator-lookup-then-direct"
console.log(depResult.item?.meta.nodeId);    // "node-B"

// ── Live watch on a single item ───────────────────────────────────────────────
// R3 — enter listen mode, then provide the PK at execute time

const dep$ = mesh
  .from(DeploymentMeshService.queries.deployments.read)
  .listen()
  .execute({ deploymentId: "dep-abc-123" });

dep$.subscribe(result => {
  // result.meta.eventType: "snapshot" | "updated" | "deleted"
  if (!result.item) {
    console.log("Deployment deleted");
    return;
  }
  const { data, meta } = result.item;
  console.log(data.status, meta.eventType);
});

// ── Ownership changes handled automatically ───────────────────────────────────
// If the owning node fails and the resource is migrated, the live read
// automatically reconnects to the new owner without consumer intervention.
```

---

## 7. Live Subscriptions — `.listen().execute()`

```typescript
// L1 — basic live list (shared SSE connection)
const prod$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen()
  .execute();

prod$.subscribe(result => {
  // result.meta.connectionId         → shared connection ID
  // result.meta.sharedConsumerCount  → how many share it
  for (const { data, meta } of result.items) {
    console.log(data.deploymentId, meta.eventType, meta.changedFields);
  }
});

// L2 — debounced/throttled
const debounced$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen(b => b
    .debounce(200)
    .throttle(1_000)
    .withSnapshot(true)
  )
  .execute();

// L3 — field-change-only (typed field names)
const statusOnly$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen(b => b.onChange("status", "replicaCount"))  // keyof Deployment ✓
  .execute();

// L5 — .live() — full re-execute on every change event
const dashboard$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .include("project")
  .cache({ ttlMs: 3_000, tags: ["deployments"] })
  .live({ debounceMs: 200 });

dashboard$.subscribe(result => renderDashboard(result.items.map(i => i.data)));
```

---

## 8. Reactive Subqueries — `.whereFrom()`

```typescript
// L4 — deployments of active projects — fully reactive

// Layer 1: global, coordinator SSE
const activeProjects$ = mesh
  .from(ProjectMeshService.queries.projects.query)
  .where({ organizationId: eq("org-123"), status: eq("active") })
  .listen(b => b.onChange("status").debounce(100))
  .execute();

// Layer 2: node-owned, SSE to relevant nodes
// .whereFrom() uses switchMap:
//   - parent emits → recompute where → if changed → CONSUMER_DETACH old, CONSUMER_ATTACH new
//   - parent unchanged → NO reconnect (distinctUntilChanged guards)
const orgDeployments$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen(b => b.onChange("status", "replicaCount").debounce(50))
  .whereFrom(
    activeProjects$,
    result => ({
      // Typed: projectId is keyof Deployment; inList is valid for string fields ✓
      projectId: inList(result.items.map(i => i.data.projectId)),
    }),
  )
  .execute();

orgDeployments$.subscribe(result => {
  for (const { data: d, meta: m } of result.items) {
    console.log(d.deploymentId, m.eventType, m.changedFields, m.nodeId);
  }
});

// Three-level reactive chain: org → projects → deployments
const org$ = mesh
  .from(OrganizationMeshService.queries.organizations.read)
  .listen()
  .execute({ organizationId: "org-123" });

const projects$ = mesh
  .from(ProjectMeshService.queries.projects.query)
  .where({ status: eq("active") })
  .listen()
  .whereFrom(org$, r => ({
    organizationId: inList(r.item ? [r.item.data.organizationId] : []),
  }))
  .execute();

const deployments$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen(b => b.onChange("status"))
  .whereFrom(projects$, r => ({
    projectId: inList(r.items.map(i => i.data.projectId)),
  }))
  .execute();
```

---

## 9. Aggregations — `.aggregate()` and `.listen().aggregate()`

Aggregations follow the same terminal pattern as `.execute()`. One-shot calls return a `Promise`; calling `.listen()` before `.aggregate()` makes it reactive — returning an `Observable` that re-emits whenever relevant data changes.

There is **no** `aggregateLive()` method. The pattern is `.listen().aggregate()`.

```typescript
// A1 — one-shot count
const total = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .aggregate({ total: count() });
// total.total: number

// A2 — full stats
const stats = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .aggregate({
    total:       count(),
    totalCpu:    sum("cpuMillicores"),
    avgReplicas: avg("replicaCount"),
    maxReplicas: max("replicaCount"),
    minReplicas: min("replicaCount"),
  });
// Fully inferred: { total: number; totalCpu: number; avgReplicas: number; ... }

// A3 — grouped aggregation
const byStatus = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .aggregate({
    byEnvironment:   groupBy("environment", count()),
    byStatus:        groupBy("status", count()),
    statusPerEnv:    groupBy("environment", groupBy("status", count())),
    cpuByNode:       groupBy("nodeId", sum("cpuMillicores")),
    p99Latency:      percentile("cpuMillicores", 99),
    distinctImages:  distinct("image"),
  });
// byStatus.byEnvironment: Record<"prod"|"staging"|"canary", number>

// A2 reactive — .listen().aggregate() returns Observable<AggregateResult<TSpec>>
const stats$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen(b => b.debounce(500))
  .aggregate({
    total:    count(),
    byStatus: groupBy("status", count()),
    avgCpu:   avg("cpuMillicores"),
  });

// stats$: Observable<{ total: number; byStatus: Record<string, number>; avgCpu: number }>
stats$.subscribe(s => updateDashboard(s));

// Reactive aggregate with whereFrom
const orgStats$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen(b => b.debounce(300))
  .whereFrom(projects$, r => ({
    projectId: inList(r.items.map(i => i.data.projectId)),
  }))
  .aggregate({
    total:    count(),
    running:  count(),   // refined below by each project's filter
    byStatus: groupBy("status", count()),
  });

orgStats$.subscribe(stats => console.log("Org prod stats:", stats));
```

---

## 10. Aggregate Plugin System — `AggregateService`

Aggregation functions are not hardcoded into the mesh client. They are registered as versioned plugins via an injectable `AggregateService`. This allows:

- Services to declare their own aggregate functions
- Version negotiation (client knows what the server supports)
- Graceful errors when a consumer uses an aggregate the server doesn't yet have
- Composition of complex aggregates from simpler primitives

```typescript
// mesh-aggregate-plugin.ts

export interface MeshAggregator<TResult> {
  readonly name:        string;
  readonly version:     string;       // semver — for negotiation
  readonly description: string;
  partial(items: unknown[]): unknown;  // executed per-node
  merge(partials: unknown[]): TResult; // executed at caller
}

export interface AggregatePluginManifest {
  name:        string;
  version:     string;
  description: string;
  aggregators: Record<string, MeshAggregator<unknown>>;
}

@Injectable()
export class AggregateService {
  /** Built-in aggregators — always present */
  readonly utils: {
    count:      ()                                          => MeshAggregator<number>;
    sum:        (field: string)                            => MeshAggregator<number>;
    avg:        (field: string)                            => MeshAggregator<number>;
    min:        (field: string)                            => MeshAggregator<number>;
    max:        (field: string)                            => MeshAggregator<number>;
    distinct:   (field: string)                            => MeshAggregator<string[]>;
    collect:    <T>(field: string)                         => MeshAggregator<T[]>;
    groupBy:    <T>(field: string, inner: MeshAggregator<T>) => MeshAggregator<Record<string, T>>;
    histogram:  (field: string, buckets: number[])         => MeshAggregator<HistogramBucket[]>;
    percentile: (field: string, p: number)                 => MeshAggregator<number>;
    first:      (field: string)                            => MeshAggregator<unknown>;
    last:       (field: string)                            => MeshAggregator<unknown>;
    variance:   (field: string)                            => MeshAggregator<number>;
    stddev:     (field: string)                            => MeshAggregator<number>;
    rate:       (field: string, windowMs: number)          => MeshAggregator<number>;
  };

  /**
   * Resolve a named aggregator by plugin name + aggregator name.
   * Throws MeshAggregatorNotFoundError if the server doesn't support it.
   * Returns MeshAggregatorVersionMismatchError if versions are incompatible.
   */
  resolve(pluginName: string, aggregatorName: string): MeshAggregator<unknown>;

  /**
   * Check if the currently connected server supports a given aggregator.
   * Useful for feature-flagging aggregate-driven UI.
   */
  supports(pluginName: string, aggregatorName: string): boolean;

  /**
   * Observe the list of supported aggregators as the cluster topology changes.
   */
  readonly supported$: Observable<SupportedAggregators>;

  /**
   * Register a local aggregator (client-side only — no server phase).
   */
  registerLocal(manifest: AggregatePluginManifest): void;
}

export interface HistogramBucket {
  from: number;
  to:   number;
  count: number;
}
```

### 10.1 Custom plugin registration

```typescript
// deployment-aggregate-plugin.ts

import { defineAggregatePlugin } from "@mesh/core";

export const deploymentAggregatePlugin = defineAggregatePlugin({
  name:        "deployment-analytics",
  version:     "1.2.0",
  description: "Custom aggregations for deployment health and cost analysis",

  aggregators: {
    // Cost estimator: sum(cpu * cpuPricePerCore + mem * memPricePerGb)
    estimatedCost: {
      name:        "estimatedCost",
      version:     "1.0.0",
      description: "Estimate monthly cloud cost from resource usage",
      partial(items: { cpuMillicores: number; memoryMb: number }[]) {
        return items.reduce((sum, i) => {
          const cpu = (i.cpuMillicores / 1000) * 0.048;  // $0.048/core/hr
          const mem = (i.memoryMb / 1024) * 0.006;       // $0.006/gb/hr
          return sum + (cpu + mem) * 720;                 // monthly
        }, 0);
      },
      merge(partials: number[]) {
        return partials.reduce((s, p) => s + p, 0);
      },
    },

    // Health score: percentage of replicas that are "running"
    healthScore: {
      name:        "healthScore",
      version:     "1.0.0",
      description: "Ratio of running to total replicas as a 0–100 score",
      partial(items: { status: string; replicaCount: number }[]) {
        const total   = items.reduce((s, i) => s + i.replicaCount, 0);
        const running = items.filter(i => i.status === "running").reduce((s, i) => s + i.replicaCount, 0);
        return { total, running };
      },
      merge(partials: { total: number; running: number }[]) {
        const all = partials.reduce((s, p) => ({ total: s.total + p.total, running: s.running + p.running }), { total: 0, running: 0 });
        return all.total === 0 ? 100 : Math.round((all.running / all.total) * 100);
      },
    },
  },
});
```

### 10.2 Registering at module level

```typescript
// app.module.ts

MeshModule.forRoot({
  aggregatePlugins: [deploymentAggregatePlugin],
  middleware:       [...],
});
```

### 10.3 Consuming via `AggregateService`

```typescript
// deployment-dashboard.service.ts

@Injectable()
export class DeploymentDashboardService {
  constructor(
    private readonly mesh:   MeshContext,
    private readonly aggSvc: AggregateService,
  ) {}

  async getDashboardStats(orgId: string) {
    // Built-in utils
    const { count, avg, groupBy, sum } = this.aggSvc.utils;

    // Custom plugin aggregators (version-negotiated)
    const estimatedCost = this.aggSvc.resolve("deployment-analytics", "estimatedCost");
    const healthScore   = this.aggSvc.resolve("deployment-analytics", "healthScore");

    return await this.mesh
      .from(DeploymentMeshService.queries.deployments.query)
      .where({ environment: eq("prod") })
      .aggregate({
        total:    count(),
        byStatus: groupBy("status", count()),
        avgCpu:   avg("cpuMillicores"),
        cost:     estimatedCost,    // MeshAggregator<number>
        health:   healthScore,      // MeshAggregator<number>
      });
    // { total: number; byStatus: Record<string,number>; avgCpu: number; cost: number; health: number }
  }

  getLiveStats(orgId: string): Observable<{ total: number; health: number; cost: number }> {
    const { count } = this.aggSvc.utils;
    const healthScore   = this.aggSvc.resolve("deployment-analytics", "healthScore");
    const estimatedCost = this.aggSvc.resolve("deployment-analytics", "estimatedCost");

    return this.mesh
      .from(DeploymentMeshService.queries.deployments.query)
      .where({ environment: eq("prod") })
      .listen(b => b.debounce(500))
      .aggregate({ total: count(), health: healthScore, cost: estimatedCost });
    // Observable<{ total: number; health: number; cost: number }>
  }

  // Feature flag — does the server support the custom aggregator?
  hasAnalyticsPlugin(): boolean {
    return this.aggSvc.supports("deployment-analytics", "estimatedCost");
  }
}
```

### 10.4 Version mismatch errors

```typescript
import { MeshAggregatorNotFoundError, MeshAggregatorVersionMismatchError } from "@mesh/core";

try {
  const cost = this.aggSvc.resolve("deployment-analytics", "estimatedCost");
} catch (err) {
  if (err instanceof MeshAggregatorNotFoundError) {
    // Server does not have this plugin at all → fall back to manual calculation
    fallbackCostEstimation();
  } else if (err instanceof MeshAggregatorVersionMismatchError) {
    // Server has v0.9.0, consumer expects v1.0.0 → negotiation failed
    showUpgradePrompt(err.serverVersion, err.requiredVersion);
  }
}
```

---

## 11. Server-Side Joins

Joins are sent with the request — the joining is done server-side. Client-side join composition uses raw RxJS (see §26 for examples). Do not duplicate server-join logic with client-side RxJS merging.

```typescript
// J1 — builder-based join (sent server-side)
const activeProjects = mesh
  .from(ProjectMeshService.queries.projects.query)
  .where({ status: eq("active") });

const result = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .join(
    activeProjects,
    j => j
      .as("project")
      .on((deployment, project) => deployment.projectId === project.projectId)
      .type("left"),            // "left" (default) | "inner"
  )
  .execute();

// result.items[0].data.project:       Project | null   (typed from left join)
// result.items[0].data.project?.name: string           ✓

// J2 — auto-join via declared relation (no predicate needed)
const withRelations = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .include("project")       // declared in deploymentResource.relations ✓
  .include("metrics")       // has-many → metrics is an array ✓
  .execute();

// withRelations.items[0].data.project:  Project | null
// withRelations.items[0].data.metrics:  DeploymentMetric[]

// C3 — nested joins (three levels, server-side)
const projectsWithOrg = mesh
  .from(ProjectMeshService.queries.projects.query)
  .join(
    mesh.from(OrganizationMeshService.queries.organizations.query),
    j => j.as("organization").on((p, o) => p.organizationId === o.organizationId),
  );

const deepResult = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .join(
    projectsWithOrg,
    j => j.as("project").on((d, p) => d.projectId === p.projectId),
  )
  .execute();

// deepResult.items[0].data.project?.organization?.name  ✓  fully inferred

// J1 live — joins work in live mode too
const liveWithProject$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .join(
    mesh.from(ProjectMeshService.queries.projects.query).where({ status: eq("active") }),
    j => j.as("project").on((d, p) => d.projectId === p.projectId),
  )
  .listen(b => b.onChange("status"))
  .execute();
```

---

## 12. Mutations

```typescript
// M1 — Create (global → routes to coordinator)
const project = await mesh
  .from(ProjectMeshService.mutations.projects.create)
  .execute({ organizationId: "org-123", name: "Payments API", status: "active", ownerId: "user-456" });
// project.meta.nodeId → "coordinator"

// M1 — Create (node-owned → ownerField designates node)
const deployment = await mesh
  .from(DeploymentMeshService.mutations.deployments.create)
  .execute({
    projectId:    "proj-abc",
    serviceId:    "svc-api",
    nodeId:       "node-B",        // designates the owner node
    environment:  "prod",
    status:       "pending",
    replicaCount: 2,
    image:        "my-api:v3.0.0",
    cpuMillicores: 500,
    memoryMb:     256,
  });
// deployment.meta.nodeId → "node-B"

// M2 — Update (coordinator lookup → owner node → execute)
const updated = await mesh
  .from(DeploymentMeshService.mutations.deployments.update)
  .execute({ deploymentId: "dep-abc-123", status: "stopped", replicaCount: 0 });

// M3 — Delete
const deleted = await mesh
  .from(DeploymentMeshService.mutations.deployments.delete)
  .execute({ deploymentId: "dep-abc-123" });
// deleted.data.deleted: boolean

// M4 — Domain action
const restarted = await mesh
  .from(DeploymentMeshService.mutations.deployments.restart)
  .execute({ deploymentId: "dep-abc-123", graceful: true });
// restarted.data.jobId:             string
// restarted.data.estimatedSeconds:  number
// restarted.meta.nodeId:            "node-B" (executed on owner node)

// M4 — Scale
const scaled = await mesh
  .from(DeploymentMeshService.mutations.deployments.scale)
  .execute({ deploymentId: "dep-abc-123", replicas: 5 });
```

---

## 13. Optimistic Mutations

```typescript
// Immediate local state update; server reconciles; rolls back on failure
await mesh
  .from(DeploymentMeshService.mutations.deployments.update)
  .optimistic({
    patch:      current => ({ ...current, status: "stopped" as const }),
    onRollback: (original, err) => {
      console.warn("Rolled back to:", original.status, err);
    },
    onCommit:   server => {
      console.log("Server confirmed:", server.status);
    },
  })
  .invalidates(["deployments", "prod"])
  .execute({ deploymentId: "dep-abc-123", status: "stopped" });

// Optimistic scale with immediate replica count change
await mesh
  .from(DeploymentMeshService.mutations.deployments.scale)
  .optimistic({ patch: c => ({ ...c, replicaCount: 5 }) })
  .execute({ deploymentId: "dep-abc-123", replicas: 5 });
```

---

## 14. Distributed Sagas — with Descriptions & Diagnostics

Every step and compensation can carry a description for the diagnostic system. The saga itself can be named. A `DiagnosticContext` can be attached so all step events appear in your observability pipeline.

```typescript
// mesh-saga.types.ts (extended with descriptions)

export interface SagaStepConfig {
  /** Human-readable name for this step — shown in diagnostics */
  description?: string;
  /** Tags attached to all diagnostic events emitted by this step */
  tags?: Record<string, string>;
  /** Timeout for this specific step (ms). Overrides saga-level timeout. */
  timeoutMs?: number;
  /** Whether to retry this step on transient failure */
  retry?: { attempts: number; backoffMs: number };
}

export interface SagaConfig {
  /** Name shown in diagnostic views */
  name?: string;
  /** Description shown in diagnostic views */
  description?: string;
  /** Tags applied to all diagnostic events */
  tags?: Record<string, string>;
  /** Global timeout for the entire saga (ms) */
  timeoutMs?: number;
  /** Diagnostic context to attach */
  diagnostics?: MeshDiagnosticContext;
}
```

```typescript
// ── Full saga with descriptions ───────────────────────────────────────────────

interface DeploySagaContext {
  deploymentId: string;
  jobId:        string;
}

const diagnostics = mesh.diagnostics({ name: "deploy-prod", tags: { env: "prod" } });

const result = await mesh.saga<DeploySagaContext>({
  name:        "Create and start deployment",
  description: "Creates a new deployment, waits for node assignment, then starts it",
  tags:        { environment: "prod", serviceId: "svc-api" },
  diagnostics,
  timeoutMs:   120_000,
})
  .step("create-deployment", {
    description: "Persist the deployment record to the owning node",
    tags:        { phase: "persistence" },
    timeoutMs:   10_000,
  }, async ctx => {
    const r = await mesh
      .from(DeploymentMeshService.mutations.deployments.create)
      .execute({ projectId: "proj-abc", serviceId: "svc-api", nodeId: "node-B", environment: "prod", status: "pending", replicaCount: 2, image: "api:v3", cpuMillicores: 500, memoryMb: 256 });
    ctx.set("deploymentId", r.data.deploymentId);
  })
  .compensate("create-deployment", {
    description: "Roll back: delete the created deployment record",
  }, async ctx => {
    await mesh
      .from(DeploymentMeshService.mutations.deployments.delete)
      .execute({ deploymentId: ctx.get("deploymentId") });
  })

  .step("start-deployment", {
    description: "Issue restart to transition deployment from pending to running",
    tags:        { phase: "startup" },
    retry:       { attempts: 3, backoffMs: 2_000 },
  }, async ctx => {
    const r = await mesh
      .from(DeploymentMeshService.mutations.deployments.restart)
      .execute({ deploymentId: ctx.get("deploymentId"), graceful: false });
    ctx.set("jobId", r.data.jobId);
  })
  // No compensation for start — restart is idempotent

  .execute();

// result.success:          boolean
// result.completedSteps:   string[]          // ["create-deployment", "start-deployment"]
// result.failedStep:       string | null
// result.compensatedSteps: string[]
// result.context:          DeploySagaContext
// result.durationMs:       number
// result.diagnosticTrace:  MeshDiagnosticTrace  ← full event log with step descriptions

if (result.success) {
  console.log("Deployed:", result.context.deploymentId, "job:", result.context.jobId);
} else {
  console.error(`Failed at "${result.failedStep}" after ${result.durationMs}ms`);
  console.error("Compensated:", result.compensatedSteps);
  // result.diagnosticTrace.events shows exactly what happened at each step
}
```

---

## 15. Streaming Iterator — `.stream()`

```typescript
// Items arrive as soon as any node responds — no waiting for all nodes
for await (const { data: dep, meta } of mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ status: eq("pending") })
  .stream()
) {
  console.log(`[${meta.nodeId}] ${dep.deploymentId}`);
  await processPendingDeployment(dep);
}

// Early exit cleans up SSE connections on break
for await (const { data } of mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .stream()
) {
  if (shouldStop(data)) break;
  handle(data);
}

// Streaming with variables
for await (const { data } of mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: variable("env") })
  .stream({ vars: { env: "prod" } })
) {
  handle(data);
}
```

---

## 16. Typed Event Subscriptions — `.on()`

```typescript
// E1 — standard lifecycle events
mesh
  .on(DeploymentMeshService.resources.deployments)
  .event("updated")
  .where({ environment: eq("prod") })    // server-side filtered ✓
  .asObservable()
  .subscribe(event => {
    // event.item:       Deployment
    // event.previous:   Deployment | null
    // event.type:       "updated"
    // event.timestamp, event.sourceNodeId
    if (event.previous && event.item.status !== event.previous.status) {
      console.log(`${event.previous.status} → ${event.item.status}`);
    }
  });

// "any" — all lifecycle event types
mesh
  .on(DeploymentMeshService.resources.deployments)
  .event("any")
  .where({ nodeId: eq("node-A") })
  .asObservable()
  .pipe(filter(e => e.type !== "deleted"))
  .subscribe(e => console.log(e.type, e.item.deploymentId));

// E2 — custom domain event (typed payload from resource.events definition)
mesh
  .on(DeploymentMeshService.resources.deployments)
  .event("restarted")    // autocomplete from resource event types ✓
  .asObservable()
  .subscribe(event => {
    // event.item:    Deployment
    // event.payload: { jobId: string; graceful: boolean }
    console.log(`Restarted ${event.item.deploymentId}, job: ${event.payload.jobId}`);
  });

mesh
  .on(ProjectMeshService.resources.projects)
  .event("archived")
  .asObservable()
  .subscribe(event => {
    // event.payload: { archivedBy: string; reason?: string }
    console.log(`Project archived by ${event.payload.archivedBy}`);
  });
```

---

## 17. Query Plan Introspection — `.explain()`

```typescript
// Multi-item plan
const plan = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .include("project")
  .explain();

// MeshNodeOwnedQueryPlan {
//   resourceKey:     "deployments",
//   ownership:       "node-owned",
//   ownerField:      "nodeId",
//   routingStrategy: "broadcast",
//   targetNodes:     "all",
//   filterDescriptor: { environment: { _eq: "prod" } },
//   joins: [{ type: "include", relation: "project", entityKey: "projects", joinType: "left" }],
//   connectionReuse: {
//     perNode: [
//       { nodeId: "node-A", wouldReuse: true, existingConsumers: 3 },
//       { nodeId: "node-B", wouldReuse: false },
//     ]
//   },
//   warnings: [{ code: "CROSS_SERVICE_JOIN", severity: "info", message: "..." }]
// }

// Single-item read plan
const readPlan = await mesh
  .from(DeploymentMeshService.queries.deployments.read)
  .explain({ deploymentId: "dep-abc-123" });

// MeshNodeOwnedReadPlan {
//   ownership:        "node-owned",
//   routingStrategy:  "coordinator-lookup-then-direct",
//   coordinatorQuery: { table: "ownership_registry", pk: "dep-abc-123" },
//   resolvedNodeId:   "node-B"   // from coordinator cache
// }

// Aggregation plan
const aggPlan = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .aggregationPlan({ total: count(), byStatus: groupBy("status", count()) });
// {
//   executionPhases: [
//     { phase: "partial", targetNodes: "all", description: "Each node counts locally" },
//     { phase: "merge",   location: "client", description: "Caller merges partial counts" }
//   ],
//   missingAggregators: []  // populated if any custom agg not supported by server
// }
```

---

## 18. Connection Diagnostics, Lifecycle & Direct Node Access

### 18.1 Inspect open connections

```typescript
import { connectionStore } from "@mesh/core";

const open = connectionStore.inspect();
// [{
//   connectionId:  "conn-abc",
//   nodeId:        "node-A",
//   entityKey:     "deployments",
//   methodName:    "query",
//   consumerCount: 3,
//   openedAt:      Date,
//   status:        "open",
//   consumers: [
//     { consumerId: "cid-1", filterDescriptor: { environment: { _eq: "prod" } }, attachedAt: Date },
//     { consumerId: "cid-2", filterDescriptor: { environment: { _eq: "prod" }, status: { _eq: "running" } } },
//   ]
// }]
```

### 18.2 Observe lifecycle events

```typescript
connectionStore.lifecycle$.subscribe(event => {
  switch (event.type) {
    case "connection_opened":
      metrics.increment("mesh.connection.opened", { nodeId: event.nodeId, entity: event.entityKey });
      break;
    case "consumer_attached":
      metrics.gauge("mesh.consumers", event.consumerCount);
      break;
    case "consumer_detached":
      metrics.gauge("mesh.consumers", event.consumerCount);
      break;
    case "connection_closed":
      metrics.increment("mesh.connection.closed", { reason: event.reason });
      break;
    case "connection_degraded":
      alerts.warn(`Connection to ${event.nodeId} degraded: ${event.reason}`);
      break;
    case "connection_reconnected":
      metrics.increment("mesh.connection.reconnected", { attempt: String(event.attemptCount) });
      break;
  }
});
```

### 18.3 Explicit connection handle

```typescript
const handle = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .connect();

console.log(handle.connectionId);      // stable connection ID
console.log(handle.consumerId);        // this consumer's unique ID
console.log(handle.isShared);          // was an existing connection reused?
console.log(handle.consumerCount);     // how many share this connection

handle.refCount$.subscribe(n => console.log(`Consumers: ${n}`));
handle.status$.subscribe(s => console.log(`Status: ${s}`));

handle.events$.subscribe(envelope => {
  // Raw MeshStreamEnvelope with recipients[], entityKey, eventType
  console.log(envelope.payload, envelope.recipients);
});

handle.release();  // decrements refCount
```

### 18.4 Direct node connection (D3)

Bypass the broadcast pattern and connect directly to a specific node for diagnostics, maintenance, or partition-aware operations.

```typescript
// Establish a direct diagnostic connection to a specific node
const nodeConn = await connectionStore.connectToNode("node-A", {
  entityKey:   "deployments",
  description: "Maintenance inspection of node-A",
  tags:        { purpose: "maintenance" },
});

// nodeConn behaves like a regular connection handle
nodeConn.events$.subscribe(envelope => {
  console.log("[node-A raw]", envelope.entityKey, envelope.eventType, envelope.payload);
});

// Query specifically from this connection
const nodeADeps = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .onNode("node-A")
  .execute();

// Force-close a node's connections (admin use)
await connectionStore.closeNodeConnections("node-A", { reason: "scheduled-maintenance" });

// Reconnect after maintenance
await connectionStore.reconnectNode("node-A");
```

### 18.5 Node health monitoring

```typescript
const nodeHealth$ = connectionStore.nodeHealth$;

nodeHealth$.subscribe(snapshot => {
  // snapshot: Record<nodeId, NodeHealthStatus>
  for (const [nodeId, health] of Object.entries(snapshot)) {
    console.log(nodeId, health.status, health.latencyMs, health.consumerCount);
    // health.status: "healthy" | "degraded" | "unreachable"
    // health.openConnections: number
    // health.lastSeenAt: Date
  }
});
```

---

## 19. Mesh Discovery — Resource Location

Discovery is accessed directly via `mesh.discovery` — a property on `MeshContext`. There is no separate `MeshDiscoveryService` to inject.

```typescript
// mesh-context.ts (discovery property)

export interface MeshDiscovery {
  /**
   * Locate the node that owns a specific item by primary key.
   * Uses the coordinator's ownership registry — does NOT fetch item data.
   * Returns null if not found.
   */
  locate<TItem, TPK extends keyof TItem & string>(
    resource: ResourceDescriptor<any, any, any>,
    pk: Pick<TItem, TPK>,
  ): Promise<NodeLocation | null>;

  /**
   * List all nodes that hold items of a given resource type.
   * For node-owned: all nodes that have at least one item.
   * For global: returns ["coordinator"].
   */
  nodesFor(resource: ResourceDescriptor<any, any, any>): Promise<NodeInfo[]>;

  /**
   * Watch the cluster topology in real time.
   * Emits on node join, leave, upgrade, and role change.
   */
  readonly topology$: Observable<ClusterTopologyEvent>;

  /**
   * Get the current known topology snapshot.
   */
  getTopology(): ClusterTopology;

  /**
   * Subscribe to a specific node's status.
   */
  watchNode(nodeId: string): Observable<NodeStatusEvent>;

  /**
   * Find all nodes that satisfy a capability requirement.
   * E.g. "which nodes have the deployment-analytics aggregate plugin v1.x?"
   */
  findNodesWithCapability(capability: MeshCapabilityQuery): Promise<NodeInfo[]>;

  /**
   * Watch ownership changes for a resource — emits when items migrate between nodes.
   */
  watchOwnership(
    resource: ResourceDescriptor<any, any, any>,
  ): Observable<OwnershipChangeEvent>;

  /**
   * Estimate which node(s) a query will target — without executing it.
   */
  resolveQueryTargets<TItem>(
    builder: MultiItemQueryBuilder<TItem, any>,
  ): Promise<QueryTargetResolution>;
}

export interface NodeLocation {
  nodeId:        string;
  nodeAddress:   string;
  region?:       string;
  zone?:         string;
  capabilities:  string[];
  assignedAt:    Date;
}

export interface NodeInfo extends NodeLocation {
  status:        "healthy" | "degraded" | "unreachable";
  version:       string;
  resourceCount: number;
  lastSeenAt:    Date;
}

export interface ClusterTopology {
  coordinator:    NodeInfo;
  nodes:          NodeInfo[];
  totalResources: number;
  updatedAt:      Date;
}

export interface QueryTargetResolution {
  strategy:    "direct" | "broadcast" | "targeted-broadcast";
  targetNodes: string[];
  reason:      string;
}

export interface OwnershipChangeEvent {
  resourceKey:    string;
  primaryKey:     string;
  fromNodeId:     string;
  toNodeId:       string;
  reason:         "migration" | "failover" | "rebalance";
  timestamp:      Date;
}
```

### 19.1 Usage examples

Everything starts from `this.mesh` — no separate discovery injection needed.

```typescript
// deployment-location.service.ts

@Injectable()
export class DeploymentLocationService {
  constructor(private readonly mesh: MeshContext) {}

  async findDeploymentNode(deploymentId: string): Promise<NodeLocation | null> {
    return this.mesh.discovery.locate(deploymentResource, { deploymentId });
  }

  async getClusterOverview() {
    const [topology, deploymentNodes] = await Promise.all([
      this.mesh.discovery.getTopology(),
      this.mesh.discovery.nodesFor(deploymentResource),
    ]);

    return {
      totalNodes:       topology.nodes.length,
      healthyNodes:     topology.nodes.filter(n => n.status === "healthy").length,
      deploymentNodes:  deploymentNodes.map(n => ({ nodeId: n.nodeId, count: n.resourceCount })),
    };
  }

  watchMigrations(): Observable<OwnershipChangeEvent> {
    return this.mesh.discovery.watchOwnership(deploymentResource).pipe(
      filter(e => e.reason === "failover"),
      tap(e => console.log(`Failover: ${e.primaryKey} moved from ${e.fromNodeId} to ${e.toNodeId}`)),
    );
  }

  watchTopology(): Observable<ClusterTopologyEvent> {
    return this.mesh.discovery.topology$.pipe(
      tap(event => {
        if (event.type === "node_left") {
          alerts.critical(`Node ${event.nodeId} left the cluster`);
        }
      }),
    );
  }

  async findNodesWithAnalyticsPlugin(): Promise<NodeInfo[]> {
    return this.mesh.discovery.findNodesWithCapability({
      plugin:     "deployment-analytics",
      minVersion: "1.0.0",
    });
  }

  // Resolve where a query will go without executing it
  async preflightCheck(): Promise<void> {
    const resolution = await this.mesh.discovery.resolveQueryTargets(
      this.mesh
        .from(DeploymentMeshService.queries.deployments.query)
        .where({ environment: eq("prod") }),
    );
    console.log(`Query will go to ${resolution.targetNodes.length} nodes via "${resolution.strategy}"`);
  }
}
```

---

## 20. Pagination — Offset & Cursor

```typescript
// Async generator helper — offset
async function* paginateOffset<T>(
  builder: MultiItemQueryBuilder<T, any>,
  pageSize = 25,
): AsyncGenerator<{ items: T[]; page: number; total: number }> {
  let offset = 0, page = 0;
  while (true) {
    const result = await builder.limit(pageSize).offset(offset).execute();
    if (result.items.length === 0) break;
    yield { items: result.items.map(i => i.data), page: ++page, total: result.meta.totalItems };
    if (!result.meta.hasMore) break;
    offset += pageSize;
  }
}

for await (const { items, page, total } of paginateOffset(
  mesh.from(DeploymentMeshService.queries.deployments.query).where({ environment: eq("prod") }),
  50,
)) {
  console.log(`Page ${page}, ${items.length} items of ${total}`);
}

// Cursor generator — stable for live data
async function* paginateCursor<T>(
  builder: MultiItemQueryBuilder<T, any>,
  pageSize = 25,
): AsyncGenerator<{ items: T[]; cursor: string | null }> {
  let cursor: string | null = null;
  do {
    const result = await builder.limit(pageSize).cursor(cursor).execute();
    cursor = result.meta.nextCursor ?? null;
    yield { items: result.items.map(i => i.data), cursor };
  } while (cursor !== null);
}
```

---

## 21. Projections — `.select()`

```typescript
// Narrows TItem — compile errors for fields not selected
const slim = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .select("deploymentId", "status", "replicaCount", "nodeId")
  .execute();

// slim.items[0].data.deploymentId  ✓
// slim.items[0].data.image         ✗  compile error — not selected

// Projection on join side
const result = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .join(
    mesh.from(ProjectMeshService.queries.projects.query).select("projectId", "name"),
    j => j.as("project").on((d, p) => d.projectId === p.projectId),
  )
  .select("deploymentId", "status")
  .execute();

// result.items[0].data.project?.name     ✓
// result.items[0].data.project?.ownerId  ✗  compile error
```

---

## 22. Caching Layer

```typescript
const cached = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .cache({ ttlMs: 5_000, tags: ["deployments", "prod"], staleWhileRevalidate: true })
  .execute();

// cached.items[0].meta.cached: boolean

// Invalidate on mutation
await mesh
  .from(DeploymentMeshService.mutations.deployments.update)
  .invalidates(["deployments", "prod"])
  .execute({ deploymentId: "dep-abc", status: "stopped" });

// Manual cache control
import { meshCache } from "@mesh/core";
meshCache.invalidate(["deployments"]);
meshCache.invalidateQuery({ entityKey: "deployments", filter: { environment: { _eq: "prod" } } });
meshCache.clear();
```

---

## 23. Query Middleware Pipeline

```typescript
MeshModule.forRoot({
  middleware: [
    new MeshTracingMiddleware(tracer, { captureFilterDescriptor: true }),
    new MeshLoggingMiddleware(logger, { logLevel: "debug" }),
    new MeshCircuitBreakerMiddleware({ threshold: 5, resetAfterMs: 30_000 }),
    new MeshCacheMiddleware(redisCacheAdapter),
    new MeshRateLimitMiddleware({ requestsPerSecond: 100 }),
  ],
  aggregatePlugins: [deploymentAggregatePlugin],
});

// Custom middleware
class TenantIsolationMiddleware implements MeshQueryMiddleware {
  name = "tenant-isolation";

  async execute<T>(ctx, next) {
    // Inject an always-on org filter from the request context
    if (!ctx.filterDescriptor.organizationId && ctx.requestContext.organizationId) {
      ctx.filterDescriptor = {
        _and: [ctx.filterDescriptor, { organizationId: { _eq: ctx.requestContext.organizationId } }],
      };
    }
    return next();
  }
}
```

---

## 24. Diagnostic Tracing — Named Steps & Event Descriptions

The diagnostic system gives every operation a name, description, and tag set. These appear in your observability pipeline (OpenTelemetry, Datadog, etc.) and in the `diagnosticTrace` on saga results.

```typescript
// mesh-diagnostics.ts

export interface MeshDiagnosticContext {
  readonly name:        string;
  readonly description?: string;
  readonly tags:        Record<string, string>;
  readonly traceId?:    string;     // link to existing distributed trace

  /** Observe all events emitted in this diagnostic context */
  readonly events$: Observable<MeshDiagnosticEvent>;
}

export type MeshDiagnosticEvent =
  | { type: "query_start";        name: string; entityKey: string; filter: unknown }
  | { type: "query_end";          name: string; entityKey: string; itemCount: number; durationMs: number }
  | { type: "query_error";        name: string; entityKey: string; error: unknown }
  | { type: "mutation_start";     name: string; entityKey: string; mutationType: string }
  | { type: "mutation_end";       name: string; entityKey: string; durationMs: number }
  | { type: "saga_step_start";    sagaName: string; stepId: string; description?: string }
  | { type: "saga_step_end";      sagaName: string; stepId: string; durationMs: number }
  | { type: "saga_step_failed";   sagaName: string; stepId: string; error: unknown }
  | { type: "saga_compensate";    sagaName: string; stepId: string; description?: string }
  | { type: "connection_open";    nodeId: string; entityKey: string }
  | { type: "connection_close";   nodeId: string; entityKey: string; reason: string }
  | { type: "consumer_attach";    connectionId: string; consumerId: string }
  | { type: "consumer_detach";    connectionId: string; consumerId: string };

export interface MeshDiagnosticTrace {
  name:       string;
  startedAt:  Date;
  endedAt:    Date;
  durationMs: number;
  events:     Array<MeshDiagnosticEvent & { timestamp: Date }>;
  tags:       Record<string, string>;
}
```

```typescript
// Usage — attach diagnostics to any operation

const diag = mesh.diagnostics({
  name:        "org-dashboard-load",
  description: "Initial data load for the organization dashboard",
  tags:        { userId: "user-123", orgId: "org-abc", page: "dashboard" },
});

// Diagnostics on queries
const projects = await mesh
  .from(ProjectMeshService.queries.projects.query)
  .where({ organizationId: eq("org-abc") })
  .withDiagnostics(diag)
  .execute();

// Diagnostics on live subscriptions
const live$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .withDiagnostics(diag)
  .listen()
  .execute();

// Observe all diagnostic events in real time
diag.events$.subscribe(event => {
  telemetry.record(event);
});

// Full trace after saga (included in result)
const sagaResult = await mesh.saga({ name: "provision-service", diagnostics: diag })
  .step("create-deployment", { description: "..." }, async ctx => { ... })
  .execute();

console.log(sagaResult.diagnosticTrace.events);
// All events with timestamps — each saga step, its duration, any errors
```

---

## 25. Additional Concepts & APIs

### 25.1 Request Batching

Automatically batch multiple one-shot requests made within the same tick into a single network round trip.

```typescript
// Individually declared — mesh batches them automatically
const [projects, metrics, deployments] = await mesh.batch([
  mesh.from(ProjectMeshService.queries.projects.query).where({ organizationId: eq("org-123") }),
  mesh.from(DeploymentMeshService.queries.metrics.query).where({ recordedAt: gte("2024-01-01T00:00:00Z") }),
  mesh.from(DeploymentMeshService.queries.deployments.query).where({ environment: eq("prod") }),
]);
// All three requests sent in one round trip to the coordinator
```

### 25.2 Health Probes

```typescript
import { meshHealth } from "@mesh/core";

// Readiness check — are all coordinator and known nodes reachable?
const ready = await meshHealth.checkReadiness();
// { ready: boolean; nodes: Record<nodeId, "ok"|"degraded"|"unreachable"> }

// Liveness check — is the mesh client itself functioning?
const alive = await meshHealth.checkLiveness();
// { alive: boolean; openConnections: number; pendingRequests: number }

// Observe cluster health changes
meshHealth.health$.subscribe(snapshot => {
  const degraded = Object.entries(snapshot.nodes).filter(([, s]) => s !== "ok");
  if (degraded.length > 0) {
    alerts.warn("Degraded nodes:", degraded);
  }
});
```

### 25.3 Schema Registry Access

Query the runtime schemas that are registered across the cluster — useful for tooling, admin panels, and dynamic form generation.

```typescript
import { meshSchemaRegistry } from "@mesh/core";

// Get the Zod schema for any resource key
const schema = meshSchemaRegistry.getSchema("deployments");
// Returns ZodObject — can be used for client-side form validation

// List all registered resources
const resources = meshSchemaRegistry.listResources();
// [{ key: "deployments", namespace: "deployment", ownership: "node-owned", ... }]

// Watch schema changes (e.g., when a new service version deploys with schema changes)
meshSchemaRegistry.changes$.subscribe(change => {
  console.log(`Schema for "${change.resourceKey}" changed at ${change.version}`);
});
```

### 25.4 Request Context Propagation

Inject per-request context (user, org, correlation ID) that flows through all mesh operations.

```typescript
import { MeshRequestContext } from "@mesh/core";

// Attach context to the current async scope (e.g., in an HTTP middleware)
MeshRequestContext.run({
  userId:         "user-123",
  organizationId: "org-abc",
  requestId:      req.headers["x-request-id"],
  roles:          ["admin"],
}, async () => {
  // All mesh calls within this scope have the context attached
  const deps = await mesh
    .from(DeploymentMeshService.queries.deployments.query)
    .where({ ownerId: ctx("ctx.userId") })  // resolves to "user-123"
    .execute();
});
```

### 25.5 Subscription Lease Management

For long-lived subscriptions in serverless or short-lived environments, leases prevent orphaned connections.

```typescript
import { meshLeaseManager } from "@mesh/core";

// Create a lease-bound subscription (auto-released when lease expires)
const lease = meshLeaseManager.createLease({
  ttlMs:       60_000,              // 60s lease
  renewOnEvent: true,               // auto-renew on every received event
  onExpire:     () => console.log("Lease expired, subscription released"),
});

const sub = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen()
  .withLease(lease)
  .execute()
  .subscribe(handleResult);

// Renew manually
lease.renew();

// Release early
lease.release();
```

### 25.6 Conflict Resolution Hooks

When an item is updated concurrently from multiple nodes, conflict resolution hooks determine the winner.

```typescript
// Declared on the resource
export const deploymentResource = defineResource({
  ...
  conflictResolution: {
    strategy: "last-write-wins",    // "last-write-wins" | "custom"
    // Custom resolver — called on the owning node when a conflict is detected
    resolve?: (current: Deployment, incoming: Deployment, meta: ConflictMeta) => Deployment,
  },
});
```

### 25.7 Mesh Circuit Breaker (per-resource)

Fine-grained circuit breakers per resource, independent of the middleware pipeline.

```typescript
import { meshCircuitBreaker } from "@mesh/core";

// Observe circuit state changes
meshCircuitBreaker.state$.subscribe(event => {
  if (event.state === "open") {
    console.log(`Circuit open for ${event.entityKey} on ${event.nodeId}`);
  }
});

// Manually open/close for testing or maintenance
await meshCircuitBreaker.open("deployments", "node-A", { reason: "planned-maintenance" });
await meshCircuitBreaker.close("deployments", "node-A");
```

### 25.8 Mesh Event Replay

Replay past events for a resource — useful for event sourcing, debugging, and catch-up subscriptions.

```typescript
const replay$ = mesh
  .on(DeploymentMeshService.resources.deployments)
  .event("any")
  .replay({
    from:  new Date("2024-01-01T00:00:00Z"),
    to:    new Date("2024-01-02T00:00:00Z"),
    limit: 1_000,
  })
  .asObservable();

replay$.subscribe(event => {
  console.log(`[REPLAY] ${event.timestamp} ${event.type} ${event.item.deploymentId}`);
});
```

### 25.9 Mesh Presence (Who Is Watching What)

Query which consumers are subscribed to which resources in real time — useful for collaborative features.

```typescript
import { meshPresence } from "@mesh/core";

// Who is currently watching the "prod deployments" stream?
const watchers = await meshPresence.getWatchers({
  entityKey: "deployments",
  filter:    { environment: { _eq: "prod" } },
});
// [{ consumerId, userId, attachedAt, nodeId }]

// Watch presence changes
meshPresence.watch({ entityKey: "deployments" }).subscribe(event => {
  // event.type: "joined" | "left"
  console.log(`Consumer ${event.consumerId} ${event.type}`);
});
```

---

## 26. Combined Patterns — Real-World Scenarios

### Scenario 1: Fully reactive organisation dashboard

```typescript
import { combineLatest, map } from "rxjs";

@Injectable()
export class OrgDashboardService {
  constructor(
    private readonly mesh:   MeshContext,
    private readonly aggSvc: AggregateService,
  ) {}

  buildDashboard$(orgId: string) {
    const { count, groupBy } = this.aggSvc.utils;
    const healthScore = this.aggSvc.resolve("deployment-analytics", "healthScore");

    // Layer 1 — org (single item, live)
    const org$ = this.mesh
      .from(OrganizationMeshService.queries.organizations.read)
      .listen()
      .execute({ organizationId: orgId });

    // Layer 2 — active projects (global, coordinator SSE)
    const projects$ = this.mesh
      .from(ProjectMeshService.queries.projects.query)
      .where({ organizationId: eq(orgId), status: eq("active") })
      .listen(b => b.onChange("status", "name").debounce(100))
      .execute();

    // Layer 3 — deployments reactive to project list
    const deployments$ = this.mesh
      .from(DeploymentMeshService.queries.deployments.query)
      .where({ environment: eq("prod") })
      .listen(b => b.onChange("status", "replicaCount").debounce(50))
      .whereFrom(projects$, r => ({
        projectId: inList(r.items.map(i => i.data.projectId)),
      }))
      .execute();

    // Layer 4 — live stats (reactive aggregate — .listen().aggregate())
    const stats$ = this.mesh
      .from(DeploymentMeshService.queries.deployments.query)
      .where({ environment: eq("prod") })
      .listen(b => b.debounce(300))
      .whereFrom(projects$, r => ({
        projectId: inList(r.items.map(i => i.data.projectId)),
      }))
      .aggregate({ total: count(), byStatus: groupBy("status", count()), health: healthScore });

    return combineLatest({ org: org$, projects: projects$, deployments: deployments$, stats: stats$ });
  }
}
```

### Scenario 2: Build log tail — node-targeted, streaming

```typescript
async function tailBuildLogs(deploymentId: string) {
  // Locate owner node without triggering a data query
  const location = await mesh.discovery.locate(deploymentResource, { deploymentId });
  if (!location) throw new Error(`Deployment ${deploymentId} not found`);

  const { nodeId } = location;

  // Tail logs directly from that node — ONLY available on NodeOwnedQueryBuilder ✓
  const logs$ = mesh
    .from(DeploymentMeshService.queries.logs.query)
    .onNode(nodeId)
    .where({ deploymentId: eq(deploymentId), level: inList(["info", "error", "warn"] as const) })
    .sortBy("timestamp", "asc")
    .listen(b => b.withSnapshot(false))
    .execute();

  const sub = logs$.subscribe(result => {
    for (const { data: log, meta } of result.items) {
      if (meta.eventType === "created") {
        process.stdout.write(`[${log.level.toUpperCase()}] ${log.message}\n`);
      }
    }
  });

  // Stop tailing when deployment finishes
  const dep$ = mesh
    .from(DeploymentMeshService.queries.deployments.read)
    .listen()
    .execute({ deploymentId });

  dep$.pipe(
    filter(r => r.item?.data.status === "running" || r.item?.data.status === "failed"),
  ).subscribe(() => sub.unsubscribe());
}
```

### Scenario 3: Multi-region health aggregate

```typescript
import { forkJoin } from "rxjs";

const NODES = ["node-eu-west", "node-us-east", "node-ap-south"];

const healthChecks = forkJoin(
  Object.fromEntries(
    NODES.map(nodeId => [
      nodeId,
      mesh
        .from(DeploymentMeshService.queries.metrics.query)
        .onNode(nodeId)
        .aggregate({ avgCpu: avg("cpuUsage"), avgLatency: avg("p99LatencyMs"), count: count() }),
    ]),
  ),
);

const report = await healthChecks;
for (const [nodeId, m] of Object.entries(report)) {
  const status = m.avgCpu > 80 || m.avgLatency > 500 ? "DEGRADED" : "HEALTHY";
  console.log(`${nodeId}: ${status} — CPU: ${m.avgCpu.toFixed(1)}% p99: ${m.avgLatency.toFixed(0)}ms`);
}
```

### Scenario 4: Batch saga scale with rollback

```typescript
async function scaleAllProd(replicas: number, diagnostics?: MeshDiagnosticContext) {
  const running = await mesh
    .from(DeploymentMeshService.queries.deployments.query)
    .where({ environment: eq("prod"), status: eq("running") })
    .select("deploymentId", "replicaCount")
    .execute();

  let saga = mesh.saga<{ scaled: string[] }>({
    name:        `scale-prod-to-${replicas}`,
    description: `Scale all prod deployments to ${replicas} replicas`,
    diagnostics,
    timeoutMs:   300_000,
  });

  for (const { data: dep } of running.items) {
    const { deploymentId, replicaCount: prev } = dep;
    saga = saga
      .step(`scale-${deploymentId}`, {
        description: `Scale ${deploymentId} from ${prev} to ${replicas}`,
        tags:        { deploymentId, fromReplicas: String(prev), toReplicas: String(replicas) },
      }, async ctx => {
        await mesh.from(DeploymentMeshService.mutations.deployments.scale).execute({ deploymentId, replicas });
        ctx.set("scaled", [...(ctx.get("scaled") ?? []), deploymentId]);
      })
      .compensate(`scale-${deploymentId}`, {
        description: `Rollback ${deploymentId} to ${prev} replicas`,
      }, async () => {
        await mesh.from(DeploymentMeshService.mutations.deployments.scale).execute({ deploymentId, replicas: prev });
      });
  }

  return saga.execute();
}
```

---

## 27. Complete Type Appendix

### Builder discrimination table

| `mesh.from(...)` argument | Ownership | Builder type | `.onNode()` | `.read()` | Terminal |
|---------------------------|-----------|--------------|-------------|-----------|---------|
| `projects.query` | global | `MultiItemQueryBuilder<Project, never>` | ✗ compile error | ✗ | `.execute()` / `.listen()` / `.aggregate()` / `.stream()` |
| `projects.read` | global | `SingleItemReadBuilder<Project, "projectId">` | ✗ | `.read(pk)` | `.read(pk)` / `.listen().execute(pk)` |
| `deployments.query` | node-owned | `MultiItemQueryBuilder<Deployment, "nodeId">` | ✓ | ✗ | `.execute()` / `.listen()` / `.aggregate()` / `.stream()` |
| `deployments.read` | node-owned | `SingleItemReadBuilder<Deployment, "deploymentId">` | ✗ | `.read(pk)` | `.read(pk)` / `.listen().execute(pk)` |
| `deployments.mutations.restart` | node-owned | `MeshMutationBuilder<RestartInput, RestartOutput>` | ✗ | ✗ | `.execute(input)` |

### Invariants

| # | Invariant |
|---|-----------|
| I1 | `mesh.from(resource.read)` returns `SingleItemReadBuilder` — no collection methods |
| I2 | `mesh.from(resource.query)` returns `MultiItemQueryBuilder` — no `.read(pk)` |
| I3 | `.listen()` on a `MultiItemQueryBuilder` returns `LiveMultiItemBuilder` — no `.where()`, `.sortBy()`, `.limit()` after this point |
| I4 | `.listen().aggregate(spec)` returns `Observable<AggregateResult>` — there is no `aggregateLive()` method |
| I5 | `AggregateService` is the single source of aggregate functions — no top-level imports |
| I6 | Aggregators are versioned — `aggSvc.resolve()` throws on version mismatch |
| I7 | Joins are sent server-side with the request — client-side RxJS is used for cross-stream composition |
| I8 | `.onNode()` only exists on `MultiItemQueryBuilder<TItem, TOwner extends string>` — compile error on global |
| I9 | Dynamic variables are resolved at `.execute()` / `.listen()` call time, not builder construction time |
| I10 | Saga steps can carry `description`, `tags`, `timeoutMs`, and `retry` — these are structural, not cosmetic |
| I11 | `mesh.discovery.locate()` queries only the ownership registry — does not fetch item data |
| I12 | `connectionStore.connectToNode()` opens a direct diagnostic connection — bypasses broadcast routing |
| I13 | `mesh.diagnostics()` returns a context that can be attached to queries, mutations, and sagas |
| I14 | Connections are shared by fingerprint — at most one SSE per node per entity+method |
| I15 | Server evaluates event recipients once per emit — events with no recipients are suppressed entirely |
| I16 | All capabilities (cache, middleware, diagnostics, joins, projections, variables) compose orthogonally |
| I17 | `mesh.discovery` is a property on `MeshContext` — there is no separate `MeshDiscoveryService` to inject |

# Mesh Use Cases & Complete API Reference — v9

> **Scope:** Every consumer-facing use case catalogued and mapped to its precise API shape.
> **Rule:** No `any`, no casts, no string literals in operation references. Correct types enforce correct usage at compile time.

---

## Table of Contents

1. [Use Case Catalogue](#1-use-case-catalogue)
2. [Foundation: Where Expressions & Dynamic Variables](#2-foundation-where-expressions--dynamic-variables)
3. [Resource & Service Definitions](#3-resource--service-definitions)
4. [Multi-Item Query Builder vs Single-Item Read Builder — The Discriminated Split](#4-multi-item-query-builder-vs-single-item-read-builder----the-discriminated-split)
5. [One-Shot Queries — `.execute()`](#5-one-shot-queries----execute)
6. [Single-Item Read — `.read(id)`](#6-single-item-read----readid)
7. [Live Subscriptions — `.listen().execute()`](#7-live-subscriptions----listenexecute)
8. [Reactive Subqueries — `.whereFrom()`](#8-reactive-subqueries----wherefrom)
9. [Aggregations — `.aggregate()` and `.listen().aggregate()`](#9-aggregations----aggregate-and-listenaggregate)
10. [Aggregate Plugin System — `AggregateService`](#10-aggregate-plugin-system----aggregateservice)
11. [Server-Side Joins](#11-server-side-joins)
12. [Mutations](#12-mutations)
13. [Optimistic Mutations](#13-optimistic-mutations)
14. [Distributed Sagas — with Descriptions & Diagnostics](#14-distributed-sagas----with-descriptions--diagnostics)
15. [Streaming Iterator — `.stream()`](#15-streaming-iterator----stream)
16. [Typed Event Subscriptions — `.on()`](#16-typed-event-subscriptions----on)
17. [Query Plan Introspection — `.explain()`](#17-query-plan-introspection----explain)
18. [Connection Diagnostics, Lifecycle & Direct Node Access](#18-connection-diagnostics-lifecycle--direct-node-access)
19. [Mesh Discovery — Resource Location](#19-mesh-discovery----resource-location)
20. [Pagination — Offset & Cursor](#20-pagination----offset--cursor)
21. [Projections — `.select()`](#21-projections----select)
22. [Caching Layer](#22-caching-layer)
23. [Query Middleware Pipeline](#23-query-middleware-pipeline)
24. [Diagnostic Tracing — Named Steps & Event Descriptions](#24-diagnostic-tracing----named-steps--event-descriptions)
25. [Additional Concepts & APIs](#25-additional-concepts--apis)
26. [Combined Patterns — Real-World Scenarios](#26-combined-patterns----real-world-scenarios)
27. [Complete Type Appendix — Core Result & Option Types](#27-complete-type-appendix----core-result--option-types)
28. [Typed Error Hierarchy](#28-typed-error-hierarchy)
29. [Light Transactions — `mesh.transaction()`](#29-light-transactions----meshtransaction)
30. [Computed Fields — `defineComputedField()`](#30-computed-fields----definecomputedfield)
31. [Resource Versioning & Schema Migrations](#31-resource-versioning--schema-migrations)
32. [Testing Utilities — `createMeshTestHarness()`](#32-testing-utilities----createmesttestharness)
33. [Builder Discrimination & Invariants](#33-builder-discrimination--invariants)

---

## 1. Use Case Catalogue

| Category | # | Use Case | Terminal |
|----------|---|----------|----------|
| **Read** | R1 | List with filters | `.execute()` |
| **Read** | R2 | Single item by PK | `.read(pk)` |
| **Read** | R3 | Single item live watch | `.listen().execute(pk)` |
| **Read** | R4 | Offset pagination | `.limit().offset().execute()` |
| **Read** | R5 | Cursor pagination | `.cursor().execute()` |
| **Read** | R6 | Projected fetch | `.select().execute()` |
| **Read** | R7 | Sorted list | `.sortBy().execute()` |
| **Read** | R8 | Fan-out all nodes | `.execute()` (node-owned default) |
| **Read** | R9 | Specific node | `.onNode(id).execute()` |
| **Read** | R10 | Node set | `.onNodes([...]).execute()` |
| **Live** | L1 | Real-time list | `.listen().execute()` |
| **Live** | L2 | Debounced stream | `.listen(b => b.debounce()).execute()` |
| **Live** | L3 | Field-change-only | `.listen(b => b.onChange()).execute()` |
| **Live** | L4 | Reactive subquery | `.listen().whereFrom().execute()` |
| **Live** | L5 | Live query (full re-exec) | `.live()` |
| **Aggregate** | A1 | One-shot aggregate | `.aggregate({ ... })` |
| **Aggregate** | A2 | Reactive aggregate | `.listen().aggregate({ ... })` |
| **Aggregate** | A3 | Grouped aggregate | `.aggregate({ x: groupBy(...) })` |
| **Aggregate** | A4 | Custom plugin aggregate | `aggSvc.resolve("plugin", "name")` |
| **Mutation** | M1 | Create | `mesh.from(...create).execute(input)` |
| **Mutation** | M2 | Update | `mesh.from(...update).execute(patch)` |
| **Mutation** | M3 | Delete | `mesh.from(...delete).execute({ pk })` |
| **Mutation** | M4 | Domain action | `mesh.from(...action).execute(input)` |
| **Mutation** | M5 | Optimistic mutation | `.optimistic({}).execute()` |
| **Mutation** | M6 | With cache invalidation | `.invalidates([]).execute()` |
| **Transaction** | TX1 | Coordinated multi-mutation | `mesh.transaction().add().execute()` |
| **Saga** | S1 | Multi-step distributed transaction | `mesh.saga().step().compensate().execute()` |
| **Saga** | S2 | Named/described saga steps | `.step("id", { description: "..." }, fn)` |
| **Stream** | ST1 | Async iterator | `.stream()` |
| **Event** | E1 | Lifecycle event subscription | `.on().event().asObservable()` |
| **Event** | E2 | Custom domain event | `.on().event("restarted").asObservable()` |
| **Event** | E3 | Event replay | `.on().event().replay({ from, to }).asObservable()` |
| **Join** | J1 | Server-side join | `.join(subBuilder, config).execute()` |
| **Join** | J2 | Auto-join via relation | `.include("relation").execute()` |
| **Discovery** | DV1 | Locate resource owner | `mesh.discovery.locate(resource, pk)` |
| **Discovery** | DV2 | List nodes for entity | `mesh.discovery.nodesFor(resource)` |
| **Discovery** | DV3 | Watch node topology | `mesh.discovery.topology$` |
| **Connections** | CN1 | Inspect open connections | `mesh.connections.inspect()` |
| **Connections** | CN2 | Connection lifecycle events | `mesh.connections.lifecycle$` |
| **Connections** | CN3 | Direct node connection | `mesh.connections.connectToNode(nodeId, opts)` |
| **Connections** | CN4 | Explicit connection handle | `.connect()` |
| **Diagnostics** | D1 | Named diagnostic context | `mesh.diagnostics({ name, tags })` |
| **Diagnostics** | D2 | Attach to query/mutation/saga | `.withDiagnostics(ctx)` |
| **Introspection** | I1 | Query plan | `.explain()` |
| **Introspection** | I2 | Aggregation plan | `.aggregationPlan(spec)` |
| **Composition** | C1 | Reusable builder fragments | `const base = mesh.from(...).where(...)` |
| **Composition** | C2 | Where with dynamic variables | `.where({ status: variable("s") })` |
| **Composition** | C3 | Computed fields | `defineComputedField(resource, "field", fn)` |
| **Testing** | T1 | In-memory test harness | `createMeshTestHarness(services)` |
| **Testing** | T2 | Seed test data | `harness.seed(resource, [...items])` |
| **Testing** | T3 | Assert queries | `harness.assertQueried(descriptor, times)` |

---

## 2. Foundation: Where Expressions & Dynamic Variables

The where system is a typed predicate tree that works identically on both sides of the wire. The same expression serializes to JSON for server evaluation and executes as a predicate locally.

### 2.1 Static expressions

```typescript
// @mesh/where — mesh-where.types.ts

export type Scalar = string | number | boolean | null;

// ── Operator map ────────────────────────────────────────────────────────────────

type Operators = {
  _eq:         Scalar;
  _neq:        Scalar;
  _gt:         number;
  _gte:        number;
  _lt:         number;
  _lte:        number;
  _in:         readonly (string | number)[];
  _nin:        readonly (string | number)[];
  _contains:   string;
  _startsWith: string;
  _endsWith:   string;
  _between:    readonly [number, number];
  _isNull:     boolean;
  _or:         readonly (MeshWhereExpr | FieldWhere<Scalar>)[];
  _and:        readonly (MeshWhereExpr | FieldWhere<Scalar>)[];
  _var:        MeshVariable<Scalar>;
  _ctx:        MeshContextKey;
};

export type MeshWhereExpr<
  TOp extends keyof Operators = keyof Operators,
  TVal extends Operators[TOp] = Operators[TOp],
> = { readonly _brand: "MeshWhereExpr" } & { readonly [K in TOp]: TVal };

// ── Per-field operator constraint ────────────────────────────────────────────────

export type FieldWhere<V> =
  V extends boolean
    ? MeshWhereExpr<"_eq", boolean>
    | MeshWhereExpr<"_neq", boolean>
    | MeshWhereExpr<"_isNull", boolean>
  : V extends number
    ? MeshWhereExpr<"_eq", number>
    | MeshWhereExpr<"_neq", number>
    | MeshWhereExpr<"_gt", number>
    | MeshWhereExpr<"_gte", number>
    | MeshWhereExpr<"_lt", number>
    | MeshWhereExpr<"_lte", number>
    | MeshWhereExpr<"_in", readonly number[]>
    | MeshWhereExpr<"_nin", readonly number[]>
    | MeshWhereExpr<"_between", readonly [number, number]>
    | MeshWhereExpr<"_isNull", boolean>
    | MeshWhereExpr<"_var", MeshVariable<number>>
  : V extends string
    ? MeshWhereExpr<"_eq", string>
    | MeshWhereExpr<"_neq", string>
    | MeshWhereExpr<"_in", readonly string[]>
    | MeshWhereExpr<"_nin", readonly string[]>
    | MeshWhereExpr<"_contains", string>
    | MeshWhereExpr<"_startsWith", string>
    | MeshWhereExpr<"_endsWith", string>
    | MeshWhereExpr<"_isNull", boolean>
    | MeshWhereExpr<"_var", MeshVariable<string>>
    | MeshWhereExpr<"_ctx", MeshContextKey>
  : never;

// Only scalar-valued fields appear in where clauses.
export type ObjectWhere<T> = {
  [K in keyof T]?: T[K] extends Scalar ? FieldWhere<T[K]> : never;
};

export type WhereInput<T> =
  | ObjectWhere<T>
  | MeshWhereExpr<"_or", readonly (MeshWhereExpr | FieldWhere<Scalar>)[]>
  | MeshWhereExpr<"_and", readonly (MeshWhereExpr | FieldWhere<Scalar>)[]>;

// Only scalar fields are sortable.
export type SortableField<T> = {
  [K in keyof T]: T[K] extends Scalar ? K : never;
}[keyof T] & string;
```

### 2.2 Operator helper functions

These are the only way to construct `FieldWhere` expressions — no raw object literals.

```typescript
// @mesh/where — operators.ts

import type { MeshWhereExpr, FieldWhere } from "./mesh-where.types";

export const eq   = <V extends Scalar>(v: V): MeshWhereExpr<"_eq", V>  => ({ _brand: "MeshWhereExpr", _eq: v });
export const neq  = <V extends Scalar>(v: V): MeshWhereExpr<"_neq", V> => ({ _brand: "MeshWhereExpr", _neq: v });
export const gt   = (v: number): MeshWhereExpr<"_gt">   => ({ _brand: "MeshWhereExpr", _gt: v });
export const gte  = (v: number): MeshWhereExpr<"_gte">  => ({ _brand: "MeshWhereExpr", _gte: v });
export const lt   = (v: number): MeshWhereExpr<"_lt">   => ({ _brand: "MeshWhereExpr", _lt: v });
export const lte  = (v: number): MeshWhereExpr<"_lte">  => ({ _brand: "MeshWhereExpr", _lte: v });

export const inList = <V extends string | number>(
  vs: readonly V[],
): MeshWhereExpr<"_in", readonly V[]> => ({ _brand: "MeshWhereExpr", _in: vs });

export const notIn = <V extends string | number>(
  vs: readonly V[],
): MeshWhereExpr<"_nin", readonly V[]> => ({ _brand: "MeshWhereExpr", _nin: vs });

export const contains    = (v: string): MeshWhereExpr<"_contains", string>    => ({ _brand: "MeshWhereExpr", _contains: v });
export const startsWith  = (v: string): MeshWhereExpr<"_startsWith", string>  => ({ _brand: "MeshWhereExpr", _startsWith: v });
export const endsWith    = (v: string): MeshWhereExpr<"_endsWith", string>    => ({ _brand: "MeshWhereExpr", _endsWith: v });
export const between     = (lo: number, hi: number): MeshWhereExpr<"_between", readonly [number, number]> =>
  ({ _brand: "MeshWhereExpr", _between: [lo, hi] as const });
export const isNull      = (v: boolean): MeshWhereExpr<"_isNull", boolean>    => ({ _brand: "MeshWhereExpr", _isNull: v });

export const or  = (...exprs: (MeshWhereExpr | FieldWhere<Scalar>)[]): MeshWhereExpr<"_or">  => ({ _brand: "MeshWhereExpr", _or: exprs });
export const and = (...exprs: (MeshWhereExpr | FieldWhere<Scalar>)[]): MeshWhereExpr<"_and"> => ({ _brand: "MeshWhereExpr", _and: exprs });
```

### 2.3 Dynamic variables

Variables let you build a where clause once and resolve it differently per call.

```typescript
// @mesh/where — variables.ts

// ── Type-safe variable map (no `as any`) ─────────────────────────────────────

type ScalarTypeMap = {
  string:  string;
  number:  number;
  boolean: boolean;
};

export interface MeshVariable<T extends Scalar> {
  readonly _brand:   "MeshVariable";
  readonly name:     string;
  readonly type:     T extends string ? "string" : T extends number ? "number" : "boolean";
  readonly default?: T;
}

export function variable<T extends Scalar>(
  name: string,
  options?: { default?: T; type: T extends string ? "string" : T extends number ? "number" : "boolean" },
): MeshVariable<T> {
  return {
    _brand:   "MeshVariable",
    name,
    type:     options?.type ?? (typeof options?.default as MeshVariable<T>["type"]),
    default:  options?.default,
  };
}

// ── Context shortcuts — resolved from the authenticated request context ───────

export type MeshContextKey =
  | "ctx.userId"
  | "ctx.organizationId"
  | "ctx.nodeId"
  | "ctx.requestId";

export const ctx = (key: MeshContextKey): MeshWhereExpr<"_ctx", MeshContextKey> =>
  ({ _brand: "MeshWhereExpr", _ctx: key });
```

```typescript
// ── Usage ─────────────────────────────────────────────────────────────────────

import { eq, inList, variable, ctx } from "@mesh/where";

// Build once, resolve differently per call
const deploymentsByEnv = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: variable<"prod" | "staging" | "canary">("env", { type: "string" }) });

const prod    = await deploymentsByEnv.execute({ vars: { env: "prod" } });
const staging = await deploymentsByEnv.execute({ vars: { env: "staging" } });

// Live stream — variable resolved reactively via switchMap
const env$ = new BehaviorSubject<"prod" | "staging">("prod");
const live$ = env$.pipe(
  switchMap(env =>
    deploymentsByEnv.listen().execute({ vars: { env } }),
  ),
);

// Context-based filter — userId resolved from authenticated request scope
const myDeployments = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ ownerId: ctx("ctx.userId") })
  .execute();
```

---

## 3. Resource & Service Definitions

```typescript
// schemas.ts
import { z } from "zod";

export const projectSchema = z.object({
  projectId:      z.string().uuid(),
  organizationId: z.string().uuid(),
  name:           z.string().min(1).max(200),
  status:         z.enum(["active", "archived"]),
  ownerId:        z.string().uuid(),
  createdAt:      z.string().datetime(),
});

export const deploymentSchema = z.object({
  deploymentId:  z.string().uuid(),
  projectId:     z.string().uuid(),
  serviceId:     z.string().uuid(),
  nodeId:        z.string(),
  environment:   z.enum(["prod", "staging", "canary"]),
  status:        z.enum(["running", "pending", "stopped", "failed"]),
  replicaCount:  z.number().int().min(0).max(50),
  image:         z.string(),
  cpuMillicores: z.number().int().min(0),
  memoryMb:      z.number().int().min(0),
  createdAt:     z.string().datetime(),
  updatedAt:     z.string().datetime(),
});

export const deploymentMetricSchema = z.object({
  metricId:     z.string().uuid(),
  deploymentId: z.string().uuid(),
  nodeId:       z.string(),
  cpuUsage:     z.number().min(0).max(100),
  memoryUsage:  z.number().min(0).max(100),
  requestRate:  z.number().min(0),
  errorRate:    z.number().min(0).max(1),
  p99LatencyMs: z.number().min(0),
  recordedAt:   z.string().datetime(),
});

// Derive TypeScript types from schemas — used throughout examples
export type Project          = z.infer<typeof projectSchema>;
export type Deployment       = z.infer<typeof deploymentSchema>;
export type DeploymentMetric = z.infer<typeof deploymentMetricSchema>;
```

```typescript
// resources.ts
import { defineResource, defineMutation, defineRelation } from "@mesh/core";

export const projectResource = defineResource({
  schema:     projectSchema,
  primaryKey: "projectId",
  ownership:  { type: "global" } as const,
  events: {
    archived: z.object({ archivedBy: z.string().uuid(), reason: z.string().optional() }),
  },
});

export const deploymentResource = defineResource({
  schema:     deploymentSchema,
  primaryKey: "deploymentId",
  ownership:  { type: "node-owned", ownerField: "nodeId" } as const,
  events: {
    restarted: z.object({ jobId: z.string().uuid(), graceful: z.boolean() }),
    scaled:    z.object({ from: z.number().int(), to: z.number().int() }),
  },
}).extend({
  mutations: {
    restart: defineMutation({
      input:       z.object({ deploymentId: z.string().uuid(), graceful: z.boolean().default(true) }),
      output:      z.object({ restarting: z.boolean(), estimatedSeconds: z.number(), jobId: z.string().uuid() }),
      description: "Gracefully restart a running deployment",
    }),
    scale: defineMutation({
      input:       z.object({ deploymentId: z.string().uuid(), replicas: z.number().int().min(0).max(50) }),
      output:      z.object({ deploymentId: z.string().uuid(), replicaCount: z.number().int(), scaledAt: z.string().datetime() }),
      description: "Scale replica count up or down",
    }),
  },
  relations: {
    project: defineRelation({
      entity: () => projectResource,
      type:   "belongs-to",
      on:     (d, p) => d.projectId === p.projectId,
    }),
    metrics: defineRelation({
      entity: () => deploymentMetricResource,
      type:   "has-many",
      on:     (d, m) => d.deploymentId === m.deploymentId,
    }),
  },
});

export const deploymentMetricResource = defineResource({
  schema:     deploymentMetricSchema,
  primaryKey: "metricId",
  ownership:  { type: "node-owned", ownerField: "nodeId" } as const,
});
```

```typescript
// services.ts
import { defineMeshService } from "@mesh/core";

export class ProjectMeshService extends defineMeshService({
  namespace: "project",
  resources: { projects: projectResource },
}) {}

export class DeploymentMeshService extends defineMeshService({
  namespace: "deployment",
  resources: {
    deployments: deploymentResource,
    metrics:     deploymentMetricResource,
  },
}) {}
```

### 3.1 What `defineMeshService` generates

For each resource `R` in `resources`, the service class gains:

```typescript
// Auto-generated — shown for reference only

ProjectMeshService.queries.projects.query  // QueryDescriptor<Project, never, "projectId">
ProjectMeshService.queries.projects.read   // ReadDescriptor<Project, never, "projectId">
ProjectMeshService.mutations.projects.create
ProjectMeshService.mutations.projects.update
ProjectMeshService.mutations.projects.delete
ProjectMeshService.resources.projects      // ResourceDescriptor — used by .on() and mesh.discovery

DeploymentMeshService.queries.deployments.query  // QueryDescriptor<Deployment, "nodeId", "deploymentId">
DeploymentMeshService.queries.deployments.read   // ReadDescriptor<Deployment, "nodeId", "deploymentId">
DeploymentMeshService.mutations.deployments.create
DeploymentMeshService.mutations.deployments.update
DeploymentMeshService.mutations.deployments.delete
DeploymentMeshService.mutations.deployments.restart  // from .extend()
DeploymentMeshService.mutations.deployments.scale    // from .extend()
DeploymentMeshService.resources.deployments
```

---

## 4. Multi-Item Query Builder vs Single-Item Read Builder — The Discriminated Split

This is the central type-safety invariant of the builder API. The compiler enforces that multi-item methods and single-item methods cannot be mixed.

```typescript
// @mesh/core — builder.types.ts

/**
 * MULTI-ITEM builder — entry state from mesh.from(descriptor.query).
 * .read(pk) does NOT exist here — compile error if attempted.
 *
 * TItem   = the item type (narrows with .select())
 * TOwner  = the node-owner field name ("nodeId"), or `never` for global resources
 */
export interface MultiItemQueryBuilder<TItem, TOwner extends string | never> {
  // ── Filtering ──────────────────────────────────────────────────────────────
  where(expr: WhereInput<TItem>): MultiItemQueryBuilder<TItem, TOwner>;

  // ── Sorting ────────────────────────────────────────────────────────────────
  sortBy(field: SortableField<TItem>, dir?: "asc" | "desc"): MultiItemQueryBuilder<TItem, TOwner>;

  // ── Pagination ─────────────────────────────────────────────────────────────
  limit(n: number):              MultiItemQueryBuilder<TItem, TOwner>;
  offset(n: number):             MultiItemQueryBuilder<TItem, TOwner>;
  cursor(token: string | null):  MultiItemQueryBuilder<TItem, TOwner>;

  // ── Projection — TItem narrows to Pick<TItem, K> ──────────────────────────
  select<K extends keyof TItem & string>(
    ...fields: [K, ...K[]]
  ): MultiItemQueryBuilder<Pick<TItem, K>, TOwner extends K ? TOwner : never>;

  // ── Server-side joins ─────────────────────────────────────────────────────
  join<TRight, TAlias extends string>(
    right: MultiItemQueryBuilder<TRight, string | never>,
    config: (j: JoinConfigurator<TItem, TRight>) => JoinResult<TAlias, TRight>,
  ): MultiItemQueryBuilder<TItem & { [K in TAlias]: TRight | null }, TOwner>;

  // Relation key is constrained to declared relations on the resource.
  include<TRelation extends keyof ResourceRelations<TItem>>(
    relation: TRelation,
  ): MultiItemQueryBuilder<TItem & ResolvedRelation<TItem, TRelation>, TOwner>;

  // ── Node routing — only on node-owned; compile error on global ────────────
  onNode(
    nodeId: string,
  ): TOwner extends string ? MultiItemQueryBuilder<TItem, TOwner> : never;

  onNodes(
    nodeIds: readonly string[],
  ): TOwner extends string ? MultiItemQueryBuilder<TItem, TOwner> : never;

  // ── Caching ───────────────────────────────────────────────────────────────
  cache(opts: CacheOptions): MultiItemQueryBuilder<TItem, TOwner>;

  // ── Diagnostics ───────────────────────────────────────────────────────────
  withDiagnostics(ctx: MeshDiagnosticContext): MultiItemQueryBuilder<TItem, TOwner>;

  // ── Terminals ─────────────────────────────────────────────────────────────
  execute(options?: ExecuteOptions<TItem>): Promise<MeshQueryResult<TItem>>;
  stream(options?: StreamOptions<TItem>):   AsyncIterable<MeshResultItem<TItem>>;
  explain():                                Promise<MeshQueryPlan>;
  aggregationPlan<TSpec extends AggregateSpec>(spec: TSpec): Promise<MeshAggregationPlan>;
  aggregate<TSpec extends AggregateSpec>(spec: TSpec): Promise<AggregateResult<TSpec>>;

  // ── Connection handle — explicit lifecycle control ─────────────────────────
  connect(): Promise<MeshConnectionHandle<TItem>>;

  // ── Live mode — returns LiveMultiItemBuilder; no further .where()/.sortBy() ─
  listen(config?: (b: ListenConfig<TItem>) => ListenConfig<TItem>): LiveMultiItemBuilder<TItem, TOwner>;

  // Full re-execute on every change event — shorthand for listen + execute
  live(options?: LiveOptions): Observable<MeshQueryResult<TItem>>;
}

/**
 * LIVE multi-item builder — returned by .listen().
 * Filtering / sorting / pagination must be set BEFORE .listen().
 */
export interface LiveMultiItemBuilder<TItem, TOwner extends string | never> {
  whereFrom<TSource>(
    source$: Observable<MeshQueryResult<TSource>>,
    mapToWhere: (result: MeshQueryResult<TSource>) => WhereInput<TItem>,
  ): LiveMultiItemBuilder<TItem, TOwner>;

  withLease(lease: MeshLease): LiveMultiItemBuilder<TItem, TOwner>;

  /** Terminal → Observable<MeshQueryResult<TItem>> */
  execute(options?: LiveExecuteOptions<TItem>): Observable<MeshQueryResult<TItem>>;

  /** Terminal → Observable<AggregateResult<TSpec>> */
  aggregate<TSpec extends AggregateSpec>(spec: TSpec): Observable<AggregateResult<TSpec>>;
}

/**
 * SINGLE-ITEM read builder — from mesh.from(descriptor.read).
 * .where(), .sortBy(), .limit(), .cursor() do NOT exist here.
 */
export interface SingleItemReadBuilder<TItem, TPK extends keyof TItem & string> {
  withDiagnostics(ctx: MeshDiagnosticContext): SingleItemReadBuilder<TItem, TPK>;
  explain(pk: Pick<TItem, TPK>): Promise<MeshReadPlan>;

  /** Terminal: one-shot fetch */
  read(pk: Pick<TItem, TPK>): Promise<MeshReadResult<TItem>>;

  /** Enter live mode for a single item */
  listen(): SingleItemLiveBuilder<TItem, TPK>;
}

export interface SingleItemLiveBuilder<TItem, TPK extends keyof TItem & string> {
  withLease(lease: MeshLease): SingleItemLiveBuilder<TItem, TPK>;
  /** Terminal → Observable<MeshReadResult<TItem>> */
  execute(pk: Pick<TItem, TPK>): Observable<MeshReadResult<TItem>>;
}

/**
 * MUTATION builder — from mesh.from(descriptor.mutation).
 */
export interface MeshMutationBuilder<TInput, TOutput> {
  optimistic(opts: OptimisticOptions<TOutput>): MeshMutationBuilder<TInput, TOutput>;
  invalidates(tags: readonly string[]): MeshMutationBuilder<TInput, TOutput>;
  withDiagnostics(ctx: MeshDiagnosticContext): MeshMutationBuilder<TInput, TOutput>;
  /** Terminal */
  execute(input: TInput): Promise<MeshMutationResult<TOutput>>;
}
```

### 4.1 How `.from()` returns the correct builder type

```typescript
// @mesh/core — mesh-context.ts

export interface MeshContext {
  /** Multi-item query. .read() does NOT exist on the returned builder. */
  from<TItem, TOwner extends string | never, TPK extends string>(
    descriptor: QueryDescriptor<TItem, TOwner, TPK>,
  ): MultiItemQueryBuilder<TItem, TOwner>;

  /** Single-item read. .where(), .sortBy(), .limit() do NOT exist on the returned builder. */
  from<TItem, TOwner, TPK extends keyof TItem & string>(
    descriptor: ReadDescriptor<TItem, TOwner, TPK>,
  ): SingleItemReadBuilder<TItem, TPK>;

  /** Mutation. Returns MeshMutationBuilder. */
  from<TInput, TOutput>(
    descriptor: MutationDescriptor<TInput, TOutput>,
  ): MeshMutationBuilder<TInput, TOutput>;

  /** Create a named diagnostic context. */
  diagnostics(opts: { name: string; description?: string; tags?: Record<string, string>; traceId?: string }): MeshDiagnosticContext;

  /** Subscribe to typed resource events. */
  on<TItem, TEvents extends Record<string, z.ZodTypeAny>>(
    resource: ResourceDescriptor<TItem, TEvents>,
  ): MeshEventBuilder<TItem, TEvents>;

  /** Batch multiple one-shot queries into a single network round trip. */
  batch<TBuilders extends ReadonlyArray<MultiItemQueryBuilder<unknown, string | never>>>(
    builders: TBuilders,
  ): Promise<{ [K in keyof TBuilders]: TBuilders[K] extends MultiItemQueryBuilder<infer T, string | never> ? MeshQueryResult<T> : never }>;

  /** Multi-step distributed saga. */
  saga<TCtx extends Record<string, unknown> = Record<string, never>>(
    config: SagaConfig,
  ): SagaBuilder<TCtx>;

  /** Coordinated multi-mutation transaction (lighter than a saga). */
  transaction(config?: TransactionConfig): MeshTransactionBuilder;

  /** Connection management and diagnostics. */
  readonly connections: MeshConnections;

  /** Cluster topology and resource ownership discovery. */
  readonly discovery: MeshDiscovery;
}
```

### 4.2 Compile-time enforcement examples

```typescript
import { eq } from "@mesh/where";

// ✓ CORRECT: multi-item query — .execute() terminal
const result = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ status: eq("running") })
  .limit(10)
  .sortBy("createdAt", "desc")
  .execute();

// ✓ CORRECT: single-item read — .read(pk) terminal
const single = await mesh
  .from(DeploymentMeshService.queries.deployments.read)
  .read({ deploymentId: "dep-abc-123" });

// ✗ COMPILE ERROR: SingleItemReadBuilder has no .where()
mesh.from(DeploymentMeshService.queries.deployments.read)
  .where({ status: eq("running") });   // ← Property 'where' does not exist

// ✗ COMPILE ERROR: MultiItemQueryBuilder has no .read()
mesh.from(DeploymentMeshService.queries.deployments.query)
  .read({ deploymentId: "dep-abc-123" });   // ← Property 'read' does not exist

// ✗ COMPILE ERROR: LiveMultiItemBuilder has no .limit() — call it before .listen()
mesh.from(DeploymentMeshService.queries.deployments.query)
  .listen()
  .limit(10)   // ← Property 'limit' does not exist on LiveMultiItemBuilder
  .execute();

// ✗ COMPILE ERROR: .onNode() does not exist on a global resource
mesh.from(ProjectMeshService.queries.projects.query)
  .onNode("node-A");   // ← never (TOwner = never)
```

---

## 5. One-Shot Queries — `.execute()`

```typescript
import { eq, inList, gte, variable } from "@mesh/where";

// R1 — basic filtered list (global resource → coordinator)
const projects = await mesh
  .from(ProjectMeshService.queries.projects.query)
  .where({ organizationId: eq("org-123"), status: eq("active") })
  .execute();
// projects: MeshQueryResult<Project>
// projects.items: MeshResultItem<Project>[]
// projects.meta.strategy → "coordinator"

// R1 — filtered list (node-owned → broadcast to all nodes by default)
const deployments = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({
    environment:  eq("prod"),
    status:       inList(["running", "pending"] as const),
    replicaCount: gte(1),
  })
  .execute();
// deployments.meta.strategy → "broadcast"

// R7 — sorted
const sorted = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .sortBy("createdAt", "desc")
  .execute();

// R4 — offset pagination
const page2 = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .sortBy("createdAt", "desc")
  .limit(25)
  .offset(25)
  .execute();
// page2.meta.totalItems: number
// page2.meta.hasMore:    boolean

// R5 — cursor pagination (stable across live mutations)
const first = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .sortBy("createdAt", "desc")
  .limit(25)
  .cursor(null)
  .execute();

const second = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .sortBy("createdAt", "desc")
  .limit(25)
  .cursor(first.meta.nextCursor ?? null)
  .execute();

// R6 — projection (TItem narrows at compile time)
const slim = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .select("deploymentId", "status", "nodeId")
  .execute();
// slim.items[0].data.deploymentId  ✓  (type: string)
// slim.items[0].data.image         ✗  compile error — field not selected

// R9 — target a specific node (node-owned ONLY)
const nodeAOnly = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .onNode("node-A")
  .where({ status: eq("running") })
  .execute();
// nodeAOnly.meta.strategy → "direct"

// R10 — target a set of nodes
const euNodes = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .onNodes(["node-eu-west", "node-eu-central"])
  .where({ environment: eq("prod") })
  .execute();

// C2 — dynamic variable resolved at execute time
const deploymentsByEnv = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: variable<"prod" | "staging">("env", { type: "string" }) });

const prodResult    = await deploymentsByEnv.execute({ vars: { env: "prod" } });
const stagingResult = await deploymentsByEnv.execute({ vars: { env: "staging" } });

// C1 — reusable base fragment
const activeProdQuery = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod"), status: eq("running") });

const withHighCpu = await activeProdQuery
  .where({ cpuMillicores: gte(800) })
  .sortBy("cpuMillicores", "desc")
  .execute();
```

---

## 6. Single-Item Read — `.read(pk)`

`.read(pk)` is the **only** way to fetch a single item. It lives on `SingleItemReadBuilder`, returned by `mesh.from(descriptor.read)`. Collection methods are absent by design.

```typescript
// ── One-shot read (global resource — routes to coordinator) ──────────────────

const projectResult = await mesh
  .from(ProjectMeshService.queries.projects.read)
  .read({ projectId: "proj-abc-123" });
// projectResult: MeshReadResult<Project>

if (projectResult.item) {
  const { data: p, meta: m } = projectResult.item;
  console.log(p.name);
  console.log(m.nodeId);      // "coordinator"
  console.log(m.latencyMs);   // number
}
console.log(projectResult.meta.strategy); // "coordinator"

// ── One-shot read (node-owned — coordinator lookup then direct) ───────────────
// Phase 1: coordinator registry → "dep-abc lives on node-B"
// Phase 2: direct request to node-B

const depResult = await mesh
  .from(DeploymentMeshService.queries.deployments.read)
  .read({ deploymentId: "dep-abc-123" });
// depResult.meta.strategy        → "coordinator-lookup-then-direct"
// depResult.item?.meta.nodeId    → "node-B"
// depResult.item?.data           → Deployment (full record)

// ── Live watch on a single item (R3) ─────────────────────────────────────────

const dep$ = mesh
  .from(DeploymentMeshService.queries.deployments.read)
  .listen()
  .execute({ deploymentId: "dep-abc-123" });

dep$.subscribe(result => {
  // result: MeshReadResult<Deployment>
  // result.meta.eventType: "snapshot" | "updated" | "deleted"
  if (!result.item) {
    console.log("Deployment was deleted");
    return;
  }
  const { data, meta } = result.item;
  console.log(data.status, meta.eventType, meta.changedFields);
});

// ── Node failover is transparent ─────────────────────────────────────────────
// If the owning node fails and the item migrates, the live read
// reconnects to the new owner automatically. No consumer-side handling needed.
```

---

## 7. Live Subscriptions — `.listen().execute()`

```typescript
import { eq } from "@mesh/where";

// L1 — basic live list (shared SSE connection per node+entity+filter fingerprint)
const prod$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen()
  .execute();

prod$.subscribe(result => {
  // result.meta.connectionId         → stable connection ID
  // result.meta.sharedConsumerCount  → number of consumers sharing this connection
  for (const { data, meta } of result.items) {
    // meta.eventType:     "snapshot" | "created" | "updated" | "deleted"
    // meta.changedFields: (keyof Deployment)[] | undefined — set on "updated" only
    // meta.nodeId:        string
    console.log(data.deploymentId, meta.eventType, meta.changedFields);
  }
});

// L2 — debounced + throttled
const debounced$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen(b => b
    .debounce(200)         // coalesce rapid updates within 200ms
    .throttle(1_000)       // emit at most once per second
    .withSnapshot(true)    // emit the current state immediately on subscribe
  )
  .execute();

// L3 — field-change-only (only emit when these specific fields change)
const statusOnly$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen(b => b.onChange("status", "replicaCount"))  // keyof Deployment ✓
  .execute();
// Won't emit on image, cpuMillicores, or other field changes

// L5 — .live() — full re-execute on every change event (no SSE streaming)
const dashboard$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .include("project")
  .cache({ ttlMs: 3_000, tags: ["deployments"] })
  .live({ debounceMs: 200 });

dashboard$.subscribe(result =>
  renderDashboard(result.items.map(i => i.data)),
);
```

### 7.1 `ListenConfig` API

```typescript
// @mesh/core — listen-config.types.ts

export interface ListenConfig<TItem> {
  /** Coalesce multiple rapid events into one emission (ms). Default: 0. */
  debounce(ms: number): this;

  /** Emit at most once per interval (ms). */
  throttle(ms: number): this;

  /**
   * Only emit when any of the listed fields change.
   * Field names are constrained to keyof TItem — compile error on unknown fields.
   */
  onChange(...fields: (keyof TItem & string)[]): this;

  /**
   * When true (default), emit the current state immediately on subscribe
   * before any incremental events arrive.
   */
  withSnapshot(enabled: boolean): this;

  /**
   * Maximum number of items to buffer between emissions.
   * Excess items trigger an immediate flush. Default: unlimited.
   */
  bufferSize(n: number): this;
}
```

---

## 8. Reactive Subqueries — `.whereFrom()`

`.whereFrom()` wires two live streams together. When the source stream emits, the derived stream recomputes its `where` clause and reconnects if it changed. Internally it uses `switchMap` with `distinctUntilChanged` — unchanged where clauses do not trigger a reconnect.

```typescript
import { eq, inList } from "@mesh/where";

// L4 — deployments for active projects — fully reactive

// Layer 1: global, coordinator SSE
const activeProjects$ = mesh
  .from(ProjectMeshService.queries.projects.query)
  .where({ organizationId: eq("org-123"), status: eq("active") })
  .listen(b => b.onChange("status").debounce(100))
  .execute();

// Layer 2: node-owned, SSE to relevant nodes
// When activeProjects$ emits → projectId list changes → whereFrom recomputes
// → CONSUMER_DETACH old subscription, CONSUMER_ATTACH new one
const orgDeployments$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen(b => b.onChange("status", "replicaCount").debounce(50))
  .whereFrom(
    activeProjects$,
    // result: MeshQueryResult<Project> — fully typed
    result => ({
      projectId: inList(result.items.map(i => i.data.projectId)),
    }),
  )
  .execute();

orgDeployments$.subscribe(result => {
  for (const { data: d, meta: m } of result.items) {
    console.log(d.deploymentId, m.eventType, m.changedFields, m.nodeId);
  }
});

// Three-level reactive chain: org → projects → deployments
const org$ = mesh
  .from(OrganizationMeshService.queries.organizations.read)
  .listen()
  .execute({ organizationId: "org-123" });

const projects$ = mesh
  .from(ProjectMeshService.queries.projects.query)
  .where({ status: eq("active") })
  .listen()
  .whereFrom(org$, r => ({
    organizationId: inList(r.item ? [r.item.data.organizationId] : []),
  }))
  .execute();

const deployments$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen(b => b.onChange("status"))
  .whereFrom(projects$, r => ({
    projectId: inList(r.items.map(i => i.data.projectId)),
  }))
  .execute();
```

### 8.1 `whereFrom` semantics

| Condition | Behaviour |
|---|---|
| Source emits, where clause unchanged | No reconnect — `distinctUntilChanged` suppresses |
| Source emits, where clause changed | `CONSUMER_DETACH` old, `CONSUMER_ATTACH` new |
| Source completes | Derived stream completes |
| Source errors | Derived stream errors |
| Derived stream unsubscribed | Source subscription decrements ref count (shared connection) |

---

## 9. Aggregations — `.aggregate()` and `.listen().aggregate()`

One-shot calls return `Promise`. Calling `.listen()` before `.aggregate()` returns `Observable` that re-emits on data changes. **There is no `aggregateLive()` method.** The pattern is always `.listen().aggregate()`.

```typescript
import { eq, inList } from "@mesh/where";
import { count, sum, avg, max, min, groupBy, percentile, distinct } from "@mesh/core";

// A1 — one-shot count
const { total } = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .aggregate({ total: count() });
// total: number

// A2 — multi-metric one-shot
const stats = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .aggregate({
    total:       count(),
    totalCpu:    sum("cpuMillicores"),
    avgReplicas: avg("replicaCount"),
    maxReplicas: max("replicaCount"),
    minReplicas: min("replicaCount"),
  });
// Fully inferred: { total: number; totalCpu: number; avgReplicas: number; maxReplicas: number; minReplicas: number }

// A3 — grouped aggregation
const grouped = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .aggregate({
    byEnvironment:  groupBy("environment", count()),
    byStatus:       groupBy("status", count()),
    statusPerEnv:   groupBy("environment", groupBy("status", count())),
    cpuByNode:      groupBy("nodeId", sum("cpuMillicores")),
    p99CpuMs:       percentile("cpuMillicores", 99),
    distinctImages: distinct("image"),
  });
// grouped.byEnvironment: Record<"prod" | "staging" | "canary", number>
// grouped.statusPerEnv:  Record<string, Record<string, number>>

// A2 reactive — Observable that re-emits when data changes
const stats$: Observable<{ total: number; byStatus: Record<string, number>; avgCpu: number }> =
  mesh
    .from(DeploymentMeshService.queries.deployments.query)
    .where({ environment: eq("prod") })
    .listen(b => b.debounce(500))
    .aggregate({
      total:    count(),
      byStatus: groupBy("status", count()),
      avgCpu:   avg("cpuMillicores"),
    });

stats$.subscribe(s => updateDashboard(s));

// Reactive aggregate + whereFrom
const activeProjects$ = mesh
  .from(ProjectMeshService.queries.projects.query)
  .where({ organizationId: eq("org-123"), status: eq("active") })
  .listen()
  .execute();

const orgStats$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen(b => b.debounce(300))
  .whereFrom(activeProjects$, r => ({
    projectId: inList(r.items.map(i => i.data.projectId)),
  }))
  .aggregate({
    total:    count(),
    byStatus: groupBy("status", count()),
  });

orgStats$.subscribe(s => console.log("Org prod stats:", s));
```

---

## 10. Aggregate Plugin System — `AggregateService`

Aggregation functions are registered as versioned plugins. The `AggregateService` handles version negotiation — if the server doesn't support a plugin or has an incompatible version, it throws a typed error (see §28).

```typescript
// @mesh/core — aggregate.types.ts

export interface MeshAggregator<TItem, TPartial, TResult> {
  readonly name:        string;
  readonly version:     string;        // semver — used for version negotiation
  readonly description: string;
  /** Runs per-node on filtered items. Result is serialised and sent to the caller. */
  partial(items: TItem[]): TPartial;
  /** Runs on the caller to merge all node partials into the final result. */
  merge(partials: TPartial[]): TResult;
}

// Convenience alias when partial and result types are the same.
export type SimpleAggregator<TItem, TResult> = MeshAggregator<TItem, TResult, TResult>;

export interface AggregatePluginManifest {
  name:        string;
  version:     string;
  description: string;
  aggregators: Record<string, MeshAggregator<unknown, unknown, unknown>>;
}
```

```typescript
// @mesh/core — AggregateService

@Injectable()
export class AggregateService {
  /**
   * Built-in aggregators.
   * Field names are typed as `keyof TItem & string` when called with a generic helper.
   * The standalone exports from "@mesh/core" (count, sum, avg, …) are wrappers
   * around these utils and should be preferred in most cases.
   */
  readonly utils: {
    count():                                                        MeshAggregator<unknown, number, number>;
    sum<TItem>(field: keyof TItem & string):                       MeshAggregator<TItem, number, number>;
    avg<TItem>(field: keyof TItem & string):                       MeshAggregator<TItem, { sum: number; count: number }, number>;
    min<TItem>(field: keyof TItem & string):                       MeshAggregator<TItem, number, number>;
    max<TItem>(field: keyof TItem & string):                       MeshAggregator<TItem, number, number>;
    distinct<TItem>(field: keyof TItem & string):                  MeshAggregator<TItem, string[], string[]>;
    collect<TItem, V>(field: keyof TItem & string):                MeshAggregator<TItem, V[], V[]>;
    groupBy<TItem, TInner>(
      field: keyof TItem & string,
      inner: MeshAggregator<TItem, unknown, TInner>,
    ):                                                              MeshAggregator<TItem, Record<string, unknown>, Record<string, TInner>>;
    histogram<TItem>(
      field: keyof TItem & string,
      buckets: readonly number[],
    ):                                                              MeshAggregator<TItem, HistogramBucket[], HistogramBucket[]>;
    percentile<TItem>(field: keyof TItem & string, p: number):     MeshAggregator<TItem, number[], number>;
    first<TItem, V>(field: keyof TItem & string):                  MeshAggregator<TItem, V | undefined, V | undefined>;
    last<TItem, V>(field: keyof TItem & string):                   MeshAggregator<TItem, V | undefined, V | undefined>;
    variance<TItem>(field: keyof TItem & string):                  MeshAggregator<TItem, { sum: number; sumSq: number; count: number }, number>;
    stddev<TItem>(field: keyof TItem & string):                    MeshAggregator<TItem, { sum: number; sumSq: number; count: number }, number>;
    rate<TItem>(field: keyof TItem & string, windowMs: number):    MeshAggregator<TItem, { value: number; ts: number }[], number>;
  };

  /**
   * Resolve a named aggregator from a registered plugin.
   * Throws MeshAggregatorNotFoundError or MeshAggregatorVersionMismatchError (see §28).
   */
  resolve<TResult = unknown>(pluginName: string, aggregatorName: string): MeshAggregator<unknown, unknown, TResult>;

  /** True if the connected cluster supports the named aggregator at a compatible version. */
  supports(pluginName: string, aggregatorName: string): boolean;

  /** Emits whenever the set of supported aggregators changes (e.g. on cluster upgrade). */
  readonly supported$: Observable<SupportedAggregators>;

  /** Register a client-only aggregator (no server partial phase). */
  registerLocal(manifest: AggregatePluginManifest): void;
}

export interface HistogramBucket {
  from:  number;
  to:    number;
  count: number;
}
```

### 10.1 Custom plugin definition

```typescript
// deployment-aggregate-plugin.ts

import { defineAggregatePlugin } from "@mesh/core";
import type { Deployment } from "./schemas";

type CostPartial  = number;
type HealthPartial = { total: number; running: number };

export const deploymentAggregatePlugin = defineAggregatePlugin({
  name:        "deployment-analytics",
  version:     "1.2.0",
  description: "Custom aggregations for deployment health and cost",

  aggregators: {
    estimatedCost: {
      name:        "estimatedCost",
      version:     "1.0.0",
      description: "Estimate monthly cloud cost from CPU + memory usage",
      partial(items: Deployment[]): CostPartial {
        return items.reduce((sum, i) => {
          const cpu = (i.cpuMillicores / 1_000) * 0.048;   // $0.048/core/hr
          const mem = (i.memoryMb / 1_024) * 0.006;        // $0.006/GB/hr
          return sum + (cpu + mem) * 720;                   // × 720 hr/month
        }, 0);
      },
      merge(partials: CostPartial[]): number {
        return partials.reduce((s, p) => s + p, 0);
      },
    },

    healthScore: {
      name:        "healthScore",
      version:     "1.0.0",
      description: "Ratio of running replicas to total replicas — 0–100",
      partial(items: Deployment[]): HealthPartial {
        return {
          total:   items.reduce((s, i) => s + i.replicaCount, 0),
          running: items.filter(i => i.status === "running")
                       .reduce((s, i) => s + i.replicaCount, 0),
        };
      },
      merge(partials: HealthPartial[]): number {
        const { total, running } = partials.reduce(
          (acc, p) => ({ total: acc.total + p.total, running: acc.running + p.running }),
          { total: 0, running: 0 },
        );
        return total === 0 ? 100 : Math.round((running / total) * 100);
      },
    },
  },
});
```

### 10.2 Module registration

```typescript
// app.module.ts

MeshModule.forRoot({
  aggregatePlugins: [deploymentAggregatePlugin],
  middleware:       [...],
});
```

### 10.3 Consuming via `AggregateService`

```typescript
@Injectable()
export class DeploymentDashboardService {
  constructor(
    private readonly mesh:   MeshContext,
    private readonly aggSvc: AggregateService,
  ) {}

  async getDashboardStats() {
    const { count, avg, groupBy } = this.aggSvc.utils;
    const estimatedCost = this.aggSvc.resolve<number>("deployment-analytics", "estimatedCost");
    const healthScore   = this.aggSvc.resolve<number>("deployment-analytics", "healthScore");

    return this.mesh
      .from(DeploymentMeshService.queries.deployments.query)
      .where({ environment: eq("prod") })
      .aggregate({
        total:    count(),
        byStatus: groupBy<Deployment, number>("status", count()),
        avgCpu:   avg<Deployment>("cpuMillicores"),
        cost:     estimatedCost,
        health:   healthScore,
      });
    // { total: number; byStatus: Record<string,number>; avgCpu: number; cost: number; health: number }
  }

  getLiveStats(): Observable<{ total: number; health: number; cost: number }> {
    const { count } = this.aggSvc.utils;
    const health = this.aggSvc.resolve<number>("deployment-analytics", "healthScore");
    const cost   = this.aggSvc.resolve<number>("deployment-analytics", "estimatedCost");

    return this.mesh
      .from(DeploymentMeshService.queries.deployments.query)
      .where({ environment: eq("prod") })
      .listen(b => b.debounce(500))
      .aggregate({ total: count(), health, cost });
  }

  hasAnalyticsPlugin(): boolean {
    return this.aggSvc.supports("deployment-analytics", "estimatedCost");
  }
}
```

### 10.4 Version mismatch handling

```typescript
import {
  MeshAggregatorNotFoundError,
  MeshAggregatorVersionMismatchError,
} from "@mesh/core";

try {
  const cost = this.aggSvc.resolve("deployment-analytics", "estimatedCost");
} catch (err) {
  if (err instanceof MeshAggregatorNotFoundError) {
    // Plugin not registered on the server at all
    fallbackCostEstimation();
  } else if (err instanceof MeshAggregatorVersionMismatchError) {
    // e.g. server has v0.9.0, plugin declares v1.0.0
    showUpgradePrompt(err.serverVersion, err.requiredVersion);
  }
}
```

---

## 11. Server-Side Joins

Joins are evaluated server-side as part of the query request. Client-side composition of independent streams uses RxJS directly — see §26 for examples.

```typescript
import { eq } from "@mesh/where";

// J1 — explicit join predicate
const activeProjects = mesh
  .from(ProjectMeshService.queries.projects.query)
  .where({ status: eq("active") });

const result = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .join(
    activeProjects,
    j => j
      .as("project")
      .on((d, p) => d.projectId === p.projectId)
      .type("left"),    // "left" (default) | "inner"
  )
  .execute();
// result.items[0].data.project:       Project | null  (null because left join)
// result.items[0].data.project?.name: string          ✓

// J2 — auto-join via declared relation (no predicate needed)
const withRelations = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .include("project")   // declared as belongs-to in deploymentResource.relations ✓
  .include("metrics")   // declared as has-many ✓
  .execute();
// withRelations.items[0].data.project:  Project | null
// withRelations.items[0].data.metrics:  DeploymentMetric[]

// C3 — nested joins (three levels, server-side)
const projectsWithOrg = mesh
  .from(ProjectMeshService.queries.projects.query)
  .join(
    mesh.from(OrganizationMeshService.queries.organizations.query),
    j => j.as("organization").on((p, o) => p.organizationId === o.organizationId),
  );

const deepResult = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .join(projectsWithOrg, j => j.as("project").on((d, p) => d.projectId === p.projectId))
  .execute();
// deepResult.items[0].data.project?.organization?.name  ✓  fully inferred

// J1 live — joins compose with live mode
const liveWithProject$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .join(
    mesh.from(ProjectMeshService.queries.projects.query).where({ status: eq("active") }),
    j => j.as("project").on((d, p) => d.projectId === p.projectId),
  )
  .listen(b => b.onChange("status"))
  .execute();
```

### 11.1 `JoinConfigurator` API

```typescript
// @mesh/core — join.types.ts

export interface JoinConfigurator<TLeft, TRight> {
  /** Alias for the right side in the result type (required). */
  as<TAlias extends string>(alias: TAlias): this & { _alias: TAlias };

  /** Join predicate — evaluated server-side. */
  on(predicate: (left: TLeft, right: TRight) => boolean): this;

  /** "left" keeps all left-side records; "inner" drops unmatched. Default: "left". */
  type(joinType: "left" | "inner"): this;
}
```

---

## 12. Mutations

All mutations go through `mesh.from(descriptor.mutation).execute(input)`. The descriptor encodes the input and output types — the compiler rejects invalid inputs and narrows the output.

```typescript
import { eq } from "@mesh/where";

// M1 — Create (global resource → coordinator)
const project = await mesh
  .from(ProjectMeshService.mutations.projects.create)
  .execute({
    organizationId: "org-123",
    name:           "Payments API",
    status:         "active",
    ownerId:        "user-456",
  });
// project: MeshMutationResult<Project>
// project.data: Project
// project.meta.nodeId → "coordinator"

// M1 — Create (node-owned → ownerField designates the owning node)
const deployment = await mesh
  .from(DeploymentMeshService.mutations.deployments.create)
  .execute({
    projectId:     "proj-abc",
    serviceId:     "svc-api",
    nodeId:        "node-B",        // determines the owning node
    environment:   "prod",
    status:        "pending",
    replicaCount:  2,
    image:         "my-api:v3.0.0",
    cpuMillicores: 500,
    memoryMb:      256,
  });
// deployment.meta.nodeId → "node-B"

// M2 — Update (coordinator lookup → owner node → apply)
const updated = await mesh
  .from(DeploymentMeshService.mutations.deployments.update)
  .execute({ deploymentId: "dep-abc-123", status: "stopped", replicaCount: 0 });
// updated.data: Deployment (full record after update)

// M3 — Delete
const deleted = await mesh
  .from(DeploymentMeshService.mutations.deployments.delete)
  .execute({ deploymentId: "dep-abc-123" });
// deleted.data.deleted: boolean

// M4 — Domain action: restart
const restarted = await mesh
  .from(DeploymentMeshService.mutations.deployments.restart)
  .execute({ deploymentId: "dep-abc-123", graceful: true });
// restarted.data.jobId:             string (uuid)
// restarted.data.restarting:        boolean
// restarted.data.estimatedSeconds:  number
// restarted.meta.nodeId:            "node-B" (executed on owner node)

// M4 — Domain action: scale
const scaled = await mesh
  .from(DeploymentMeshService.mutations.deployments.scale)
  .execute({ deploymentId: "dep-abc-123", replicas: 5 });
// scaled.data.replicaCount: 5
// scaled.data.scaledAt:     string (datetime)
```

### 12.1 `MeshMutationResult` type

```typescript
// @mesh/core — mutation-result.types.ts

export interface MeshMutationResult<TOutput> {
  /** The server's response payload — typed by the mutation's output schema. */
  data: TOutput;
  meta: {
    /** The node that executed the mutation. */
    nodeId:     string;
    /** Wall-clock duration from request dispatch to response receipt. */
    latencyMs:  number;
    /** The mutation type applied. */
    mutationType: "create" | "update" | "delete" | "action";
    /** True if the mutation result was served from an optimistic cache patch. */
    optimistic:   boolean;
  };
}
```

---

## 13. Optimistic Mutations

Optimistic mutations apply a local patch immediately, then reconcile with the server response. On server error the patch is rolled back.

```typescript
// M5 — optimistic update with rollback
await mesh
  .from(DeploymentMeshService.mutations.deployments.update)
  .optimistic({
    // `current` is the currently cached Deployment — fully typed
    patch: (current: Deployment) => ({ ...current, status: "stopped" as const }),
    onRollback: (original: Deployment, err: unknown) => {
      console.warn("Rolled back to:", original.status, err);
    },
    onCommit: (server: Deployment) => {
      console.log("Server confirmed:", server.status);
    },
  })
  .invalidates(["deployments", "prod"])
  .execute({ deploymentId: "dep-abc-123", status: "stopped", replicaCount: 0 });

// M5 — optimistic scale
await mesh
  .from(DeploymentMeshService.mutations.deployments.scale)
  .optimistic({
    patch: (c: Deployment) => ({ ...c, replicaCount: 5 }),
  })
  .execute({ deploymentId: "dep-abc-123", replicas: 5 });
```

### 13.1 `OptimisticOptions` type

```typescript
// @mesh/core — optimistic.types.ts

export interface OptimisticOptions<TOutput> {
  /**
   * Pure function: receives the current cached entity and returns the patched version.
   * Applied immediately; never mutates the original.
   */
  patch: (current: TOutput) => TOutput;

  /** Called if the server rejects the mutation. Receives the pre-patch state. */
  onRollback?: (original: TOutput, error: unknown) => void;

  /** Called when the server confirms. Receives the authoritative server response. */
  onCommit?: (server: TOutput) => void;
}
```

---

## 14. Distributed Sagas — with Descriptions & Diagnostics

A saga is a sequence of steps with paired compensations. If any step fails, all completed steps are compensated in reverse order. The saga context is a typed key-value store shared across steps.

```typescript
// @mesh/core — saga.types.ts

/** Typed context store — shared across all steps and compensations in a saga. */
export interface SagaContext<TCtx extends Record<string, unknown>> {
  get<K extends keyof TCtx>(key: K): TCtx[K];
  set<K extends keyof TCtx>(key: K, value: TCtx[K]): void;
  /** Return a snapshot of the full context at the current point in execution. */
  snapshot(): Readonly<TCtx>;
}

export interface SagaStepConfig {
  description?: string;
  tags?:        Record<string, string>;
  timeoutMs?:   number;
  /** Retry on transient failure before declaring the step failed. */
  retry?:       { attempts: number; backoffMs: number; jitterMs?: number };
}

export interface SagaConfig {
  name?:        string;
  description?: string;
  tags?:        Record<string, string>;
  timeoutMs?:   number;
  diagnostics?: MeshDiagnosticContext;
}

export interface SagaBuilder<TCtx extends Record<string, unknown>> {
  step(
    id:      string,
    config:  SagaStepConfig,
    handler: (ctx: SagaContext<TCtx>) => Promise<void>,
  ): SagaBuilder<TCtx>;

  compensate(
    stepId:  string,
    config:  Pick<SagaStepConfig, "description" | "tags">,
    handler: (ctx: SagaContext<TCtx>) => Promise<void>,
  ): SagaBuilder<TCtx>;

  execute(): Promise<SagaResult<TCtx>>;
}

export interface SagaResult<TCtx extends Record<string, unknown>> {
  success:          boolean;
  completedSteps:   string[];
  failedStep:       string | null;
  compensatedSteps: string[];
  /** The final state of the typed context store. */
  context:          Readonly<TCtx>;
  durationMs:       number;
  /** Full event log — populated when a MeshDiagnosticContext is attached. */
  diagnosticTrace:  MeshDiagnosticTrace | null;
}
```

```typescript
// ── Full saga example ─────────────────────────────────────────────────────────

// TCtx is inferred from the key-value pairs you .set() — declare it explicitly
// for auto-complete and compile-time safety.
interface DeploySagaCtx {
  deploymentId: string;
  jobId:        string;
}

const diagnostics = mesh.diagnostics({ name: "deploy-prod", tags: { env: "prod" } });

const result = await mesh.saga<DeploySagaCtx>({
  name:        "Create and start deployment",
  description: "Persists the deployment record, then issues a restart to bring it live",
  tags:        { environment: "prod", serviceId: "svc-api" },
  diagnostics,
  timeoutMs:   120_000,
})
  .step("create-deployment", {
    description: "Persist the deployment record to the owning node",
    tags:        { phase: "persistence" },
    timeoutMs:   10_000,
  }, async ctx => {
    const r = await mesh
      .from(DeploymentMeshService.mutations.deployments.create)
      .execute({
        projectId: "proj-abc", serviceId: "svc-api", nodeId: "node-B",
        environment: "prod", status: "pending", replicaCount: 2,
        image: "api:v3", cpuMillicores: 500, memoryMb: 256,
      });
    ctx.set("deploymentId", r.data.deploymentId);
  })
  .compensate("create-deployment", {
    description: "Roll back: delete the deployment record",
  }, async ctx => {
    await mesh
      .from(DeploymentMeshService.mutations.deployments.delete)
      .execute({ deploymentId: ctx.get("deploymentId") });
  })

  .step("start-deployment", {
    description: "Issue restart to transition from pending to running",
    tags:        { phase: "startup" },
    retry:       { attempts: 3, backoffMs: 2_000, jitterMs: 200 },
  }, async ctx => {
    const r = await mesh
      .from(DeploymentMeshService.mutations.deployments.restart)
      .execute({ deploymentId: ctx.get("deploymentId"), graceful: false });
    ctx.set("jobId", r.data.jobId);
  })
  // No compensation for start — restart is idempotent

  .execute();

if (result.success) {
  console.log("Deployed:", result.context.deploymentId, "job:", result.context.jobId);
} else {
  console.error(`Failed at "${result.failedStep}" after ${result.durationMs}ms`);
  console.error("Compensated:", result.compensatedSteps);
}
```

---

## 15. Streaming Iterator — `.stream()`

`.stream()` returns an `AsyncIterable`. Items arrive as soon as any node responds — there is no wait for all nodes to finish. Exiting the loop early with `break` cancels all in-flight requests.

```typescript
import { eq, variable } from "@mesh/where";

// ST1 — process items as they arrive (node-streamed)
for await (const { data: dep, meta } of mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ status: eq("pending") })
  .stream()
) {
  // meta.nodeId: string — which node this item came from
  console.log(`[${meta.nodeId}] ${dep.deploymentId}`);
  await processPendingDeployment(dep);
}

// Early exit cancels open SSE connections
for await (const { data } of mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .stream()
) {
  if (shouldStop(data)) break;  // connections cleaned up immediately
  handle(data);
}

// Streaming with variables
for await (const { data } of mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: variable<"prod" | "staging">("env", { type: "string" }) })
  .stream({ vars: { env: "prod" } })
) {
  handle(data);
}
```

### 15.1 `StreamOptions` type

```typescript
// @mesh/core — stream.types.ts

export interface StreamOptions<TItem> {
  /** Variable bindings for any variable() expressions in the where clause. */
  vars?:          Record<string, Scalar>;
  /**
   * Abort signal — cancels the stream and closes connections when fired.
   * Useful when wrapping in a React useEffect or similar lifecycle.
   */
  signal?:        AbortSignal;
  /** Maximum items to yield before the iterator completes. */
  limit?:         number;
}
```

---

## 16. Typed Event Subscriptions — `.on()`

`.on()` subscribes to resource events. Lifecycle events (`created`, `updated`, `deleted`, `any`) are built-in. Custom domain events are defined on the resource schema and autocompleted.

```typescript
import { eq } from "@mesh/where";

// E1 — lifecycle event: updated
mesh
  .on(DeploymentMeshService.resources.deployments)
  .event("updated")
  .where({ environment: eq("prod") })  // server-side filtered ✓
  .asObservable()
  .subscribe(event => {
    // event.item:           Deployment   (current state)
    // event.previous:       Deployment | null
    // event.type:           "updated"
    // event.timestamp:      Date
    // event.sourceNodeId:   string
    if (event.previous && event.item.status !== event.previous.status) {
      console.log(`${event.previous.status} → ${event.item.status}`);
    }
  });

// E1 — "any" — all lifecycle types
mesh
  .on(DeploymentMeshService.resources.deployments)
  .event("any")
  .where({ nodeId: eq("node-A") })
  .asObservable()
  .pipe(filter(e => e.type !== "deleted"))
  .subscribe(e => console.log(e.type, e.item.deploymentId));

// E2 — custom domain event (payload typed from resource.events schema)
mesh
  .on(DeploymentMeshService.resources.deployments)
  .event("restarted")   // autocomplete: "restarted" | "scaled" ✓
  .asObservable()
  .subscribe(event => {
    // event.item:    Deployment
    // event.payload: { jobId: string; graceful: boolean }  ← inferred from Zod schema
    console.log(`Restarted ${event.item.deploymentId}, job: ${event.payload.jobId}`);
  });

mesh
  .on(ProjectMeshService.resources.projects)
  .event("archived")
  .asObservable()
  .subscribe(event => {
    // event.payload: { archivedBy: string; reason?: string }
    console.log(`Project archived by ${event.payload.archivedBy}`);
  });

// E3 — event replay (see also §25.8)
mesh
  .on(DeploymentMeshService.resources.deployments)
  .event("restarted")
  .replay({
    from:  new Date("2024-01-01T00:00:00Z"),
    to:    new Date("2024-01-02T00:00:00Z"),
    limit: 1_000,
  })
  .asObservable()
  .subscribe(event => {
    console.log(`[REPLAY] ${event.timestamp.toISOString()} job=${event.payload.jobId}`);
  });
```

### 16.1 `MeshEventBuilder` API

```typescript
// @mesh/core — event.types.ts

export interface MeshEventBuilder<TItem, TEvents extends Record<string, z.ZodTypeAny>> {
  /**
   * Select the event type to subscribe to.
   * "created" | "updated" | "deleted" | "any" are always available.
   * Keys of the resource's `events` map are also available.
   */
  event<TType extends "created" | "updated" | "deleted" | "any" | keyof TEvents>(
    type: TType,
  ): MeshEventFilter<TItem, TType extends keyof TEvents ? z.infer<TEvents[TType]> : undefined>;
}

export interface MeshEventFilter<TItem, TPayload> {
  /** Server-side event filter. Applied before events are sent to subscribers. */
  where(expr: WhereInput<TItem>): this;

  /** Replay historical events from the server's event log. */
  replay(opts: { from: Date; to: Date; limit?: number }): this;

  /** Returns a cold Observable. Subscribe to receive events. */
  asObservable(): Observable<MeshEvent<TItem, TPayload>>;
}

export interface MeshEvent<TItem, TPayload> {
  type:         "created" | "updated" | "deleted" | string;
  item:         TItem;
  previous:     TItem | null;        // set on "updated" and "deleted"
  payload:      TPayload;            // defined for custom domain events; undefined for lifecycle events
  timestamp:    Date;
  sourceNodeId: string;
}
```

---

## 17. Query Plan Introspection — `.explain()`

`.explain()` returns the routing plan the mesh would use without executing the query. Use it for performance analysis, debugging, and pre-flight checks.

```typescript
import { eq } from "@mesh/where";
import { count, groupBy } from "@mesh/core";

// Multi-item plan
const plan = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .include("project")
  .explain();
/*
MeshNodeOwnedQueryPlan {
  resourceKey:      "deployments",
  ownership:        "node-owned",
  ownerField:       "nodeId",
  routingStrategy:  "broadcast",
  targetNodes:      "all",
  filterDescriptor: { environment: { _eq: "prod" } },
  joins: [{ type: "include", relation: "project", entityKey: "projects", joinType: "left" }],
  connectionReuse: {
    perNode: [
      { nodeId: "node-A", wouldReuse: true,  existingConsumers: 3 },
      { nodeId: "node-B", wouldReuse: false, existingConsumers: 0 },
    ]
  },
  estimatedResultCount: 42,
  warnings: [{ code: "CROSS_SERVICE_JOIN", severity: "info", message: "join spans two namespaces" }]
}
*/

// Single-item read plan
const readPlan = await mesh
  .from(DeploymentMeshService.queries.deployments.read)
  .explain({ deploymentId: "dep-abc-123" });
/*
MeshNodeOwnedReadPlan {
  ownership:        "node-owned",
  routingStrategy:  "coordinator-lookup-then-direct",
  coordinatorQuery: { table: "ownership_registry", pk: "dep-abc-123" },
  resolvedNodeId:   "node-B"   // from coordinator cache — may differ at execute time
}
*/

// Aggregation plan
const aggPlan = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .aggregationPlan({ total: count(), byStatus: groupBy<Deployment, number>("status", count()) });
/*
{
  executionPhases: [
    { phase: "partial", targetNodes: "all",    description: "Each node counts locally" },
    { phase: "merge",   location:    "client", description: "Caller merges partial counts" },
  ],
  missingAggregators: []  // populated if a custom aggregator isn't supported server-side
}
*/
```

---

## 18. Connection Diagnostics, Lifecycle & Direct Node Access

All connection APIs are accessed via `mesh.connections` — a property on `MeshContext`. No separate import is needed.

```typescript
// @mesh/core — connections.types.ts

export interface MeshConnections {
  /** Snapshot of all currently open connections and their consumers. */
  inspect(): MeshConnectionSnapshot[];

  /** Observable stream of connection lifecycle events. */
  readonly lifecycle$: Observable<MeshConnectionLifecycleEvent>;

  /** Observable stream of per-node health snapshots. */
  readonly nodeHealth$: Observable<Record<string, NodeHealthStatus>>;

  /**
   * Open a direct connection to a specific node — bypasses broadcast routing.
   * Primarily for diagnostics, maintenance, and partition-aware operations.
   */
  connectToNode(
    nodeId:  string,
    opts:    { entityKey: string; description?: string; tags?: Record<string, string> },
  ): Promise<MeshConnectionHandle<unknown>>;

  /** Force-close all connections to a node (admin/maintenance). */
  closeNodeConnections(nodeId: string, opts?: { reason?: string }): Promise<void>;

  /** Reconnect to a node after maintenance. */
  reconnectNode(nodeId: string): Promise<void>;
}
```

### 18.1 Inspect open connections

```typescript
const open = mesh.connections.inspect();
/*
MeshConnectionSnapshot[] — each entry:
{
  connectionId:  "conn-abc",
  nodeId:        "node-A",
  entityKey:     "deployments",
  methodName:    "query",
  consumerCount: 3,
  openedAt:      Date,
  status:        "open" | "degraded" | "reconnecting",
  consumers: [
    { consumerId: "cid-1", filterDescriptor: { environment: { _eq: "prod" } }, attachedAt: Date },
    { consumerId: "cid-2", filterDescriptor: { environment: { _eq: "prod" }, status: { _eq: "running" } }, attachedAt: Date },
  ]
}
*/
```

### 18.2 Observe lifecycle events

```typescript
export type MeshConnectionLifecycleEvent =
  | { type: "connection_opened";     connectionId: string; nodeId: string; entityKey: string }
  | { type: "consumer_attached";     connectionId: string; consumerId: string; consumerCount: number }
  | { type: "consumer_detached";     connectionId: string; consumerId: string; consumerCount: number }
  | { type: "connection_closed";     connectionId: string; nodeId: string; reason: string }
  | { type: "connection_degraded";   connectionId: string; nodeId: string; reason: string }
  | { type: "connection_reconnected";connectionId: string; nodeId: string; attemptCount: number };

// Usage
mesh.connections.lifecycle$.subscribe(event => {
  switch (event.type) {
    case "connection_opened":
      metrics.increment("mesh.connection.opened", { nodeId: event.nodeId, entity: event.entityKey });
      break;
    case "consumer_attached":
    case "consumer_detached":
      metrics.gauge("mesh.consumers", event.consumerCount);
      break;
    case "connection_closed":
      metrics.increment("mesh.connection.closed", { reason: event.reason });
      break;
    case "connection_degraded":
      alerts.warn(`Connection to ${event.nodeId} degraded: ${event.reason}`);
      break;
    case "connection_reconnected":
      metrics.increment("mesh.connection.reconnected", { attempt: String(event.attemptCount) });
      break;
  }
});
```

### 18.3 Explicit connection handle (D4)

```typescript
const handle = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .connect();
// handle: MeshConnectionHandle<Deployment>

console.log(handle.connectionId);   // stable connection ID
console.log(handle.consumerId);     // this consumer's ID
console.log(handle.isShared);       // true if an existing connection was reused
console.log(handle.consumerCount);  // total consumers currently sharing this connection

handle.refCount$.subscribe(n => console.log(`Consumers on this connection: ${n}`));
handle.status$.subscribe(s  => console.log(`Connection status: ${s}`));

// Raw stream envelope — lower-level than the query result
handle.events$.subscribe((envelope: MeshStreamEnvelope) => {
  // envelope.payload:    unknown
  // envelope.entityKey:  string
  // envelope.eventType:  "created" | "updated" | "deleted"
  // envelope.recipients: string[]  — consumer IDs this event was dispatched to
  console.log(envelope.eventType, envelope.payload);
});

handle.release();  // decrements ref count; connection closes when count reaches 0
```

### 18.4 Direct node connection (CN3)

```typescript
// Bypass broadcast; connect directly to node-A for diagnostics
const nodeConn = await mesh.connections.connectToNode("node-A", {
  entityKey:   "deployments",
  description: "Maintenance inspection of node-A",
  tags:        { purpose: "maintenance" },
});

nodeConn.events$.subscribe(envelope => {
  console.log("[node-A raw]", envelope.entityKey, envelope.eventType);
});

// Force-close all connections to a node, then reconnect
await mesh.connections.closeNodeConnections("node-A", { reason: "scheduled-maintenance" });
await mesh.connections.reconnectNode("node-A");
```

### 18.5 Node health monitoring

```typescript
mesh.connections.nodeHealth$.subscribe(snapshot => {
  for (const [nodeId, health] of Object.entries(snapshot)) {
    // health: NodeHealthStatus
    // health.status:          "healthy" | "degraded" | "unreachable"
    // health.latencyMs:       number
    // health.openConnections: number
    // health.consumerCount:   number
    // health.lastSeenAt:      Date
    if (health.status !== "healthy") {
      alerts.warn(`Node ${nodeId} is ${health.status}`);
    }
  }
});
```

---

## 19. Mesh Discovery — Resource Location

Discovery is accessed via `mesh.discovery` — a property on `MeshContext`. No separate injection needed.

```typescript
// @mesh/core — discovery.types.ts

export interface MeshDiscovery {
  /**
   * Locate the node that owns a specific item by primary key.
   * Queries the coordinator's ownership registry only — does NOT fetch item data.
   */
  locate<TItem, TPK extends keyof TItem & string>(
    resource: ResourceDescriptor<TItem, Record<string, z.ZodTypeAny>>,
    pk:       Pick<TItem, TPK>,
  ): Promise<NodeLocation | null>;

  /**
   * All nodes that hold items of a given resource type.
   * Global resources return ["coordinator"].
   */
  nodesFor(
    resource: ResourceDescriptor<unknown, Record<string, z.ZodTypeAny>>,
  ): Promise<NodeInfo[]>;

  /**
   * Real-time cluster topology.
   * Emits on node join, leave, upgrade, and role change.
   */
  readonly topology$: Observable<ClusterTopologyEvent>;

  /** Synchronous snapshot of the current known topology. */
  getTopology(): ClusterTopology;

  /** Per-node status stream. */
  watchNode(nodeId: string): Observable<NodeStatusEvent>;

  /**
   * Find nodes with a specific plugin/capability at a compatible version.
   * E.g. "which nodes have deployment-analytics ≥ 1.0.0?"
   */
  findNodesWithCapability(query: MeshCapabilityQuery): Promise<NodeInfo[]>;

  /**
   * Stream of ownership changes — emits when items migrate between nodes.
   * Useful for alerting on failovers and rebalances.
   */
  watchOwnership(
    resource: ResourceDescriptor<unknown, Record<string, z.ZodTypeAny>>,
  ): Observable<OwnershipChangeEvent>;

  /**
   * Resolve which nodes a query would target — without executing it.
   * Equivalent to .explain() but focused on routing only.
   */
  resolveQueryTargets<TItem>(
    builder: MultiItemQueryBuilder<TItem, string | never>,
  ): Promise<QueryTargetResolution>;
}

export interface NodeLocation {
  nodeId:       string;
  nodeAddress:  string;
  region?:      string;
  zone?:        string;
  capabilities: string[];
  assignedAt:   Date;
}

export interface NodeInfo extends NodeLocation {
  status:        "healthy" | "degraded" | "unreachable";
  version:       string;
  resourceCount: number;
  lastSeenAt:    Date;
}

export interface ClusterTopology {
  coordinator:    NodeInfo;
  nodes:          NodeInfo[];
  totalResources: number;
  updatedAt:      Date;
}

export interface OwnershipChangeEvent {
  resourceKey: string;
  primaryKey:  string;
  fromNodeId:  string;
  toNodeId:    string;
  reason:      "migration" | "failover" | "rebalance";
  timestamp:   Date;
}

export interface QueryTargetResolution {
  strategy:    "direct" | "broadcast" | "targeted-broadcast";
  targetNodes: string[];
  reason:      string;
}

export type ClusterTopologyEvent =
  | { type: "node_joined";  nodeId: string; info: NodeInfo }
  | { type: "node_left";    nodeId: string; reason: string }
  | { type: "node_upgraded";nodeId: string; fromVersion: string; toVersion: string }
  | { type: "role_changed"; nodeId: string; from: string; to: string };
```

### 19.1 Usage examples

```typescript
@Injectable()
export class DeploymentLocationService {
  constructor(private readonly mesh: MeshContext) {}

  async findDeploymentNode(deploymentId: string): Promise<NodeLocation | null> {
    return this.mesh.discovery.locate(deploymentResource, { deploymentId });
  }

  async getClusterOverview() {
    const [topology, deploymentNodes] = await Promise.all([
      this.mesh.discovery.getTopology(),
      this.mesh.discovery.nodesFor(deploymentResource),
    ]);
    return {
      totalNodes:      topology.nodes.length,
      healthyNodes:    topology.nodes.filter(n => n.status === "healthy").length,
      deploymentNodes: deploymentNodes.map(n => ({ nodeId: n.nodeId, count: n.resourceCount })),
    };
  }

  watchFailovers(): Observable<OwnershipChangeEvent> {
    return this.mesh.discovery.watchOwnership(deploymentResource).pipe(
      filter(e => e.reason === "failover"),
      tap(e => console.log(`Failover: ${e.primaryKey} moved ${e.fromNodeId} → ${e.toNodeId}`)),
    );
  }

  watchTopologyChanges(): Observable<ClusterTopologyEvent> {
    return this.mesh.discovery.topology$.pipe(
      tap(event => {
        if (event.type === "node_left") {
          alerts.critical(`Node ${event.nodeId} left the cluster: ${event.reason}`);
        }
      }),
    );
  }

  async findAnalyticsCapableNodes(): Promise<NodeInfo[]> {
    return this.mesh.discovery.findNodesWithCapability({
      plugin:     "deployment-analytics",
      minVersion: "1.0.0",
    });
  }

  async preflightCheck(): Promise<void> {
    const res = await this.mesh.discovery.resolveQueryTargets(
      this.mesh
        .from(DeploymentMeshService.queries.deployments.query)
        .where({ environment: eq("prod") }),
    );
    console.log(`Will target ${res.targetNodes.length} nodes via "${res.strategy}"`);
  }
}
```

---

## 20. Pagination — Offset & Cursor

```typescript
import { eq } from "@mesh/where";

// ── Offset pagination helper ──────────────────────────────────────────────────

async function* paginateOffset<TItem>(
  builder:  MultiItemQueryBuilder<TItem, string | never>,
  pageSize: number = 25,
): AsyncGenerator<{ items: TItem[]; page: number; total: number }> {
  let offset = 0;
  let page   = 0;
  while (true) {
    const result = await builder.limit(pageSize).offset(offset).execute();
    if (result.items.length === 0) break;
    yield { items: result.items.map(i => i.data), page: ++page, total: result.meta.totalItems };
    if (!result.meta.hasMore) break;
    offset += pageSize;
  }
}

for await (const { items, page, total } of paginateOffset(
  mesh.from(DeploymentMeshService.queries.deployments.query).where({ environment: eq("prod") }),
  50,
)) {
  console.log(`Page ${page} / ${Math.ceil(total / 50)}: ${items.length} items`);
}

// ── Cursor pagination helper — stable across live mutations ───────────────────

async function* paginateCursor<TItem>(
  builder:  MultiItemQueryBuilder<TItem, string | never>,
  pageSize: number = 25,
): AsyncGenerator<{ items: TItem[]; cursor: string | null; done: boolean }> {
  let cursor: string | null = null;
  do {
    const result = await builder.limit(pageSize).cursor(cursor).execute();
    cursor = result.meta.nextCursor ?? null;
    yield { items: result.items.map(i => i.data), cursor, done: cursor === null };
  } while (cursor !== null);
}

for await (const { items, cursor, done } of paginateCursor(
  mesh.from(DeploymentMeshService.queries.deployments.query).sortBy("createdAt", "desc"),
  25,
)) {
  processPage(items);
  if (done) console.log("All pages consumed");
}
```

---

## 21. Projections — `.select()`

`.select()` narrows `TItem` at compile time. Accessing an unselected field is a compile error. Projections propagate through joins.

```typescript
import { eq } from "@mesh/where";

// Narrow TItem to Pick<Deployment, "deploymentId" | "status" | "replicaCount" | "nodeId">
const slim = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .select("deploymentId", "status", "replicaCount", "nodeId")
  .execute();

slim.items[0].data.deploymentId   // ✓ string
slim.items[0].data.replicaCount   // ✓ number
// slim.items[0].data.image        ✗ compile error — field not selected

// Projection on the join side
const result = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .join(
    mesh.from(ProjectMeshService.queries.projects.query).select("projectId", "name"),
    j => j.as("project").on((d, p) => d.projectId === p.projectId),
  )
  .select("deploymentId", "status")
  .execute();

result.items[0].data.project?.name     // ✓
// result.items[0].data.project?.ownerId  ✗ compile error — not selected on join side

// Projection with live stream — TItem narrowing works identically
const slim$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .select("deploymentId", "status", "nodeId")
  .listen(b => b.onChange("status"))
  .execute();

slim$.subscribe(result => {
  for (const { data } of result.items) {
    console.log(data.deploymentId, data.status);  // ✓
    // data.image  ✗ compile error
  }
});
```

---

## 22. Caching Layer

```typescript
import { eq } from "@mesh/where";
import { meshCache } from "@mesh/core";

// Cache a query result for 5 seconds; serve stale while revalidating
const cached = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .cache({
    ttlMs:               5_000,
    tags:                ["deployments", "prod"],
    staleWhileRevalidate: true,
  })
  .execute();
// cached.items[0].meta.cached: boolean — true if this item was served from cache

// Automatic cache invalidation on mutation (M6)
await mesh
  .from(DeploymentMeshService.mutations.deployments.update)
  .invalidates(["deployments", "prod"])
  .execute({ deploymentId: "dep-abc", status: "stopped", replicaCount: 0 });

// Manual cache control
meshCache.invalidate(["deployments"]);                              // by tag
meshCache.invalidateQuery({                                         // by entity + filter
  entityKey: "deployments",
  filter:    { environment: { _eq: "prod" } },
});
meshCache.clear();                                                  // flush everything
```

### 22.1 `CacheOptions` type

```typescript
// @mesh/core — cache.types.ts

export interface CacheOptions {
  /** How long to keep the cached result (ms). */
  ttlMs: number;
  /**
   * String tags used for targeted invalidation.
   * Invalidating any matching tag evicts this entry.
   */
  tags?: readonly string[];
  /**
   * When true, a stale cached result is served immediately while a background
   * revalidation request runs. Default: false.
   */
  staleWhileRevalidate?: boolean;
  /**
   * Override the cache key. Defaults to a deterministic hash of
   * the entity key + filter descriptor + selected fields.
   */
  key?: string;
}
```

---

## 23. Query Middleware Pipeline

Middleware runs in declaration order on every query and mutation. Each middleware receives a typed context and calls `next()` to continue the chain.

```typescript
// app.module.ts

MeshModule.forRoot({
  middleware: [
    new MeshTracingMiddleware(tracer, { captureFilterDescriptor: true }),
    new MeshLoggingMiddleware(logger, { logLevel: "debug" }),
    new MeshCircuitBreakerMiddleware({ threshold: 5, resetAfterMs: 30_000 }),
    new MeshCacheMiddleware(redisCacheAdapter),
    new MeshRateLimitMiddleware({ requestsPerSecond: 100 }),
  ],
  aggregatePlugins: [deploymentAggregatePlugin],
});
```

### 23.1 `MeshQueryMiddleware` interface

```typescript
// @mesh/core — middleware.types.ts

export interface MeshMiddlewareContext {
  /** Fully typed — use ObjectWhere<unknown> to read fields safely. */
  filterDescriptor:  Record<string, unknown>;
  /** The entity being queried or mutated. */
  entityKey:         string;
  /** "query" | "mutation" | "aggregate" | "stream" */
  operationType:     string;
  /** The current authenticated request context. */
  requestContext:    MeshRequestContextValue;
  /** Arbitrary bag for passing data between middleware in the same pipeline. */
  state:             Record<string, unknown>;
}

export interface MeshQueryMiddleware {
  readonly name: string;
  execute(ctx: MeshMiddlewareContext, next: () => Promise<void>): Promise<void>;
}
```

### 23.2 Custom middleware example

```typescript
// Tenant isolation — injects org filter if not already present
class TenantIsolationMiddleware implements MeshQueryMiddleware {
  readonly name = "tenant-isolation";

  async execute(ctx: MeshMiddlewareContext, next: () => Promise<void>): Promise<void> {
    const orgId = ctx.requestContext.organizationId;
    if (orgId && !("organizationId" in ctx.filterDescriptor)) {
      ctx.filterDescriptor = {
        _and: [ctx.filterDescriptor, { organizationId: { _eq: orgId } }],
      };
    }
    return next();
  }
}

// Request timing middleware
class TimingMiddleware implements MeshQueryMiddleware {
  readonly name = "timing";

  async execute(ctx: MeshMiddlewareContext, next: () => Promise<void>): Promise<void> {
    const start = performance.now();
    try {
      await next();
    } finally {
      const duration = performance.now() - start;
      ctx.state["durationMs"] = duration;
      metrics.histogram("mesh.query.duration", duration, { entity: ctx.entityKey });
    }
  }
}
```

---

## 24. Diagnostic Tracing — Named Steps & Event Descriptions

```typescript
// @mesh/core — diagnostics.types.ts

export interface MeshDiagnosticContext {
  readonly name:         string;
  readonly description?: string;
  readonly tags:         Record<string, string>;
  readonly traceId?:     string;   // links into an existing distributed trace
  readonly events$:      Observable<MeshDiagnosticEvent & { timestamp: Date }>;
}

export type MeshDiagnosticEvent =
  | { type: "query_start";        name: string; entityKey: string; filter: unknown }
  | { type: "query_end";          name: string; entityKey: string; itemCount: number; durationMs: number }
  | { type: "query_error";        name: string; entityKey: string; error: unknown }
  | { type: "mutation_start";     name: string; entityKey: string; mutationType: string }
  | { type: "mutation_end";       name: string; entityKey: string; durationMs: number }
  | { type: "mutation_error";     name: string; entityKey: string; error: unknown }
  | { type: "saga_step_start";    sagaName: string; stepId: string; description?: string }
  | { type: "saga_step_end";      sagaName: string; stepId: string; durationMs: number }
  | { type: "saga_step_failed";   sagaName: string; stepId: string; error: unknown }
  | { type: "saga_compensate";    sagaName: string; stepId: string; description?: string }
  | { type: "connection_open";    nodeId: string; entityKey: string }
  | { type: "connection_close";   nodeId: string; entityKey: string; reason: string }
  | { type: "consumer_attach";    connectionId: string; consumerId: string }
  | { type: "consumer_detach";    connectionId: string; consumerId: string };

export interface MeshDiagnosticTrace {
  name:       string;
  startedAt:  Date;
  endedAt:    Date;
  durationMs: number;
  events:     Array<MeshDiagnosticEvent & { timestamp: Date }>;
  tags:       Record<string, string>;
}
```

```typescript
// ── Usage ─────────────────────────────────────────────────────────────────────

const diag = mesh.diagnostics({
  name:        "org-dashboard-load",
  description: "Initial data load for the organisation dashboard",
  tags:        { userId: "user-123", orgId: "org-abc", page: "dashboard" },
});

const projects = await mesh
  .from(ProjectMeshService.queries.projects.query)
  .where({ organizationId: eq("org-abc") })
  .withDiagnostics(diag)
  .execute();

const live$ = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .withDiagnostics(diag)
  .listen()
  .execute();

// Forward all events to your telemetry pipeline
diag.events$.subscribe(event => telemetry.record(event));

// Saga — diagnosticTrace is included in the result
const sagaResult = await mesh.saga({ name: "provision-service", diagnostics: diag })
  .step("create-deployment", { description: "Persist new deployment" }, async ctx => { /* ... */ })
  .execute();

// Full event log with timestamps — every step duration, any errors
console.log(sagaResult.diagnosticTrace?.events);
```

---

## 25. Additional Concepts & APIs

### 25.1 Request Batching

Multiple one-shot queries dispatched within the same microtask are automatically coalesced into a single network round trip.

```typescript
import { eq, gte } from "@mesh/where";

const [projects, metrics, deployments] = await mesh.batch([
  mesh.from(ProjectMeshService.queries.projects.query)
    .where({ organizationId: eq("org-123") }),
  mesh.from(DeploymentMeshService.queries.metrics.query)
    .where({ recordedAt: gte("2024-01-01T00:00:00Z") }),
  mesh.from(DeploymentMeshService.queries.deployments.query)
    .where({ environment: eq("prod") }),
] as const);
// projects:    MeshQueryResult<Project>
// metrics:     MeshQueryResult<DeploymentMetric>
// deployments: MeshQueryResult<Deployment>
// All three fetched in one round trip — types are preserved by tuple inference
```

### 25.2 Health Probes

```typescript
import { meshHealth } from "@mesh/core";

// Readiness — are all coordinator and known nodes reachable?
const ready = await meshHealth.checkReadiness();
// { ready: boolean; nodes: Record<string, "ok" | "degraded" | "unreachable"> }

// Liveness — is the mesh client itself functioning?
const alive = await meshHealth.checkLiveness();
// { alive: boolean; openConnections: number; pendingRequests: number }

// Observable cluster health — useful for k8s health endpoints
meshHealth.health$.subscribe(snapshot => {
  const degraded = Object.entries(snapshot.nodes).filter(([, s]) => s !== "ok");
  if (degraded.length > 0) alerts.warn("Degraded nodes:", degraded.map(([id]) => id));
});
```

### 25.3 Schema Registry Access

```typescript
import { meshSchemaRegistry } from "@mesh/core";

// Get the Zod schema for any resource key — useful for dynamic form generation
const schema = meshSchemaRegistry.getSchema("deployments");
// Returns z.ZodObject<...> — the exact schema defined in resources.ts

// List all registered resources across the cluster
const resources = meshSchemaRegistry.listResources();
// [{ key: "deployments", namespace: "deployment", ownership: "node-owned", primaryKey: "deploymentId" }]

// Watch schema changes (e.g. when a new service version deploys)
meshSchemaRegistry.changes$.subscribe(change => {
  console.log(`Schema "${change.resourceKey}" changed — new version: ${change.version}`);
});
```

### 25.4 Request Context Propagation

```typescript
import { MeshRequestContext } from "@mesh/core";

// Attach context to the current async scope (e.g. in an HTTP middleware)
MeshRequestContext.run({
  userId:         "user-123",
  organizationId: "org-abc",
  requestId:      req.headers["x-request-id"] as string,
  roles:          ["admin"] as const,
}, async () => {
  // All mesh calls within this async scope inherit the context.
  // ctx("ctx.userId") resolves to "user-123" in any where clause.
  const deps = await mesh
    .from(DeploymentMeshService.queries.deployments.query)
    .where({ ownerId: ctx("ctx.userId") })
    .execute();
});
```

### 25.5 Subscription Lease Management

Leases prevent orphaned connections in serverless or short-lived environments.

```typescript
import { meshLeaseManager, type MeshLease } from "@mesh/core";

const lease: MeshLease = meshLeaseManager.createLease({
  ttlMs:        60_000,   // 60 s lease
  renewOnEvent: true,     // auto-renew on every received event
  onExpire:     () => console.log("Lease expired — subscription released"),
});

const sub = mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ environment: eq("prod") })
  .listen()
  .withLease(lease)
  .execute()
  .subscribe(handleResult);

lease.renew();    // extend TTL manually
lease.release();  // tear down immediately
```

### 25.6 Conflict Resolution Hooks

Declared on the resource; called on the owning node when a concurrent-write conflict is detected.

```typescript
export const deploymentResource = defineResource({
  // ... schema, primaryKey, ownership
  conflictResolution: {
    strategy: "custom",
    resolve(current: Deployment, incoming: Deployment, meta: ConflictMeta): Deployment {
      // meta.currentVersion: number
      // meta.incomingVersion: number
      // meta.conflictedFields: (keyof Deployment)[]
      // Last-write-wins for most fields; preserve the higher replicaCount
      return {
        ...incoming,
        replicaCount: Math.max(current.replicaCount, incoming.replicaCount),
      };
    },
  },
});

export interface ConflictMeta {
  currentVersion:   number;
  incomingVersion:  number;
  conflictedFields: string[];
  occurredAt:       Date;
}
```

### 25.7 Mesh Circuit Breaker (per-resource)

```typescript
import { meshCircuitBreaker } from "@mesh/core";

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerStateEvent {
  entityKey:  string;
  nodeId:     string;
  state:      CircuitState;
  reason?:    string;
  openedAt?:  Date;
}

meshCircuitBreaker.state$.subscribe((event: CircuitBreakerStateEvent) => {
  if (event.state === "open") {
    console.log(`Circuit open for ${event.entityKey} on ${event.nodeId}: ${event.reason}`);
  }
});

// Admin override — open for planned maintenance
await meshCircuitBreaker.open("deployments", "node-A", { reason: "planned-maintenance" });
await meshCircuitBreaker.close("deployments", "node-A");
```

### 25.8 Mesh Event Replay

```typescript
const replay$ = mesh
  .on(DeploymentMeshService.resources.deployments)
  .event("restarted")
  .replay({
    from:  new Date("2024-01-01T00:00:00Z"),
    to:    new Date("2024-01-02T00:00:00Z"),
    limit: 1_000,
  })
  .asObservable();

replay$.subscribe(event => {
  // event.type:    "restarted"
  // event.payload: { jobId: string; graceful: boolean }
  console.log(`[REPLAY] ${event.timestamp.toISOString()} ${event.item.deploymentId} job=${event.payload.jobId}`);
});
```

### 25.9 Mesh Presence (Who Is Watching What)

```typescript
import { meshPresence } from "@mesh/core";

export interface PresenceWatcher {
  consumerId: string;
  userId?:    string;
  attachedAt: Date;
  nodeId:     string;
}

export interface PresenceChangeEvent {
  type:       "joined" | "left";
  consumerId: string;
  userId?:    string;
}

const watchers: PresenceWatcher[] = await meshPresence.getWatchers({
  entityKey: "deployments",
  filter:    { environment: { _eq: "prod" } },
});

meshPresence.watch({ entityKey: "deployments" }).subscribe((event: PresenceChangeEvent) => {
  console.log(`Consumer ${event.consumerId} ${event.type}`);
});
```

---

## 26. Combined Patterns — Real-World Scenarios

### Scenario 1: Fully reactive organisation dashboard

```typescript
import { combineLatest } from "rxjs";
import { eq, inList } from "@mesh/where";

@Injectable()
export class OrgDashboardService {
  constructor(
    private readonly mesh:   MeshContext,
    private readonly aggSvc: AggregateService,
  ) {}

  buildDashboard$(orgId: string) {
    const { count, groupBy } = this.aggSvc.utils;
    const healthScore = this.aggSvc.resolve<number>("deployment-analytics", "healthScore");

    // Layer 1 — org (single item, live)
    const org$ = this.mesh
      .from(OrganizationMeshService.queries.organizations.read)
      .listen()
      .execute({ organizationId: orgId });

    // Layer 2 — active projects (global resource → coordinator SSE)
    const projects$ = this.mesh
      .from(ProjectMeshService.queries.projects.query)
      .where({ organizationId: eq(orgId), status: eq("active") })
      .listen(b => b.onChange("status", "name").debounce(100))
      .execute();

    // Layer 3 — deployments reactive to active project list
    const deployments$ = this.mesh
      .from(DeploymentMeshService.queries.deployments.query)
      .where({ environment: eq("prod") })
      .listen(b => b.onChange("status", "replicaCount").debounce(50))
      .whereFrom(projects$, r => ({
        projectId: inList(r.items.map(i => i.data.projectId)),
      }))
      .execute();

    // Layer 4 — live aggregate reactive to same project list
    const stats$ = this.mesh
      .from(DeploymentMeshService.queries.deployments.query)
      .where({ environment: eq("prod") })
      .listen(b => b.debounce(300))
      .whereFrom(projects$, r => ({
        projectId: inList(r.items.map(i => i.data.projectId)),
      }))
      .aggregate({
        total:    count(),
        byStatus: groupBy<Deployment, number>("status", count()),
        health:   healthScore,
      });

    return combineLatest({ org: org$, projects: projects$, deployments: deployments$, stats: stats$ });
  }
}
```

### Scenario 2: Build log tail — node-targeted, streaming

```typescript
import { eq, inList } from "@mesh/where";
import { filter } from "rxjs/operators";

async function tailBuildLogs(mesh: MeshContext, deploymentId: string): Promise<void> {
  // Locate the owner node without fetching the deployment record
  const location = await mesh.discovery.locate(deploymentResource, { deploymentId });
  if (!location) throw new Error(`Deployment ${deploymentId} not found in ownership registry`);

  const logs$ = mesh
    .from(DeploymentMeshService.queries.logs.query)
    .onNode(location.nodeId)
    .where({ deploymentId: eq(deploymentId), level: inList(["info", "error", "warn"] as const) })
    .sortBy("timestamp", "asc")
    .listen(b => b.withSnapshot(false))
    .execute();

  const sub = logs$.subscribe(result => {
    for (const { data: log, meta } of result.items) {
      if (meta.eventType === "created") {
        process.stdout.write(`[${log.level.toUpperCase()}] ${log.message}\n`);
      }
    }
  });

  // Unsubscribe when the deployment reaches a terminal state
  mesh
    .from(DeploymentMeshService.queries.deployments.read)
    .listen()
    .execute({ deploymentId })
    .pipe(
      filter(r => r.item?.data.status === "running" || r.item?.data.status === "failed"),
    )
    .subscribe(() => sub.unsubscribe());
}
```

### Scenario 3: Multi-region health aggregate

```typescript
import { forkJoin } from "rxjs";
import { avg, count } from "@mesh/core";

const NODES = ["node-eu-west", "node-us-east", "node-ap-south"] as const;

const healthChecks = forkJoin(
  Object.fromEntries(
    NODES.map(nodeId => [
      nodeId,
      mesh
        .from(DeploymentMeshService.queries.metrics.query)
        .onNode(nodeId)
        .aggregate({
          avgCpu:     avg<DeploymentMetric>("cpuUsage"),
          avgLatency: avg<DeploymentMetric>("p99LatencyMs"),
          total:      count(),
        }),
    ]),
  ) as Record<typeof NODES[number], ReturnType<typeof mesh.from> extends never ? never :
    Promise<{ avgCpu: number; avgLatency: number; total: number }>>,
);

const report = await healthChecks;
for (const [nodeId, m] of Object.entries(report)) {
  const status = m.avgCpu > 80 || m.avgLatency > 500 ? "DEGRADED" : "HEALTHY";
  console.log(`${nodeId}: ${status} — CPU ${m.avgCpu.toFixed(1)}% p99 ${m.avgLatency.toFixed(0)}ms`);
}
```

### Scenario 4: Batch saga — scale all prod deployments with rollback

```typescript
import { eq } from "@mesh/where";

async function scaleAllProd(
  mesh:        MeshContext,
  replicas:    number,
  diagnostics: MeshDiagnosticContext,
): Promise<SagaResult<{ scaled: string[] }>> {
  const running = await mesh
    .from(DeploymentMeshService.queries.deployments.query)
    .where({ environment: eq("prod"), status: eq("running") })
    .select("deploymentId", "replicaCount")
    .execute();

  let saga = mesh.saga<{ scaled: string[] }>({
    name:        `scale-prod-to-${replicas}`,
    description: `Scale all running prod deployments to ${replicas} replicas`,
    diagnostics,
    timeoutMs:   300_000,
  });

  for (const { data: dep } of running.items) {
    const { deploymentId, replicaCount: prev } = dep;

    saga = saga
      .step(`scale-${deploymentId}`, {
        description: `Scale ${deploymentId} from ${prev} → ${replicas}`,
        tags:        { deploymentId, fromReplicas: String(prev), toReplicas: String(replicas) },
        retry:       { attempts: 2, backoffMs: 1_000 },
      }, async ctx => {
        await mesh
          .from(DeploymentMeshService.mutations.deployments.scale)
          .execute({ deploymentId, replicas });
        ctx.set("scaled", [...(ctx.get("scaled") ?? []), deploymentId]);
      })
      .compensate(`scale-${deploymentId}`, {
        description: `Rollback ${deploymentId} to ${prev} replicas`,
      }, async _ctx => {
        await mesh
          .from(DeploymentMeshService.mutations.deployments.scale)
          .execute({ deploymentId, replicas: prev });
      });
  }

  return saga.execute();
}
```

---

## 27. Complete Type Appendix — Core Result & Option Types

```typescript
// @mesh/core — result.types.ts

// ── MeshQueryResult ───────────────────────────────────────────────────────────

export interface MeshQueryResult<TItem> {
  items: MeshResultItem<TItem>[];
  meta: {
    /** Total item count across all nodes (before pagination). */
    totalItems:    number;
    hasMore:       boolean;
    /** Opaque cursor for the next page. null when no more pages exist. */
    nextCursor?:   string;
    /** How the request was routed. */
    strategy:      "coordinator" | "broadcast" | "direct" | "coordinator-lookup-then-direct" | "targeted-broadcast";
    /** All node IDs that contributed results. */
    sourceNodes:   string[];
    latencyMs:     number;
  };
}

export interface MeshResultItem<TItem> {
  /** The entity data. Narrows with .select(). */
  data: TItem;
  meta: {
    nodeId:        string;
    eventType?:    "snapshot" | "created" | "updated" | "deleted";
    /** Defined on "updated" events only. */
    changedFields?: (keyof TItem & string)[];
    latencyMs:      number;
    /** True if this item was served from cache. */
    cached:         boolean;
  };
}

// ── MeshReadResult ────────────────────────────────────────────────────────────

export interface MeshReadResult<TItem> {
  /** null when the item does not exist or was deleted. */
  item: MeshResultItem<TItem> | null;
  meta: {
    strategy:  "coordinator" | "coordinator-lookup-then-direct";
    latencyMs: number;
    /** Defined on live reads. */
    eventType?: "snapshot" | "updated" | "deleted";
  };
}

// ── ExecuteOptions ────────────────────────────────────────────────────────────

export interface ExecuteOptions<TItem> {
  /** Variable bindings for variable() expressions in the where clause. */
  vars?:   Record<string, Scalar>;
  signal?: AbortSignal;
}

export interface LiveExecuteOptions<TItem> extends ExecuteOptions<TItem> {
  /** When true, immediately emit the current snapshot before streaming deltas. Default: true. */
  withSnapshot?: boolean;
}

// ── LiveOptions ───────────────────────────────────────────────────────────────

export interface LiveOptions {
  /** Coalesce rapid re-executions within this window (ms). Default: 0. */
  debounceMs?: number;
  signal?:     AbortSignal;
}

// ── MeshConnectionHandle ──────────────────────────────────────────────────────

export interface MeshConnectionHandle<TItem> {
  readonly connectionId:  string;
  readonly consumerId:    string;
  readonly isShared:      boolean;
  readonly consumerCount: number;
  readonly refCount$:     Observable<number>;
  readonly status$:       Observable<"open" | "degraded" | "reconnecting" | "closed">;
  readonly events$:       Observable<MeshStreamEnvelope>;
  release(): void;
}

export interface MeshStreamEnvelope {
  entityKey:  string;
  eventType:  "created" | "updated" | "deleted";
  payload:    unknown;
  recipients: string[];  // consumer IDs this event was dispatched to
}

// ── AggregateSpec & AggregateResult ───────────────────────────────────────────

export type AggregateSpec = Record<string, MeshAggregator<unknown, unknown, unknown>>;

export type AggregateResult<TSpec extends AggregateSpec> = {
  [K in keyof TSpec]: TSpec[K] extends MeshAggregator<unknown, unknown, infer R> ? R : never;
};

// ── Query & Read plans ────────────────────────────────────────────────────────

export interface MeshQueryPlan {
  resourceKey:      string;
  ownership:        "global" | "node-owned";
  ownerField?:      string;
  routingStrategy:  "broadcast" | "direct" | "targeted-broadcast" | "coordinator";
  targetNodes:      string[] | "all";
  filterDescriptor: unknown;
  joins:            MeshJoinPlan[];
  connectionReuse:  { perNode: { nodeId: string; wouldReuse: boolean; existingConsumers: number }[] };
  estimatedResultCount?: number;
  warnings:         { code: string; severity: "info" | "warn" | "error"; message: string }[];
}

export interface MeshReadPlan {
  ownership:        "global" | "node-owned";
  routingStrategy:  "coordinator" | "coordinator-lookup-then-direct";
  coordinatorQuery: { table: string; pk: string };
  resolvedNodeId?:  string;
}

export interface MeshAggregationPlan {
  executionPhases:    { phase: "partial" | "merge"; targetNodes?: string[] | "all"; location?: "client" | "coordinator"; description: string }[];
  missingAggregators: string[];
}

export interface MeshJoinPlan {
  type:      "explicit" | "include";
  relation?: string;
  entityKey: string;
  joinType:  "left" | "inner";
}
```

### 27.1 Builder discrimination table

| `mesh.from(...)` argument | Ownership | Builder type returned | `.onNode()` | `.read()` | Primary terminal |
|---|---|---|---|---|---|
| `projects.query` | global | `MultiItemQueryBuilder<Project, never>` | ✗ compile error | ✗ | `.execute()` / `.listen().execute()` / `.aggregate()` / `.stream()` |
| `projects.read` | global | `SingleItemReadBuilder<Project, "projectId">` | ✗ | `.read(pk)` | `.read(pk)` / `.listen().execute(pk)` |
| `deployments.query` | node-owned | `MultiItemQueryBuilder<Deployment, "nodeId">` | ✓ | ✗ | `.execute()` / `.listen().execute()` / `.aggregate()` / `.stream()` |
| `deployments.read` | node-owned | `SingleItemReadBuilder<Deployment, "deploymentId">` | ✗ | `.read(pk)` | `.read(pk)` / `.listen().execute(pk)` |
| `deployments.mutations.restart` | node-owned | `MeshMutationBuilder<RestartInput, RestartOutput>` | ✗ | ✗ | `.execute(input)` |
| `deployments.mutations.scale` | node-owned | `MeshMutationBuilder<ScaleInput, ScaleOutput>` | ✗ | ✗ | `.execute(input)` |

---

## 28. Typed Error Hierarchy

All errors thrown by mesh operations are instances of `MeshError` and carry a discriminated `code` field. Catch the base class for broad handling; narrow on `code` for specific recovery logic.

```typescript
// @mesh/core — errors.ts

export class MeshError extends Error {
  abstract readonly code: string;
  readonly timestamp: Date = new Date();
}

// ── Query errors ──────────────────────────────────────────────────────────────

export class MeshNodeUnreachableError extends MeshError {
  readonly code = "NODE_UNREACHABLE" as const;
  constructor(
    public readonly nodeId:    string,
    public readonly entityKey: string,
    cause?:                    unknown,
  ) { super(`Node ${nodeId} is unreachable for entity "${entityKey}"`); this.cause = cause; }
}

export class MeshQueryTimeoutError extends MeshError {
  readonly code = "QUERY_TIMEOUT" as const;
  constructor(
    public readonly entityKey:  string,
    public readonly timeoutMs:  number,
  ) { super(`Query for "${entityKey}" timed out after ${timeoutMs}ms`); }
}

export class MeshNotFoundError extends MeshError {
  readonly code = "NOT_FOUND" as const;
  constructor(
    public readonly entityKey:  string,
    public readonly primaryKey: string,
  ) { super(`Entity "${entityKey}" with pk "${primaryKey}" not found`); }
}

// ── Mutation errors ───────────────────────────────────────────────────────────

export class MeshValidationError extends MeshError {
  readonly code = "VALIDATION_FAILED" as const;
  constructor(
    public readonly entityKey:  string,
    public readonly issues:     { path: string[]; message: string }[],
  ) { super(`Validation failed for "${entityKey}": ${issues.map(i => i.message).join(", ")}`); }
}

export class MeshConflictError extends MeshError {
  readonly code = "CONFLICT" as const;
  constructor(
    public readonly entityKey:    string,
    public readonly primaryKey:   string,
    public readonly serverVersion: number,
    public readonly clientVersion: number,
  ) { super(`Conflict on "${entityKey}" pk="${primaryKey}": server@${serverVersion} vs client@${clientVersion}`); }
}

export class MeshOptimisticRollbackError extends MeshError {
  readonly code = "OPTIMISTIC_ROLLBACK" as const;
  constructor(public readonly cause: unknown) {
    super("Optimistic mutation was rolled back due to server rejection");
    this.cause = cause;
  }
}

// ── Aggregate errors ──────────────────────────────────────────────────────────

export class MeshAggregatorNotFoundError extends MeshError {
  readonly code = "AGGREGATOR_NOT_FOUND" as const;
  constructor(
    public readonly pluginName:     string,
    public readonly aggregatorName: string,
  ) { super(`Aggregator "${pluginName}/${aggregatorName}" not found on the connected cluster`); }
}

export class MeshAggregatorVersionMismatchError extends MeshError {
  readonly code = "AGGREGATOR_VERSION_MISMATCH" as const;
  constructor(
    public readonly pluginName:      string,
    public readonly aggregatorName:  string,
    public readonly serverVersion:   string,
    public readonly requiredVersion: string,
  ) { super(`Version mismatch for "${pluginName}/${aggregatorName}": server has ${serverVersion}, requires ${requiredVersion}`); }
}

// ── Saga errors ───────────────────────────────────────────────────────────────

export class MeshSagaError extends MeshError {
  readonly code = "SAGA_FAILED" as const;
  constructor(
    public readonly sagaName:         string,
    public readonly failedStep:       string,
    public readonly compensatedSteps: string[],
    cause?:                           unknown,
  ) { super(`Saga "${sagaName}" failed at step "${failedStep}"`); this.cause = cause; }
}

// ── Transaction errors ────────────────────────────────────────────────────────

export class MeshTransactionAbortedError extends MeshError {
  readonly code = "TRANSACTION_ABORTED" as const;
  constructor(public readonly reason: string) { super(`Transaction aborted: ${reason}`); }
}
```

### 28.1 Error handling patterns

```typescript
import {
  MeshError,
  MeshNodeUnreachableError,
  MeshQueryTimeoutError,
  MeshValidationError,
  MeshConflictError,
} from "@mesh/core";

try {
  const result = await mesh
    .from(DeploymentMeshService.mutations.deployments.update)
    .execute({ deploymentId: "dep-abc", status: "stopped", replicaCount: 0 });
} catch (err) {
  if (err instanceof MeshValidationError) {
    // err.issues: { path: string[]; message: string }[]
    showFieldErrors(err.issues);
  } else if (err instanceof MeshConflictError) {
    // Another writer updated this record since we last fetched it
    promptUserToRefreshAndRetry(err.serverVersion);
  } else if (err instanceof MeshNodeUnreachableError) {
    // err.nodeId:    string
    // err.entityKey: string
    alertOps(`Node ${err.nodeId} unreachable`);
  } else if (err instanceof MeshQueryTimeoutError) {
    showRetryButton();
  } else if (err instanceof MeshError) {
    // Unknown mesh error — err.code is still typed
    logError(err.code, err);
  } else {
    throw err; // not a mesh error — re-throw
  }
}
```

---

## 29. Light Transactions — `mesh.transaction()`

Transactions coordinate multiple mutations as an atomic unit. Unlike sagas, they do not support compensations or retry — on failure the entire transaction is aborted. Use transactions for tightly-coupled multi-step writes on the same node; use sagas for cross-node workflows.

```typescript
// @mesh/core — transaction.types.ts

export interface MeshTransactionBuilder {
  /**
   * Add a mutation to the transaction.
   * All mutations in the transaction must target the same owning node.
   * Adding a mutation to a different node is a COMPILE-TIME ERROR when the
   * node can be statically known, and a MeshTransactionAbortedError at runtime
   * if it can only be determined at execute time.
   */
  add<TInput, TOutput>(
    builder: MeshMutationBuilder<TInput, TOutput>,
    input:   TInput,
  ): MeshTransactionBuilder;

  execute(): Promise<MeshTransactionResult>;
}

export interface MeshTransactionResult {
  success:       boolean;
  /** Map from step index to mutation result data. */
  results:       Map<number, unknown>;
  durationMs:    number;
  nodeId:        string;
}

export interface TransactionConfig {
  timeoutMs?:   number;
  diagnostics?: MeshDiagnosticContext;
}
```

```typescript
// TX1 — atomic multi-step update on the same deployment (same owning node)

const txResult = await mesh.transaction({ timeoutMs: 10_000 })
  .add(
    mesh.from(DeploymentMeshService.mutations.deployments.update),
    { deploymentId: "dep-abc-123", status: "stopped", replicaCount: 0 },
  )
  .add(
    mesh.from(DeploymentMeshService.mutations.deployments.scale),
    { deploymentId: "dep-abc-123", replicas: 0 },
  )
  .execute();

if (txResult.success) {
  console.log(`Both mutations committed on node ${txResult.nodeId}`);
} else {
  // MeshTransactionAbortedError was thrown — neither mutation was applied
}

// TX1 — with diagnostics
const diag = mesh.diagnostics({ name: "stop-and-drain", tags: { deploymentId: "dep-abc-123" } });

await mesh.transaction({ diagnostics: diag })
  .add(
    mesh.from(DeploymentMeshService.mutations.deployments.update).withDiagnostics(diag),
    { deploymentId: "dep-abc-123", status: "stopped" },
  )
  .add(
    mesh.from(DeploymentMeshService.mutations.deployments.scale).withDiagnostics(diag),
    { deploymentId: "dep-abc-123", replicas: 0 },
  )
  .execute();
```

### 29.1 Transaction vs Saga — when to use which

| Concern | Transaction | Saga |
|---|---|---|
| Atomicity scope | Single node, all-or-nothing | Multi-node, best-effort |
| On failure | Aborted, no state committed | Compensated in reverse order |
| Retry | No — caller retries the whole thing | Per-step `retry` config |
| Performance | Low overhead — single round trip | Multi-round-trip by design |
| Use case | Tightly-coupled writes on one record | Cross-service, cross-node workflows |

---

## 30. Computed Fields — `defineComputedField()`

Computed fields are derived from a resource's existing fields and materialised server-side at query time. They appear in the type system as regular fields and are filterable and sortable.

```typescript
// @mesh/core — computed-field.ts

export function defineComputedField<
  TResource extends ResourceDescriptor<unknown, Record<string, z.ZodTypeAny>>,
  TName extends string,
  TValue extends Scalar,
>(
  resource: TResource,
  name:     TName,
  opts: {
    /** Zod schema for the computed value — determines the TypeScript type. */
    schema:   z.ZodType<TValue>;
    /**
     * Server-side computation — receives the full item, returns the derived value.
     * Must be a pure function: no side effects, no external I/O.
     */
    compute:  (item: z.infer<TResource["_schema"]>) => TValue;
    description?: string;
  },
): TResource & { _computedFields: Record<TName, TValue> };
```

```typescript
// deployment-computed.ts

import { defineComputedField } from "@mesh/core";
import { z } from "zod";

// Add a computed "costPerHour" field to deployments
export const deploymentResourceWithCost = defineComputedField(
  deploymentResource,
  "costPerHour",
  {
    schema:      z.number(),
    description: "Estimated hourly cost based on CPU and memory allocation",
    compute: (dep: Deployment): number => {
      const cpu = (dep.cpuMillicores / 1_000) * 0.048;
      const mem = (dep.memoryMb / 1_024) * 0.006;
      return cpu + mem;
    },
  },
);

// Add a computed "isHealthy" boolean field
export const deploymentResourceWithHealth = defineComputedField(
  deploymentResourceWithCost,   // chain on top of previous extensions
  "isHealthy",
  {
    schema:      z.boolean(),
    description: "True when status is running and replicaCount > 0",
    compute: (dep: Deployment): boolean =>
      dep.status === "running" && dep.replicaCount > 0,
  },
);
```

```typescript
// Using computed fields — they appear as first-class fields in the type system

const expensive = await mesh
  .from(DeploymentMeshService.queries.deployments.query)   // uses the extended resource
  .where({ environment: eq("prod") })
  .sortBy("costPerHour", "desc")          // sortable ✓ (SortableField<Deployment & { costPerHour: number }>)
  .execute();

expensive.items[0].data.costPerHour       // ✓  number
expensive.items[0].data.isHealthy         // ✓  boolean

// Computed fields are filterable
const unhealthy = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .where({ isHealthy: eq(false) })        // ✓  FieldWhere<boolean>
  .execute();

// Computed fields are projectable
const costView = await mesh
  .from(DeploymentMeshService.queries.deployments.query)
  .select("deploymentId", "costPerHour", "isHealthy")
  .execute();
// costView.items[0].data.deploymentId  ✓
// costView.items[0].data.image         ✗ compile error — not selected
```

---

## 31. Resource Versioning & Schema Migrations

When a resource's schema changes, the mesh handles version negotiation between nodes running different service versions. Migrations are pure functions that transform old-format records to the new schema.

```typescript
// @mesh/core — versioning.ts

export interface ResourceVersion<TOld, TNew> {
  /**
   * Semantic version of this schema. Must be a valid semver string.
   * The framework uses this to determine which migration to apply.
   */
  version: string;
  /**
   * Migration from the previous version's record shape to this version.
   * Applied lazily on read when an old-format record is encountered.
   */
  migrateFrom?: (old: TOld) => TNew;
}
```

```typescript
// deployment-versions.ts
import { z } from "zod";

// v1 schema — original
const deploymentSchemaV1 = z.object({
  deploymentId:  z.string().uuid(),
  projectId:     z.string().uuid(),
  nodeId:        z.string(),
  environment:   z.enum(["prod", "staging"]),      // canary not yet supported
  status:        z.enum(["running", "pending", "stopped", "failed"]),
  replicas:      z.number().int(),                  // was named "replicas" in v1
  image:         z.string(),
  createdAt:     z.string().datetime(),
});

type DeploymentV1 = z.infer<typeof deploymentSchemaV1>;

// v2 schema — renamed field + added environment value
const deploymentSchemaV2 = deploymentSchema;  // the current schema in schemas.ts
type DeploymentV2 = Deployment;

export const deploymentResourceV2 = defineResource({
  schema:     deploymentSchemaV2,
  primaryKey: "deploymentId",
  ownership:  { type: "node-owned", ownerField: "nodeId" } as const,
  version:    "2.0.0",
  previousVersions: [
    {
      version: "1.0.0",
      migrateFrom: (old: DeploymentV1): DeploymentV2 => ({
        ...old,
        serviceId:     "unknown",             // new required field — default value
        replicaCount:  old.replicas,          // field renamed
        cpuMillicores: 0,                     // new field — default value
        memoryMb:      0,                     // new field — default value
        updatedAt:     old.createdAt,         // new field — seed from createdAt
      }),
    },
  ],
});
```

### 31.1 Version negotiation behaviour

| Node A (caller) | Node B (data) | Outcome |
|---|---|---|
| v2.0.0 | v2.0.0 | Served as-is |
| v2.0.0 | v1.0.0 | Migration applied on read — caller receives v2 shape |
| v1.0.0 | v2.0.0 | Node B downgrades response to v1 shape if a downgrade migration is registered; otherwise `MeshSchemaVersionError` |
| v2.0.0 | v1.0.0 | Schema Registry emits a `changes$` event when Node B upgrades |

---

## 32. Testing Utilities — `createMeshTestHarness()`

The test harness runs an in-memory mesh cluster with no network I/O. Seeded data is stored in memory; all queries, mutations, subscriptions, and aggregations run against it.

```typescript
// @mesh/testing — harness.ts

export interface MeshTestHarness {
  /**
   * The MeshContext instance to inject into your services under test.
   * Identical API to the production MeshContext — no mocking required.
   */
  readonly mesh: MeshContext;

  /** Seed the in-memory store with initial data. */
  seed<TItem>(
    resource: ResourceDescriptor<TItem, Record<string, z.ZodTypeAny>>,
    items:    TItem[],
  ): this;

  /**
   * Simulate a live event on a resource — triggers all active subscriptions.
   */
  emit<TItem>(
    resource:  ResourceDescriptor<TItem, Record<string, z.ZodTypeAny>>,
    eventType: "created" | "updated" | "deleted",
    item:      TItem,
    previous?: TItem,
  ): this;

  /**
   * Simulate a custom domain event.
   */
  emitDomainEvent<TItem, TEvents extends Record<string, z.ZodTypeAny>, TKey extends keyof TEvents>(
    resource:  ResourceDescriptor<TItem, TEvents>,
    eventType: TKey,
    item:      TItem,
    payload:   z.infer<TEvents[TKey]>,
  ): this;

  /** Assert a query descriptor was executed the expected number of times. */
  assertQueried(
    descriptor: QueryDescriptor<unknown, string | never, string>,
    times:      number,
  ): this;

  /** Assert a mutation descriptor was executed the expected number of times. */
  assertMutated(
    descriptor: MutationDescriptor<unknown, unknown>,
    times:      number,
  ): this;

  /** Reset seeds, call counts, and emission history. */
  reset(): this;

  /** Tear down subscriptions and release resources. */
  destroy(): void;
}

export function createMeshTestHarness(
  services: Array<new (...args: never[]) => unknown>,
  opts?: { aggregatePlugins?: AggregatePluginManifest[] },
): MeshTestHarness;
```

### 32.1 Usage in tests

```typescript
// deployment.service.spec.ts
import { createMeshTestHarness } from "@mesh/testing";

describe("DeploymentDashboardService", () => {
  let harness: MeshTestHarness;

  beforeEach(() => {
    harness = createMeshTestHarness(
      [ProjectMeshService, DeploymentMeshService],
      { aggregatePlugins: [deploymentAggregatePlugin] },
    );

    // Seed in-memory data — no network required
    harness
      .seed(projectResource, [
        { projectId: "proj-1", organizationId: "org-123", name: "API", status: "active", ownerId: "user-1", createdAt: "2024-01-01T00:00:00Z" },
      ])
      .seed(deploymentResource, [
        { deploymentId: "dep-1", projectId: "proj-1", serviceId: "svc-1", nodeId: "node-A", environment: "prod", status: "running", replicaCount: 2, image: "api:v1", cpuMillicores: 500, memoryMb: 256, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" },
        { deploymentId: "dep-2", projectId: "proj-1", serviceId: "svc-1", nodeId: "node-B", environment: "prod", status: "failed",  replicaCount: 0, image: "api:v1", cpuMillicores: 0,   memoryMb: 0,   createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" },
      ]);
  });

  afterEach(() => harness.destroy());

  it("returns running deployments for the org", async () => {
    const svc = new DeploymentDashboardService(harness.mesh, new AggregateService());
    const stats = await svc.getDashboardStats();

    expect(stats.total).toBe(2);
    expect(stats.byStatus).toEqual({ running: 1, failed: 1 });
    harness.assertQueried(DeploymentMeshService.queries.deployments.query, 1);
  });

  it("reacts to live deployment status change", async () => {
    const emissions: number[] = [];

    const svc = new DeploymentDashboardService(harness.mesh, new AggregateService());
    svc.getLiveStats().subscribe(s => emissions.push(s.total));

    // Simulate a new deployment being created on node-A
    harness.emit(deploymentResource, "created", {
      deploymentId: "dep-3", projectId: "proj-1", serviceId: "svc-1", nodeId: "node-A",
      environment: "prod", status: "pending", replicaCount: 1, image: "api:v2",
      cpuMillicores: 250, memoryMb: 128, createdAt: "2024-06-01T00:00:00Z", updatedAt: "2024-06-01T00:00:00Z",
    });

    // Wait for the reactive aggregate to re-emit
    await new Promise(r => setTimeout(r, 10));
    expect(emissions).toContain(3);  // now 3 total
  });

  it("emits custom domain event", async () => {
    const restarts: string[] = [];

    harness.mesh
      .on(DeploymentMeshService.resources.deployments)
      .event("restarted")
      .asObservable()
      .subscribe(e => restarts.push(e.payload.jobId));

    harness.emitDomainEvent(
      deploymentResource,
      "restarted",
      harness.seed(deploymentResource, []).mesh /* simplification — use a seeded item */,
      { jobId: "job-xyz", graceful: true },
    );

    expect(restarts).toContain("job-xyz");
  });
});
```

---

## 33. Builder Discrimination & Invariants

### 33.1 Builder discrimination table

| `mesh.from(...)` argument | Ownership | Builder type | `.onNode()` | `.read()` | Primary terminal |
|---|---|---|---|---|---|
| `projects.query` | global | `MultiItemQueryBuilder<Project, never>` | ✗ | ✗ | `.execute()` / `.listen().execute()` / `.aggregate()` / `.stream()` |
| `projects.read` | global | `SingleItemReadBuilder<Project, "projectId">` | ✗ | `.read(pk)` | `.read(pk)` / `.listen().execute(pk)` |
| `deployments.query` | node-owned | `MultiItemQueryBuilder<Deployment, "nodeId">` | ✓ | ✗ | `.execute()` / `.listen().execute()` / `.aggregate()` / `.stream()` |
| `deployments.read` | node-owned | `SingleItemReadBuilder<Deployment, "deploymentId">` | ✗ | `.read(pk)` | `.read(pk)` / `.listen().execute(pk)` |
| `deployments.mutations.restart` | node-owned | `MeshMutationBuilder<RestartInput, RestartOutput>` | ✗ | ✗ | `.execute(input)` |
| `deployments.mutations.scale` | node-owned | `MeshMutationBuilder<ScaleInput, ScaleOutput>` | ✗ | ✗ | `.execute(input)` |

### 33.2 System invariants

| # | Invariant |
|---|-----------|
| I1 | `mesh.from(descriptor.read)` returns `SingleItemReadBuilder` — `.where()`, `.sortBy()`, `.limit()`, `.cursor()` do not exist on it |
| I2 | `mesh.from(descriptor.query)` returns `MultiItemQueryBuilder` — `.read(pk)` does not exist on it |
| I3 | `.listen()` on `MultiItemQueryBuilder` returns `LiveMultiItemBuilder` — further `.where()`, `.sortBy()`, `.limit()` are compile errors |
| I4 | `.listen().aggregate(spec)` returns `Observable<AggregateResult<TSpec>>` — there is no `aggregateLive()` method |
| I5 | `AggregateService` is the single source of aggregate functions — no top-level `count()`/`sum()` etc. outside of `@mesh/core` re-exports |
| I6 | Aggregators are versioned — `aggSvc.resolve()` throws `MeshAggregatorNotFoundError` or `MeshAggregatorVersionMismatchError` |
| I7 | Joins are evaluated server-side with the query — client-side RxJS `combineLatest`/`forkJoin` is for composing independent streams |
| I8 | `.onNode()` / `.onNodes()` only exist when `TOwner extends string` — compile error on global resources (`TOwner = never`) |
| I9 | Dynamic variables are bound at `.execute({ vars })` / `.listen().execute({ vars })` call time — not at builder construction time |
| I10 | Saga step context (`SagaContext<TCtx>`) is typed — `ctx.get(key)` returns `TCtx[key]`, `ctx.set(key, value)` requires `TCtx[key]` |
| I11 | `mesh.discovery.locate()` queries the ownership registry only — it does not fetch item data |
| I12 | `mesh.connections.connectToNode()` opens a direct diagnostic connection — bypasses broadcast routing |
| I13 | `mesh.diagnostics()` returns a context attachable to queries, mutations, and sagas via `.withDiagnostics(ctx)` |
| I14 | Connections are shared by fingerprint (node + entity + method) — at most one SSE per fingerprint |
| I15 | Server evaluates event recipients once per emit — events with no matching recipients are suppressed at the server |
| I16 | All capabilities (cache, middleware, diagnostics, joins, projections, variables, leases) compose orthogonally |
| I17 | `mesh.discovery` and `mesh.connections` are properties on `MeshContext` — no separate injection required |
| I18 | `mesh.transaction()` mutations must all target the same owning node — cross-node transaction is a `MeshTransactionAbortedError` |
| I19 | Computed fields defined via `defineComputedField()` are filterable, sortable, and projectable — identical type-level status to schema fields |
| I20 | `createMeshTestHarness()` provides the identical `MeshContext` API — tests require zero mocking of mesh internals |
| I21 | Resource schema migrations are pure functions — no side effects, no I/O, applied lazily on read |
| I22 | All `MeshError` subclasses carry a literal `code` field — catch `MeshError`, narrow on `.code` for specific recovery |
