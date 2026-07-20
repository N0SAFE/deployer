# Mesh Resource Access Architecture — Proposal v1

## Overview

A unified, service-based architecture for cross-mesh resource access with full JOIN support. Every mesh entity extends a single `MeshResourceService` base class, exposes typed ORPC contracts, and can be joined with any other entity in a single query.

---

## 1. Entity Definition — Canonical Style

One style, one way. Deprecate `primitives.ts` style entirely.

```typescript
// ─── packages/contracts/entities/src/entities/deployment/deployment.entity.ts ───
import { z } from "zod/v4";
import { meshEntity } from "@/core/modules/mesh/mesh-entity";

// Schema (data shape)
export const deploymentSchema = z.object({
  deploymentId: z.string().min(1),
  projectId: z.string().min(1),
  environment: z.enum(["dev", "staging", "prod"]),
  status: z.enum(["pending", "deploying", "active", "failed", "rolled-back"]),
  nodeId: z.string().min(1),
  imageTag: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});

export type Deployment = z.infer<typeof deploymentSchema>;

// Entity (operations)
export const deploymentEntity = meshEntity({
  key: "deployments",
  item: deploymentSchema,
  itemKey: "deploymentId",
  queries: {
    list: meshQuery(
      z.object({
        filter: deploymentSchema.partial().optional(),
        pagination: z.object({
          limit: z.number().int().positive().default(20),
          offset: z.number().int().nonnegative().default(0),
        }).optional(),
        sort: z.object({
          field: z.string(),
          direction: z.enum(["asc", "desc"]).default("asc"),
        }).optional(),
      }),
      deploymentSchema,
    ),
    getById: meshQuery(
      z.object({ deploymentId: z.string().min(1) }),
      deploymentSchema,
    ),
  },
  mutations: {
    create: meshMutation(
      z.object({ data: deploymentSchema }),
      deploymentSchema,
    ),
    update: meshMutation(
      z.object({
        deploymentId: z.string().min(1),
        data: deploymentSchema.partial(),
      }),
      deploymentSchema,
    ),
    delete: meshMutation(
      z.object({ deploymentId: z.string().min(1) }),
      z.object({ deleted: z.boolean() }),
    ),
  },
});
```

---

## 2. Base Service — `MeshResourceService<TEntity>`

Abstract generic base class that all entity services extend. Replaces the `BaseMeshService()` factory pattern with a proper class hierarchy.

