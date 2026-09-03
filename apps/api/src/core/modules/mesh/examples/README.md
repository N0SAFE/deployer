# Mesh System Examples

This directory contains a comprehensive, real-world example of the mesh resource discovery system.

## Overview

The example implements a **Deployment Management** domain with two main components:

1. **TestDeploymentMeshService** - A mesh service that exposes deployment data as queryable entities
2. **TestDeploymentConsumerService** - A consumer service demonstrating how to use the discovery system

## Files

| File | Purpose |
|------|---------|
| `test-deployment-mesh.service.ts` | Mesh service with entity definitions (deployments, logs) |
| `test-deployment-consumer.service.ts` | Consumer demonstrating all discovery patterns |
| `test-deployment-mesh.module.ts` | NestJS module with mock infrastructure |
| `test-deployment-mesh.spec.ts` | Comprehensive test suite (Vitest) |
| `test-deployment-mesh.example.ts` | Runnable usage examples |
| `index.ts` | Public exports |
| `README.md` | This file |

## Quick Start

### 1. Import the Module

```typescript
import { TestDeploymentMeshModule } from "./examples";

@Module({
  imports: [TestDeploymentMeshModule],
})
export class MyModule {}
```

### 2. Use the Consumer Service

```typescript
import { TestDeploymentConsumerService } from "./examples";

@Injectable()
export class MyService {
  constructor(private consumer: TestDeploymentConsumerService) {}

  async example() {
    // Get running production deployments
    const deployments = await this.consumer.getRunningProductionDeployments();

    // Get health report
    const report = await this.consumer.generateHealthReport();

    // Find unhealthy deployments
    const issues = await this.consumer.findUnhealthyDeployments();
  }
}
```

## Entity Definitions

### Deployment Entity

```typescript
const deployments = meshEntity({
  key: "deployments",
  item: deploymentSchema,  // Zod schema
  itemKey: "deploymentId", // Primary key field
  queries: {
    list: meshQuery(...),      // List with filters
    findById: meshQuery(...),  // Single item lookup
    search: meshQuery(...),    // Text search
  },
  mutations: {
    create: meshMutation(...),
    update: meshMutation(...),
    delete: meshMutation(...),
    restart: meshMutation(...),  // Custom action
    scale: meshMutation(...),    // Custom action
  },
});
```

### Deployment Log Entity

```typescript
const deploymentLogs = meshEntity({
  key: "deploymentLogs",
  item: deploymentLogSchema,
  itemKey: "logId",
  queries: {
    list: meshQuery(...),   // Filtered list
    stream: meshQuery(...), // Real-time stream
  },
  mutations: {
    delete: meshMutation(...),
  },
});
```

## Consumer Patterns

### Basic Query

```typescript
const result = await this.discovery
  .from(TestDeploymentMeshService.queries.deployments)
  .where({ environment: "prod" })
  .where({ status: "running" })
  .orderBy("createdAt", "desc")
  .limit(100)
  .execute();
```

### Functional Where (Type-Safe)

```typescript
import { eq, and, gt } from "../services/system-mesh-resource-discovery/query/mesh-where";

const result = await this.discovery
  .from(TestDeploymentMeshService.queries.deployments)
  .where(
    and(
      eq("environment", "prod"),  // ✅ Type-safe: must be "prod" | "staging" | "dev"
      eq("status", "running"),     // ✅ Type-safe: must be "pending" | "running" | ...
      gt("replicas", 2)            // ✅ Type-safe: only works on number fields
    )
  )
  .execute();
```

### Projection (Select)

```typescript
// Result type is Pick<Deployment, "deploymentId" | "status" | "environment">
const summaries = await this.discovery
  .from(TestDeploymentMeshService.queries.deployments)
  .select(["deploymentId", "status", "environment"])
  .limit(1000)
  .execute();
```

### Streaming

```typescript
async *streamDeploymentUpdates() {
  const stream = this.discovery
    .from(TestDeploymentMeshService.queries.deployments)
    .where({ status: "running" })
    .stream();

  for await (const deployment of stream) {
    yield deployment;
  }
}
```

### Scoped Queries

```typescript
const deployments = await this.discovery
  .from(TestDeploymentMeshService.queries.deployments)
  .scope({
    organizationId: "org-123",
    strategy: "broadcast-merge",  // or "local-only", "direct-node"
    timeoutMs: 5000,
  })
  .where({ status: "running" })
  .execute();
```

### Query Introspection

```typescript
const builder = this.discovery
  .from(TestDeploymentMeshService.queries.deployments)
  .where({ environment: "prod" })
  .limit(100);

// Get structured plan
const plan = this.discovery.explain(builder);

// Get formatted string
const formatted = this.discovery.explainFormatted(builder);
console.log(formatted);
// Output:
// MeshQueryPlan {
//   entity: deployments
//   method: list
//   strategy: broadcast-merge
//   depth: 0
//   where: [
//     [object] { environment, status }
//   ]
//   page: limit=100 offset=0
// }
```

