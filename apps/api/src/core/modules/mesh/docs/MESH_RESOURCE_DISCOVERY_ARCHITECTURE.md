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
