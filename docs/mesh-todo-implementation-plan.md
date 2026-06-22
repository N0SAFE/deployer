# Mesh TODO Features — Implementation Plan

> **Source of truth:** `v3/FULL_MESH_HISTORY.md`  
> **Compliance matrix:** `v3/apps/api/src/e2e/mesh-workflows/mesh-doc-compliance-matrix.e2e-spec.ts`  
> **Date:** 2026-06-10  
> **Status:** 12 tracked `it.todo` entries in compliance matrix

---

## Dependency Graph

```
                    ┌──────────────────────────┐
                    │  Group A: Primitives      │
                    │  (no runtime deps)        │
                    │                           │
                    │  T11 computeStreamKey()   │
                    │  T12 MeshStreamEventPayload│
                    └────────────┬─────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │  T09 SharedStreamStore    │
                    │  (acquire/release/has/    │
                    │   snapshot/evict)         │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
   │ Group B: Pool    │  │ Group C:        │  │ Group D:        │
   │                  │  │ Control Plane   │  │ Query Engine    │
   │ T04/T05 Durable  │  │                 │  │ Integration     │
   │ Stream Pool      │  │ T08 Promote/    │  │                 │
   │                  │  │ Demote Frames   │  │ T06 REQUEST     │
   │                  │  │                 │  │ T07 LISTEN      │
   │                  │  │ T03 Global      │  │                 │
   │                  │  │ Durable Stream  │  │                 │
   │                  │  │                 │  │                 │
   │                  │  │ T02 Node-Owned  │  │                 │
   │                  │  │ Routing         │  │                 │
   └─────────────────┘  └────────┬────────┘  └────────┬────────┘
                                  │                    │
                                  ▼                    ▼
                    ┌─────────────────────────────────────┐
                    │  Group E: Advanced Multi-Node       │
                    │                                     │
                    │  T10 Sharded Fan-Out                │
                    │  T01 Replicated Read Path           │
                    └─────────────────────────────────────┘
```

---

## Group A: Foundational Runtime Primitives

These have zero external runtime dependencies and can be implemented independently.

### T11 — `computeStreamKey()` stream key derivation function

**Priority:** P0 — blocking dependency for SharedStreamStore  
**Complexity:** XS (pure function, ~15 lines)  
**Target file:** `v3/apps/api/src/core/modules/mesh/stream-store/stream-key.ts`  
**Doc reference:** FULL_MESH_HISTORY.md §SSE Stream Store — "Stream Key Derivation"

```ts
export function computeStreamKey(config: {
  namespace: string;
  entityKey: string;
  sourceType: string;
  filters?: Record<string, unknown>;
}): string {
  const filterHash = config.filters
    ? stableStringify(config.filters)
    : '*';
  return `${config.namespace}:${config.entityKey}:${config.sourceType}:${filterHash}`;
}
```

**Implementation steps:**
1. Install/use `stableStringify` or implement inline `stableStringify` that sorts keys
2. Create `stream-key.ts` with exported `computeStreamKey`
3. Export from barrel `stream-store/index.ts`
4. Write unit test: `stream-key.spec.ts` covering composite identity, `*` for no filters, deterministic hash

---

### T12 — `MeshStreamEventPayload` type/interface

**Priority:** P0 — blocking dependency for SharedStreamStore and SSE envelope pipeline  
**Complexity:** XS (interface definition, ~15 lines)  
**Target file:** `v3/apps/api/src/core/modules/mesh/stream-store/shared-stream-store.types.ts`  
**Doc reference:** FULL_MESH_HISTORY.md §1.1 Event Structure

```ts
export interface MeshStreamEventPayload<TItem, TEventPayload = unknown> {
  readonly namespace: string;
  readonly entity: string;
  readonly source: string;
  readonly type: string;
  readonly item: TItem;
  readonly payload: TEventPayload;
  readonly timestamp: string;
  readonly sourceNodeId: string;
}
```

**Implementation steps:**
1. Create `shared-stream-store.types.ts` with the interface
2. Export from barrel `stream-store/index.ts`
3. Ensure existing `MeshStreamEvent`/`MeshChangeEvent` types reference this where appropriate (may need to align type naming)

---

### T09 — `SharedStreamStore` reference-counted implementation

**Priority:** P0 — core infrastructure for stream sharing  
**Complexity:** M (NestJS injectable, ~120 lines)  
**Target file:** `v3/apps/api/src/core/modules/mesh/stream-store/shared-stream-store.ts`  
**Depends on:** T11, T12  
**Doc reference:** FULL_MESH_HISTORY.md §SSE Stream Store — "Implementation Sketch (NestJS/RxJS)"