```typescript
// ─── packages/nest/mesh-resource-service.ts ───
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import type { z } from "zod/v4";
import type { Observable } from "rxjs";
import type {
  AnyMeshEntity,
  MeshEntityItem,
  MeshEntityChangeEvent,
} from "@/core/modules/mesh/mesh-entity";
import type { MeshQueryRef } from "@/core/modules/mesh/services/system-mesh-resource-discovery/query/mesh-query-builder-types";
import { MeshQueryBuilder } from "@/core/modules/mesh/services/system-mesh-resource-discovery/query/mesh-query-builder";
import { MeshQueryExecutor } from "@/core/modules/mesh/services/system-mesh-resource-discovery/query/mesh-query-executor";

/**
 * Abstract base class for all mesh entity services.
 *
 * @template TEntity - The MeshEntity type this service manages
 *
 * @example
 * class DeploymentsService extends MeshResourceService<typeof deploymentEntity> {
 *   constructor(executor: MeshQueryExecutor) {
 *     super(executor, deploymentEntity);
 *   }
 * }
 */
export abstract class MeshResourceService<
  TEntity extends AnyMeshEntity = AnyMeshEntity,
> implements OnModuleInit, OnModuleDestroy {
  readonly entity: TEntity;
  readonly entityKey: string;
  readonly itemSchema: TEntity["item"];
  readonly itemKey: TEntity["itemKey"];

  protected readonly logger: Logger;
  protected readonly executor: MeshQueryExecutor;

  constructor(
    executor: MeshQueryExecutor,
    entity: TEntity,
  ) {
    this.executor = executor;
    this.entity = entity;
    this.entityKey = entity.key;
    this.itemSchema = entity.item;
    this.itemKey = entity.itemKey;
    this.logger = new Logger(`MeshResourceService(${entity.key})`);
  }

  // ─── Lifecycle ────────────────────────────────────────────────
  onModuleInit(): void {
    this.logger.log(`Initialized mesh resource: ${this.entityKey}`);
  }

  onModuleDestroy(): void {
    this.logger.log(`Destroyed mesh resource: ${this.entityKey}`);
  }

  // ─── Query API ────────────────────────────────────────────────

  /**
   * Creates a typed query builder starting from this entity.
   * This is the PRIMARY entry point for reading data.
   *
   * @example
   * const deployments = await service
   *   .from("list")
   *   .where({ environment: "prod" })
   *   .orderBy("createdAt", "desc")
   *   .limit(10)
   *   .request();
   *
   * // With a JOIN to projects
   * const withProjects = await service
   *   .from("list")
   *   .join(projectService, {
   *     on: (deployment, project) => deployment.projectId === project.projectId,
   *     type: "left",
   *     alias: "project",
   *   })
   *   .where({ environment: "prod" })
   *   .select(["deploymentId", "environment", "project.name"])
   *   .request();
   */
  from<TMethodName extends keyof TEntity["queries"] & string>(
    methodName: TMethodName,
  ): MeshQueryBuilder<MeshEntityItem<TEntity>, MeshEntityItem<TEntity>> {
    const queryRef: MeshQueryRef<MeshEntityItem<TEntity>> =
      this.entity.queries[methodName] as MeshQueryRef<MeshEntityItem<TEntity>>;
    return MeshQueryBuilder.create<MeshEntityItem<TEntity>>(this.executor, queryRef);
  }

  // ─── Convenience methods ─────────────────────────────────────

  /** Simple get-by-id */
  async getById(
    id: string,
  ): Promise<MeshEntityItem<TEntity> | null> {
    const result = await this.from("getById" as any)
      .where({ [this.itemKey]: id } as any)
      .request();
    return result.items[0] ?? null;
  }

  /** Simple list with optional filter */
  async list(
    filter?: Partial<MeshEntityItem<TEntity>>,
  ): Promise<MeshEntityItem<TEntity>[]> {
    const builder = this.from("list" as any);
    const query = filter ? builder.where(filter as any) : builder;
    const result = await query.request();
    return result.items as MeshEntityItem<TEntity>[];
  }

  // ─── Join helpers ────────────────────────────────────────────

  /**
   * Creates a join descriptor for use with another service's entities.
   *
   * @example
   * service
   *   .from("list")
   *   .join(
   *     projectService.joinOn("projectId", "projectId", "project", "left"),
   *   )
   *   .request();
   */
  joinOn<TRightItem>(
    leftField: keyof MeshEntityItem<TEntity> & string,
    rightField: keyof TRightItem & string,
    alias: string,
    type: "left" | "inner" = "left",
  ): MeshJoinSpec<MeshEntityItem<TEntity>, TRightItem> {
    return {
      leftField,
      rightField,
      alias,
      type,
      leftEntityKey: this.entityKey,
    };
  }
}

// ─── Join spec type ──────────────────────────────────────────────

export interface MeshJoinSpec<TLeft, TRight> {
  leftField: keyof TLeft & string;
  rightField: keyof TRight & string;
  alias: string;
  type: "left" | "inner";
  leftEntityKey: string;
}
```

**Key improvements over current `BaseMeshService()` factory:**
- Proper generic class hierarchy: `MeshResourceService<TEntity>`
- `from()` takes a method name string (not a raw query ref) — better DX
- `joinOn()` returns typed join specs that integrate with the builder's `.join()` method
- Convenience methods: `getById()`, `list()`
- No topic lifecycle management — handled by the executor layer
- Single entity per service (not multiple entities) — cleaner separation

---

## 3. Join System Design

### 3.1 Join Builder API

```typescript
// On a MeshQueryBuilder<TItem, TResultShape>:

join<TAlias extends string, TRight, TType extends MeshJoinType>(
  rightService: { from(method: string): MeshQueryBuilder<TRight, TRight> },
  spec: {
    on: (left: TItem, right: TRight) => boolean,
    alias: TAlias,
    type?: TType,
  },
): MeshQueryBuilder<TItem, MeshJoinResultShape<TResultShape, TAlias, TRight, TType>>
```

### 3.2 Type-Level Join Resolution

```typescript
// The recursive type that computes the final result shape:

type JoinSpec = {
  alias: string;
  type: "left" | "inner";
  rightBuilder: MeshQueryBuilder<any, any>;
  predicate: (left: any, right: any) => boolean;
};

// AccumulateJoins — folds a tuple of joins into the final shape
type AccumulateJoins<
  TBase,
  TJoins extends readonly JoinSpec[],
> =
  TJoins extends readonly []
    ? TBase
    : TJoins extends readonly [infer THead, ...infer TTail]
      ? THead extends JoinSpec
        ? THead["type"] extends "inner"
          ? AccumulateJoins<
              TBase & Record<THead["alias"], THead["rightBuilder"]["_state"]["query"]["outputSchema"]>,
              TTail extends readonly JoinSpec[] ? TTail : []
            >
          : AccumulateJoins<
              TBase & Record<THead["alias"], THead["rightBuilder"]["_state"]["query"]["outputSchema"] | null>,
              TTail extends readonly JoinSpec[] ? TTail : []
            >
        : TBase
      : TBase;
```

### 3.3 Runtime Join Execution