## Aggregations

The aggregate API is designed to work with distributed data:

```typescript
const stats = await this.discovery
  .from(TestDeploymentMeshService.queries.deployments)
  .aggregate({
    total: count(),
    byStatus: groupBy("status", count()),
    avgReplicas: avg("replicas"),
    maxReplicas: max("replicas"),
  })
  .execute();

// Result:
// {
//   total: 42,
//   byStatus: { running: 35, stopped: 5, failed: 2 },
//   avgReplicas: 3.5,
//   maxReplicas: 10
// }
```

## Type Safety

### Compile-Time Verification

```typescript
// ✅ Valid - environment is typed as "prod" | "staging" | "dev"
.where({ environment: "prod" })

// ❌ Error - "production" is not a valid environment
.where({ environment: "production" })

// ✅ Valid - replicas is a number
.where({ replicas: 3 })

// ❌ Error - can't use gt() on non-numeric field
.where(gt("environment", 5))

// ✅ Valid - select only existing fields
.select(["deploymentId", "status"])

// ❌ Error - "invalidField" doesn't exist on Deployment
.select(["deploymentId", "invalidField"])
```

### Inferred Result Types

```typescript
// Type: MeshQueryResult<Deployment>
const full = await discovery
  .from(TestDeploymentMeshService.queries.deployments)
  .execute();

// Type: MeshQueryResult<Pick<Deployment, "deploymentId" | "status">>
const partial = await discovery
  .from(TestDeploymentMeshService.queries.deployments)
  .select(["deploymentId", "status"])
  .execute();
```

## Running the Examples

### Unit Tests

```bash
# From v3/apps/api
cd /home/sebille/Bureau/projects/tests/deployer/v3/apps/api
bun test src/core/modules/mesh/examples/test-deployment-mesh.spec.ts
```

### Manual Testing

```typescript
// In a NestJS application
const module = await Test.createTestingModule({
  imports: [TestDeploymentMeshModule],
}).compile();

const consumer = module.get(TestDeploymentConsumerService);

// Run examples
const deployments = await consumer.getRunningProductionDeployments();
const report = await consumer.generateHealthReport();
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    TestDeploymentConsumerService                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Uses SystemMeshResourceDiscoveryService                 │   │
│  │  - from()  → creates typed query builder                │   │
│  │  - query() → convenience method                         │   │
│  │  - explain() → query introspection                      │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  MeshQueryBuilder<TItem, TResult>               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  - where()  → filters (object or expression)            │   │
│  │  - select() → projections                               │   │
│  │  - orderBy() → sorting                                  │   │
│  │  - limit() / offset() → pagination                      │   │
│  │  - scope() → execution strategy                         │   │
│  │  - join() → cross-entity queries                        │   │
│  │  - execute() → run query                                │   │
│  │  - stream() → async generator                           │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MeshQueryExecutor                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  1. Collect from nodes (MeshNodeCaller)                  │   │
│  │  2. Deduplicate by itemKey                               │   │
│  │  3. Apply where clauses                                  │   │
│  │  4. Apply ordering                                       │   │
│  │  5. Execute joins                                        │   │
│  │  6. Apply projections                                    │   │
│  │  7. Apply pagination                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   TestDeploymentMeshService                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Entities:                                               │   │
│  │    - deployments (queries: list, findById, search)       │   │
│  │    - deploymentLogs (queries: list, stream)              │   │
│  │                                                          │   │
│  │  Each entity has:                                        │   │
│  │    - itemSchema (Zod)                                    │   │
│  │    - itemKey (primary key field)                         │   │
│  │    - queries (typed operations)                          │   │
│  │    - mutations (typed operations)                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Extending the Example

### Adding a New Entity

1. Define the Zod schema
2. Create the entity with `meshEntity()`
3. Add queries and mutations
4. Export from the service

### Adding Custom Operations

```typescript
// In your mesh service
static readonly customOperations = {
  bulkRestart: meshMutation(
    z.object({ deploymentIds: z.array(z.string()) }),
    z.object({ restarted: z.number() })
  ),
};

// In consumer
async bulkRestart(deploymentIds: string[]) {
  // Implementation
}
```

## Key Takeaways

1. **Entities are typed** - Zod schemas provide runtime validation and TypeScript types
2. **Queries are composable** - Chain where, select, orderBy, limit
3. **Results are inferred** - TypeScript knows the exact shape of query results
4. **Distributed by default** - Queries automatically aggregate from all nodes
5. **Introspectable** - Explain queries to see execution plans
6. **Streaming support** - Real-time updates via async generators