**Interface:**
```ts
interface StreamStoreEntry {
  readonly key: string;
  refCount: number;
  readonly subject: Subject<MeshStreamEvent>;
  upstreamSubscription: Subscription | null;
  readonly createdAt: number;
  readonly metadata: { namespace: string; entityKey: string; sourceType: string; filterHash: string; };
}

interface StreamStore {
  acquire(key: string, factory: () => Observable<MeshStreamEvent>): Observable<MeshStreamEvent>;
  release(key: string): void;
  has(key: string): boolean;
  snapshot(): StreamStoreEntry[];
  evict(key: string): void;
}
```

**Implementation steps:**
1. Create `shared-stream-store.ts` with `@Injectable()` class
2. Implement `acquire()`: check existing stream → refCount++ or create new Subject + upstream
3. Implement `release()`: refCount-- → teardown if 0
4. Implement `has()`, `snapshot()`, `evict()`
5. Create `stream-store.module.ts` to register the provider
6. Wire into `mesh-core.module.ts`
7. Write unit test covering: acquire new, acquire existing, release→teardown, rapid acquire/release, evict, snapshot

---

## Group B: Durable Stream Pool Lifecycle

### T04/T05 — Persistent durable stream pool across app lifecycle

**Priority:** P1  
**Complexity:** M  
**Target file:** Enhancement of existing `v3/apps/api/src/core/modules/mesh/services/stream-manager/stream-manager.service.ts`  
**Depends on:** T09  
**Doc reference:** FULL_MESH_HISTORY.md §4.7 Implementation Architecture — Stream Manager

**Note:** T04 and T05 are duplicates of the same concept. After implementation, deduplicate the compliance matrix entry.

**Concept:** The `StreamManagerService` already exists (getOrCreateAndAttach). The enhancement adds:
1. Pool lifecycle management tied to app lifecycle (init on boot, graceful drain on shutdown)
2. Configurable pool limits (max concurrent streams, max per-node)
3. Stream health monitoring with automatic reconnection
4. Observable pool diagnostics

**Implementation steps:**
1. Extend `StreamManagerService` with pool configuration injection
2. Implement `onModuleInit` → validate/restore persistent streams
3. Implement `onApplicationShutdown` → graceful drain
4. Add `getPoolHealth(): Observable<PoolHealthSnapshot>` for monitoring
5. Write tests: pool init, max limit enforcement, drain on shutdown

---

## Group C: Remote SSE Control Plane

### T08 — Promotion/demotion control frames over live SSE control channel

**Priority:** P1  
**Complexity:** L  
**Target files:**
- `v3/apps/api/src/core/modules/mesh/connection/mesh-connection-registry.ts` (extend)
- `v3/apps/api/src/core/modules/mesh/connection/mesh-connection.types.ts` (add frame types)
- New: `v3/apps/api/src/core/modules/mesh/stream-store/mesh-control-frame-handler.service.ts`  
**Doc reference:** FULL_MESH_HISTORY.md §SSE Stream Store — Filter-Aware Stream Sharing

**Concept:** The `decidePromotion` method determines what action to take (attach/promote/new), but there's no mechanism to send a `mesh:promote` or `mesh:demote` control frame back through the SSE control channel to the remote end.

**Control frames:**
```typescript
// Sent by consumer to mesh node when promote decision is made
interface MeshPromoteFrame {
  frame: 'mesh:promote';
  connectionId: string;
  newFilter: MeshFilterDescriptor;
}

// Sent by mesh node back to consumer after promotion
interface MeshDemoteFrame {
  frame: 'mesh:demote';
  connectionId: string;
  reason: 'filter_conflict' | 'overloaded' | 'ownership_changed';
}
```

**Implementation steps:**
1. Add `MeshControlFrame` types to `mesh-connection.types.ts`
2. Create `MeshControlFrameHandlerService` that:
   - Listens to control frames from SSE control channel
   - On `mesh:promote`: validates new filter, applies it, sends ack/error
   - On `mesh:demote`: gracefully detaches and suggests reconnection
3. Wire into `MeshConnectionRegistry` so `promote()` emits control frame
4. Write unit tests: frame serialization, promote round-trip, demote handling

---

### T03 — Global ownership durable stream integration against real coordinator stream

**Priority:** P1  
**Complexity:** L  
**Target files:**
- `v3/apps/api/src/core/modules/mesh/services/system-mesh-resource-discovery/system-mesh-resource-discovery.service.ts` (enhance)
- `v3/apps/api/src/core/modules/mesh/services/stream-manager/stream-manager.service.ts` (enhance)  
**Depends on:** T09 (SharedStreamStore)  
**Doc reference:** FULL_MESH_HISTORY.md §3.1 Global (Coordinator Owned), §4.3 B Global Resource Stream

