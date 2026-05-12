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