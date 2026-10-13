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