```typescript
// Inside MeshQueryExecutor:

async executeJoins<TItem>(
  items: TItem[],
  joins: JoinSpec[],
): Promise<any[]> {
  let result = items.map((item) => ({ ...item }));

  for (const join of joins) {
    // 1. Execute the joined query (no where — full result set)
    const rightResult = await join.rightBuilder.request();
    const rightItems = rightResult.items;

    // 2. Stitch using the predicate function
    result = result.map((left) => {
      const matched = rightItems.filter((right) =>
        join.predicate(left, right),
      );

      if (join.type === "inner") {
        // Inner join: keep left only if match found
        // For simple joins, take first match (for 1:1 / N:1)
        return matched.length > 0
          ? { ...left, [join.alias]: matched[0] }
          : null;
      } else {
        // Left join: always keep left, null if no match
        return {
          ...left,
          [join.alias]: matched.length > 0 ? matched[0] : null,
        };
      }
    }).filter(Boolean) as any[];
  }

  return result;
}
```

---

## 4. Fluent Query Builder — Final API

```typescript
// Usage examples demonstrating DX focus:

// Example 1: Simple list with filter
const prodDeployments = await deploymentsService
  .from("list")
  .where({ environment: "prod" })
  .orderBy("createdAt", "desc")
  .limit(20)
  .request();
// Result: { items: Deployment[], total: number, hasMore: boolean }

// Example 2: Single item
const deployment = await deploymentsService
  .from("getById")
  .where({ deploymentId: "dep-123" })
  .request();
// Result: { items: Deployment[] } (0 or 1)

// Example 3: JOIN with project
const deploymentsWithProjects = await deploymentsService
  .from("list")
  .join(projectsService, {
    on: (d, p) => d.projectId === p.projectId,
    alias: "project",
    type: "left",
  })
  .where({ environment: "prod" })
  .select(["deploymentId", "environment", "status"])
  .request();
// Result type: Deployment & { project: Project | null }
// Runtime items have both deployment fields AND a nested "project" property

// Example 4: Multiple JOINs (3-way)
const fullData = await deploymentsService
  .from("list")
  .join(projectsService, {
    on: (d, p) => d.projectId === p.projectId,
    alias: "project",
  })
  .join(usersService, {
    on: (d, u) => d.nodeId === u.nodeId,
    alias: "deployedBy",
  })
  .where({ "project.name": { like: "%production%" } })
  .limit(50)
  .request();
// Result type: Deployment & { project: Project | null } & { deployedBy: User | null }
```

---

## 5. Unified CRUD Contract Generator

ORPC contracts auto-generated from entity definitions:

```typescript
// ─── packages/contracts/api/modules/mesh/resource/entity-contract.ts ───

import { z } from "zod/v4";
import { standard, meshDomainErrorContracts } from "@repo/orpc-utils";
import type { AnyMeshEntity } from "@/core/modules/mesh/mesh-entity";
import type { MeshQuery, MeshQueryInput, MeshQueryOutput } from "@/core/modules/mesh/mesh-query";
import type { MeshMutation, MeshMutationInput, MeshMutationOutput } from "@/core/modules/mesh/mesh-mutation";

/**
 * Generates a full set of ORPC contracts from a mesh entity definition.
 *
 * Returns a typed object with contract accessors for each query and mutation.
 *
 * @example
 * const contracts = generateEntityContracts(deploymentEntity);
 * // contracts.queries.list     → ORPC contract for listing
 * // contracts.queries.getById  → ORPC contract for getById
 * // contracts.mutations.create → ORPC contract for create
 */
export function generateEntityContracts<TEntity extends AnyMeshEntity>(
  entity: TEntity,
  prefix: string = `/api/mesh/${entity.key}`,
) {
  const queryContracts = {} as Record<string, any>;
  const mutationContracts = {} as Record<string, any>;

  for (const [name, query] of Object.entries(entity.queries)) {
    const q = query as unknown as MeshQuery<any, any>;
    const schema = q.outputSchema;
    const ops = standard.zod(schema, `mesh:${entity.key}:${name}`);

    queryContracts[name] = ops
      .read()
      .path(`${prefix}/${name}`)
      .input((b: any) => b.body(q.inputSchema))
      .output((b: any) => b.body(
        z.object({
          items: z.array(schema),
          total: z.number().int().nonnegative(),
          hasMore: z.boolean(),
        }),
      ))
      .errors((e: any) => meshDomainErrorContracts(e))
      .build();
  }

  for (const [name, mutation] of Object.entries(entity.mutations)) {
    const m = mutation as unknown as MeshMutation<any, any>;
    const schema = m.outputSchema;
    const ops = standard.zod(schema, `mesh:${entity.key}:${name}`);

    mutationContracts[name] = ops
      .create()
      .path(`${prefix}/${name}`)
      .input((b: any) => b.body(m.inputSchema))
      .output((b: any) => b.body(m.outputSchema))
      .errors((e: any) => meshDomainErrorContracts(e))
      .build();
  }

  return { queries: queryContracts, mutations: mutationContracts };
}
```