**Concept:** The "global resource stream" concept describes a persistent durable SSE connection to the global coordinator. Currently, tests use mock subjects/notifiers. The real flow requires:
1. A durable SSE connection to the global coordinator (via `MeshTransport`)
2. `SharedStreamStore` fans out events from the single coordinator stream to all local listeners
3. Automatic reconnection on coordinator disconnect

**Implementation steps:**
1. Define `GlobalStreamCoordinatorService` that manages one durable connection to coordinator
2. Use `SharedStreamStore.acquire()` with a well-known key (e.g., `*:*:coordinator:*`)
3. Integrate reconnection logic (exponential backoff, max retries)
4. Wire `SystemMeshResourceDiscoveryService.from().listen()` to use the coordinator stream for global resources
5. Write e2e test: start coordinator, connect, verify events fan out to multiple consumers

---

### T02 — Node-owned routing resolved by live ownership resolver + remote SSE control plane

**Priority:** P1  
**Complexity:** L  
**Target files:**
- `v3/apps/api/src/core/modules/mesh/services/ownership/ownership-resolver.service.ts` (enhance)
- `v3/apps/api/src/core/modules/mesh/services/system-mesh-resource-discovery/system-mesh-resource-discovery.service.ts` (enhance)
- `v3/apps/api/src/core/modules/mesh/services/mesh-stream-runtime.service.ts` (enhance)  
**Depends on:** T08 (control frames), T09 (SharedStreamStore)  
**Doc reference:** FULL_MESH_HISTORY.md §3.2 Node-Owned, §4.3 C Node-Specific Streams

**Concept:** When a consumer calls `.listen()` on a node-owned resource, the system must:
1. Resolve which physical node owns the resource (ownership resolver)
2. Establish a direct SSE stream to that node
3. Apply promotion/demotion control frames as consumers attach/detach
4. Fall back to other nodes if the primary owner is unreachable

**Implementation steps:**
1. Enhance `OwnershipResolverService` to return remote node addresses (not just node IDs)
2. Enhance `SystemMeshResourceDiscoveryService` to route `.listen()` calls through remote SSE proxy for node-owned resources
3. Wire `MeshStreamRuntimeService` to negotiate SSE streams through the control plane
4. Write integration test: node A declares ownership → consumer on node B listens → events flow A→B

---

## Group D: Distributed Query Engine Integration

### T06 — Real REQUEST flow over distributed query engine with node call-many transport

**Priority:** P1  
**Complexity:** XL  
**Target files:** Distributed query engine pipeline
- `v3/apps/api/src/core/modules/mesh/services/system-mesh-resource-discovery/query/mesh-query-executor.ts` (enhance)
- `v3/apps/api/src/core/modules/mesh/services/system-mesh-resource-discovery/query/mesh-query-builder.ts` (enhance)
- New: `v3/apps/api/src/core/modules/mesh/services/system-mesh-resource-discovery/transport/mesh-call-many-transport.service.ts`  
**Depends on:** T09 (SharedStreamStore)  
**Doc reference:** FULL_MESH_HISTORY.md §4.4 Flow 1 (Request), §Appendix 24 Execution Engine

**Concept:** The "REQUEST" flow currently works in tests as an in-process Promise mechanism. The real distributed version must:
1. Receive a `BuiltQuery` from the query builder
2. Determine which nodes to query based on ownership
3. Call multiple nodes simultaneously via the mesh transport layer
4. Aggregate results (union/merge as appropriate)
5. Return `QueryResult<T>` with typed items and pagination metadata

**Implementation steps:**
1. Create `MeshCallManyTransportService` that fans out a query to N nodes
2. Implement response merging logic (for union queries on sharded data)
3. Enhance `MeshQueryExecutor.request()` to use the transport layer
4. Integrate with `OwnershipResolverService` for target selection
5. Write integration test: query 2 nodes, verify results are merged

---

### T07 — Real LISTEN flow over distributed query engine with server push envelope pipeline

**Priority:** P1  
**Complexity:** XL  
**Target files:**
- `v3/apps/api/src/core/modules/mesh/services/system-mesh-resource-discovery/system-mesh-resource-discovery.service.ts` (enhance)
- New: `v3/apps/api/src/core/modules/mesh/services/system-mesh-resource-discovery/subscription/mesh-subscription-envelope.service.ts`  
**Depends on:** T06 (REQUEST flow as foundation), T09 (SharedStreamStore)  
**Doc reference:** FULL_MESH_HISTORY.md §4.4 Flow 2 (Listen), §4.7 Implementation Architecture — Query Engine

**Concept:** The "LISTEN" flow currently works in tests as mock Observables. The real distributed version must:
1. Accept a `BuiltQuery` from the query builder
2. Establish SSE stream(s) to the relevant nodes via `SharedStreamStore`
3. Transform incoming `MeshStreamEnvelope` events into typed `ChangeEvent<T>` objects
4. Apply ownership-based filter routing server-side
5. Handle node disconnection + reconnection transparently

**Implementation steps:**
1. Create `MeshSubscriptionEnvelopeService` that bridges SSE envelope pipeline to typed events
2. Integrate with `SharedStreamStore` for reference-counted subscriber management
3. Wire `SystemMeshResourceDiscoveryService.listen()` to use the envelope pipeline
4. Write integration test: subscribe to changes from node A, mutate data on node A, verify event received

---

## Group E: Advanced Multi-Node Patterns

### T10 — Sharded fan-out real multi-node SSE merge with ownership resolver

**Priority:** P2  
**Complexity:** XL  
**Depends on:** T08 (control frames), T07 (LISTEN flow)  
**Doc reference:** FULL_MESH_HISTORY.md §3.3 Sharded, §4.4 Cross-Node Query

**Concept:** Sharded data is partitioned across multiple nodes (e.g., `LiveTraefikMetrics` sharded by `nodeId % shardCount`). A consumer requesting all shards needs:
1. Resolve which nodes hold which shards
2. Open SSE streams to all shard-holding nodes simultaneously
3. Merge events from all streams into a single Observable using RxJS `merge()`
4. Handle shard rebalancing (node removed → stream re-routed)

**Implementation steps:**
1. Enhance `OwnershipResolverService` with shard resolution logic
2. Build multi-stream merge mechanism in the LISTEN pipeline
3. Implement shard rebalancing handling (reconnect to new shard holder)
4. Write integration test: 3 shards on 3 nodes → listen across all → verify events from each shard appear

---

### T01 — Replicated read path chooses nearest/fastest replica by runtime policy

**Priority:** P2  
**Complexity:** L  
**Depends on:** T07 (LISTEN flow)  
**Doc reference:** FULL_MESH_HISTORY.md §3.4 Replicated

**Concept:** Replicated data lives on multiple nodes (e.g., `EnvironmentVariables`, `TLSCertificates`). A read request should:
1. Identify all replicas holding the data
2. Measure/estimate latency to each (from latest health checks or historical metrics)
3. Choose the nearest/fastest replica
4. Fall back on failure

**Implementation steps:**
1. Define `ReplicaSelectionPolicy` interface with strategies: `nearest` (lowest latency), `random`, `round-robin`, `preferred-node`
2. Implement latency tracking in health monitor service
3. Enhance `OwnershipResolverService.resolveOwners()` with replica selection
4. Wire into REQUEST flow so `.request()` on replicated resources uses optimal replica
5. Write tests: latency tracking, selection strategies, failover

---

## Implementation Order (Recommended)

| Phase | Items | Rationale |
|-------|-------|-----------|
| **Phase 1** | T11, T12, T09 | Foundational — everything depends on SharedStreamStore |
| **Phase 2** | T04/T05 | Enhance existing StreamManager with pool lifecycle |
| **Phase 3** | T08 | Control plane frames needed by ownership flows |
| **Phase 4** | T03, T02 | Real SSE integration for global and node-owned resources |
| **Phase 5** | T06, T07 | Distributed query engine with real transport |
| **Phase 6** | T10, T01 | Advanced multi-node patterns on top of completed foundation |

---

## Estimated Effort

| Item | Complexity | Est. Hours | Files Changed |
|------|-----------|-----------|---------------|
| T11 — `computeStreamKey()` | XS | 0.5 | 2 new + 1 barrel |
| T12 — `MeshStreamEventPayload` | XS | 0.5 | 1 new + 1 barrel |
| T09 — `SharedStreamStore` | M | 4 | 3 new + 1 module |
| T04/T05 — Durable stream pool | M | 3 | 1 existing extend |
| T08 — Control frames | L | 6 | 2 existing + 2 new |
| T03 — Global durable stream | L | 8 | 2 existing + 1 new |
| T02 — Node-owned routing | L | 8 | 3 existing + 2 new |
| T06 — REQUEST transport | XL | 12 | 2 existing + 2 new |
| T07 — LISTEN envelope pipeline | XL | 12 | 1 existing + 3 new |
| T10 — Sharded fan-out | XL | 10 | 2 existing + 2 new |
| T01 — Replicated replica selection | L | 6 | 2 existing + 2 new |
| **Total** | | **~70 hrs** | **~30 files** |

---

## Compliance Matrix Updates

After each item is implemented:

1. Replace the `it.todo(...)` in `mesh-doc-compliance-matrix.e2e-spec.ts` with a real `it(...)` test
2. Add the test to the appropriate `describe` section or create a new section
3. Add the file reference to `FULL_MESH_HISTORY.md` §5 Test Coverage & Compliance table
4. Update the coverage percentage for the affected section

For T04/T05 (duplicate), after both are implemented, remove one `it.todo` entry and note the deduplication in the compliance matrix.