---

## 6. Cross-Mesh Execution — Real MeshNodeCaller

Replace `StubMeshNodeCaller` with a real implementation using ORPC HTTP calls:

```typescript
// ─── services/system-mesh-resource-discovery/query/mesh-node-caller.ts ───

@Injectable()
export class MeshContractCaller implements MeshNodeCaller {
  private readonly logger = new Logger(MeshContractCaller.name);

  constructor(
    private readonly topologyService: SystemMeshTopologyService,
    private readonly meshConfig: SystemMeshConfigService,
    private readonly httpService: HttpService,  // NestJS HttpService or custom
  ) {}

  async callMany<TItem>(
    entityKey: string,
    methodName: string,
    payload: Record<string, unknown>,
    options: { organizationId?: string | null; timeoutMs?: number },
  ): Promise<readonly { nodeId: string; items: readonly TItem[]; durationMs: number }[]> {
    const localNodeId = this.meshConfig.getNodeId();
    const peers = this.topologyService.getConnectedPeers();
    
    if (peers.length === 0) return [];

    const timeout = options.timeoutMs ?? 3_000;
    const start = Date.now();

    const results = await Promise.allSettled(
      peers
        .filter((peer) => peer.nodeId !== localNodeId)
        .map(async (peer) => {
          const peerStart = Date.now();
          const url = `${peer.baseUrl}/api/mesh/${entityKey}/${methodName}`;
          
          const response = await firstValueFrom(
            this.httpService.post(url, payload, {
              headers: {
                "x-mesh-internal-key": signMeshToken(this.meshConfig.getSharedSecret()),
                "x-request-id": randomUUID(),
              },
              timeout,
            }),
          );

          return {
            nodeId: peer.nodeId,
            items: (response.data as any)?.items ?? [],
            durationMs: Date.now() - peerStart,
          };
        }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
      .map((r) => r.value);
  }
}
```

---

## 7. DI & Module Wiring

```typescript
// ─── mesh-core.module.ts (simplified) ───

@Module({
  imports: [EventsModule, DatabaseModule, MeshInitializationModule],
  providers: [
    // Infrastructure
    MeshQueryExecutor,
    {
      provide: MESH_NODE_CALLER_TOKEN,
      useClass: MeshContractCaller,  // ← replaces StubMeshNodeCaller
    },
    MeshContractCaller,
    MeshContractRegistry,

    // Topology
    ...MESH_TOPOLOGY_SERVICES,
    SystemMeshTopologyService,

    // Topics
    ...MESH_TOPIC_SERVICES,
    SystemMeshTopicService,
  ],
  exports: [
    MeshQueryExecutor,
    MeshContractCaller,
    MeshContractRegistry,
    SystemMeshTopologyService,
    SystemMeshTopicService,
  ],
})
export class MeshCoreModule {}

// ─── deployment.module.ts (per-entity module) ───

@Module({
  imports: [MeshCoreModule],
  providers: [DeploymentsService],
  exports: [DeploymentsService],
})
export class DeploymentModule {}
```

---

## 8. Error Handling & Streaming

```typescript
// Error pipeline: MeshNotFoundError → ORPC NOT_FOUND → HTTP 404
throw new MeshNotFoundError("deployment", "dep-123");

// Streaming with RxJS
const liveUpdates$ = deploymentsService
  .from("list")
  .where({ environment: "prod" })
  .stream();  // Observable<Deployment[]> — emits on each change

// Change detection via mesh topics
const changes$ = topologyService.observeEntityEvents$("deployments");
// Observable<MeshEntityChangeEvent<Deployment>>
// Events: { type: "created" | "updated" | "deleted", item: Deployment }
```

---

## 9. Comparison Summary

| Aspect | Current | Proposed |
|--------|---------|----------|
| Entity style | Two styles (primitives.ts + mesh-entity.ts) | Single style (mesh-entity.ts only) |
| Base service | Factory pattern (`BaseMeshService(config)`) | Generic class (`MeshResourceService<TEntity>`) |
| Entity per service | Multiple per factory | Single per service |
| Cross-node execution | Stub (returns `[]`) | Real HTTP via `MeshContractCaller` |
| Join API | `join(configurator)` with phantom types | `join(service, { on, alias, type })` with predicate |
| Query entry | `discovery.from(queryRef)` raw ref | `service.from("methodName")` by name |
| Convenience | None | `getById()`, `list()` |
| ORPC contracts | Manual in separate files | Auto-generated from entity |
| Error handling | AppError hierarchy | Same + MeshNotFoundError etc. |
| Module wiring | Manual provider registration | Standard NestJS per-entity modules |
