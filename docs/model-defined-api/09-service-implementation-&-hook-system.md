# 09 — Service Implementation & Hook System

This document explains how **model services** implement the builder intent system. A model service is the single orchestrator for its model — it owns all the logic for how data is fetched, written, validated, and composed, regardless of where that data lives.

> **Status**: New feature blueprint for future modules.  
> **Important**: This is additive to current v3 architecture and must be wired to existing modules, not replace them.

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [The Model Service as Orchestrator](#the-model-service-as-orchestrator)
3. [Service Type Parameters](#service-type-parameters)
4. [What a Service Orchestrates](#what-a-service-orchestrates)
5. [Hook System](#hook-system)
6. [Hook Lifecycle — Reads](#hook-lifecycle--reads)
7. [Hook Lifecycle — Writes](#hook-lifecycle--writes)
8. [Hook Context](#hook-context)
9. [Hook Registration](#hook-registration)
10. [Built-in Hooks](#built-in-hooks)
11. [Custom Hooks](#custom-hooks)
12. [Relation Resolution](#relation-resolution)
13. [Transaction Support](#transaction-support)
14. [Caching Layer](#caching-layer)
15. [Event System](#event-system)
16. [Error Handling](#error-handling)
17. [Testing](#testing)
18. [Guardrails](#guardrails)

---

## Philosophy

- The **model service is the single source of truth** for everything related to its model.
- Controllers express **intent** via the builder. The model service decides **how to fulfill it**.
- The service is free to call **repositories, model capabilities via core ports/facades, external APIs, or any combination** — the caller never knows or cares.
- **Hooks** give the service fine-grained control over every stage of every operation without scattering logic across layers.
- **Everything is inferred from the model**. Hook handlers, context objects, and event payloads are all typed against `InferModel<TSchema>`. There is no `any` in the public surface.

---

## Continuity with existing v3 architecture

This proposal must stay aligned with the current project rules:

1. Controllers remain thin ORPC handlers (`@Implement` + `implement(...).use(requireAuth())`).
2. Services remain the business orchestration layer.
3. Repositories remain Drizzle-query-only execution layer.
4. No cross-feature service imports; shared modeling utilities move to `core/modules/*`.
5. Contracts stay contract-first with `standard.zod(...)` and list config builders.

### Concrete wiring targets in this repository

- **Auth middleware**: `v3/apps/api/src/core/modules/auth/orpc/middlewares.ts`
- **Project role guard service**: `v3/apps/api/src/core/modules/project/services/project-access.service.ts`
- **Feature controllers/services/repositories**: `v3/apps/api/src/modules/<feature>/...`
- **Contract modules**: `v3/packages/contracts/api/modules/<feature>/...`
- **Frontend domain hooks**: `v3/apps/web/src/domains/<feature>/...`

---

## Placement for new hook/builder infrastructure

To avoid feature-to-feature coupling, place reusable framework pieces under:

```text
v3/apps/api/src/core/modules/modeling/
  services/
  hooks/
  intent/
  policy/
  module.ts
```

Feature modules adopt this infrastructure via dependency injection.

---

## The Model Service as Orchestrator

A model service receives a compiled intent from the builder and is **fully responsible** for fulfilling it. It decides:

- Which **repository** to call for persistence
- Which **other model capabilities** (via core ports/facades) to call for related data
- Which **external APIs** to call for enrichment or live data
- What **business rules** to enforce before and after each operation
- What **events** to emit after a write
- What to **cache** and when to invalidate it

```
Controller
  │
  │  CompiledQueryIntent<TSchema>
  ▼
┌──────────────────────────────────────────────────────────┐
│  DockerModelService  (orchestrator)                      │
│                                                          │
│  → DockerRepository          (persistence)               │
│  → NetworkCapabilityPort     (related capability)        │
│  → VolumeCapabilityPort      (related capability)        │
│  → DockerMetricsApiClient    (external enrichment)       │
│  → AuditService              (cross-cutting concern)     │
│  → CacheService              (cross-cutting concern)     │
└──────────────────────────────────────────────────────────┘
  │
  │  Array<InferModel<TSchema>>
  ▼
Controller
```

The controller sees none of this. It only calls `.execute()` on the builder and receives a typed result.

In this project, `.execute()` should still route through the feature service (`ProjectService`, `ServiceService`, etc.), which then coordinates repository + policy + relation resolution.

---

## Compiled intent contract (aligned with deep builders)

For new builder-based features, services should receive a compiled query intent that is already split by concern (instead of raw query objects).

```ts
type CompiledQueryIntent<TSchema> = {
  pathRegistryPlan: PathRegistryPlan<TSchema>;
  projectionPlan: ProjectionPlan<TSchema>;
  filterPlan: FilterPlan<TSchema>;
  wherePlan: WherePlan<TSchema>;
  sortPlan: SortPlan<TSchema>;
  paginationPlan: PaginationPlan;
  includePlan: IncludePlan;
  redactionPlan: RedactionPlan;
  policyPlan: PolicyPlan;
  diagnostics: BuilderDiagnostics;
};
```

This matches the deep builder dimensions documented in `08-advanced-builder-control-patterns.md` (`fields`, `filter`, `where`, `sort`, `pagination`, `includes`).

### Nested-property guarantees for compiled intent

Compiled intent should guarantee that all nested paths are already validated and typed:

- scalar paths (`name`)
- nested object paths (`owner.profile.displayName`)
- array paths (`deployments[].status`)
- nested array paths (`services[].ports[].public`)
- relation paths from `z.lazy` graph (`services.deployments.latest.status`)

If a path is missing from `pathRegistryPlan`, it must not reach repository execution.

### Repository consumption boundary

Repositories should consume only the compiled plan pieces they need:

- `pathRegistryPlan` (resolved path-to-column/path binding)
- `wherePlan`
- `sortPlan`
- `paginationPlan`
- `projectionPlan`

Policy, redaction, and relation orchestration stay in service/hook layers.

### Compiled command intent (nested write parity)

Write flows should use a compiled command intent with nested patch controls:

```ts
type CompiledCommandIntent<TSchema> = {
  targetPlan: TargetPlan;
  patchPlan: PatchPlan<TSchema>;            // nested set/unset/merge/array item operations
  writePathPlan: WritePathPlan<TSchema>;    // allow/deny + immutable paths
  transitionPlan: TransitionPlan<TSchema>;  // state transition guards
  idempotencyPlan: IdempotencyPlan;
  policyPlan: PolicyPlan;
  redactionPlan: RedactionPlan;
  diagnostics: BuilderDiagnostics;
};
```

Unknown or forbidden nested patch paths must fail during command compilation (before repository writes).

---

## Service Type Parameters

Every model service is parameterized by five types. All generics in the hook system and event system flow from these.

```ts
class BaseModelService<
  TSchema extends AnyZodObject,       // the entity shape
  TRelations extends RelationMap,     // declared relations + target services
  TFilters extends AnyZodObject,      // allowed filter fields + operators
  TSorts extends AnyZodObject,        // allowed sort fields
  TCommands extends CommandMap,       // available write operations
>
```

Every service **must** expose these as readonly properties so the builder and hook system can read them at compile time:

| Property | Purpose |
|---|---|
| `$model` | Zod schema — source of truth for all field types |
| `$relations` | Relation graph — target services, cardinality, foreign keys |
| `$filters` | Allowed filter fields and their operators |
| `$sorts` | Allowed sort fields |
| `$commands` | Available write operations with input/output schemas |

---

## What a Service Orchestrates

The service has **full freedom** in how it fulfills an intent. There are no constraints on what it can call internally. Common patterns:

### Repository calls
The service calls its own repository for persistence operations. The repository is the only place where raw database queries execute. The service translates the compiled intent into repository method calls.

### Other model capabilities
For relation loading, the service calls the **target model capability via core ports/facades** — not a direct cross-feature service import, and never the target repository directly. This ensures the target pipeline (policy, caching, business rules) is respected while preserving module boundaries.

### External APIs
The service can call external APIs directly (or via a typed client) for enrichment, live data, or write-through operations. This is done in `afterRead` hooks or as part of a write pipeline.

### Hybrid reads
A service can combine data from multiple sources in a single response — for example, fetching base records from the repository and enriching them with live data from an external API before returning to the caller.

### Example: DockerModelService orchestration

```ts
// When executeQueryIntent is called, the service:
// 1. Calls DockerRepository.findMany(intent) for base records
// 2. Calls DockerMetricsApi.getBulkStats(ids) to enrich with live CPU/memory
// 3. Calls VolumeCapabilityPort.executeQueryIntent(subIntent) for included volumes
// 4. Calls NetworkCapabilityPort.executeQueryIntent(subIntent) for included network
// 5. Stitches everything together and returns typed results
```

The controller wrote:
```ts
from(DockerCapabilityPort)
  .select({ id: true, name: true, cpuUsage: true })
  .include({ volumes: true, network: true })
  .execute()
```

It has no idea three data sources and two other capabilities were involved.

---

## Hook System

Hooks are **typed, ordered functions** registered on a service. They run at specific points in the read or write pipeline and give the service fine-grained control over every operation.

Every hook handler receives a **context object** typed against `InferModel<TSchema>` — accessing a field that doesn't exist on the model is a compile-time error.

### What hooks can do

| Capability | Example |
|---|---|
| Modify the intent | Inject a tenant filter before every read |
| Short-circuit execution | Return cached data, skip repository entirely |
| Validate data | Reject a create if a business rule is violated |
| Transform data | Inject default values, normalize fields |
| Enrich results | Attach live metrics or computed fields after read |
| Redact results | Strip sensitive fields based on caller role |
| Trigger side effects | Send notifications, write audit logs |
| Wrap execution | Add transactions, retries, distributed locks |
| Convert operations | Turn a delete into a soft-delete (update) |

### Hook types

| Hook | Phase | Receives |
|---|---|---|
| `beforeRead` | Before repository.findMany | Mutable intent |
| `afterRead` | After repository.findMany | Mutable result |
| `beforeCreate` | Before repository.create | Mutable data |
| `afterCreate` | After repository.create | Result |
| `beforeUpdate` | Before repository.update | Mutable data + existing record |
| `afterUpdate` | After repository.update | Result |
| `beforeDelete` | Before repository.delete | Existing record |
| `afterDelete` | After repository.delete | Deleted record |
| `beforeBulkCreate` | Before repository.createMany | Mutable data array |
| `afterBulkCreate` | After repository.createMany | Result array |
| `beforeBulkUpdate` | Before repository.updateMany | Mutable data + where |
| `afterBulkUpdate` | After repository.updateMany | Count result |
| `beforeBulkDelete` | Before repository.deleteMany | Where clause |
| `afterBulkDelete` | After repository.deleteMany | Count result |
| `beforeRelationLoad` | Before loading a relation | Relation sub-intent |
| `afterRelationLoad` | After loading a relation | Mutable relation result |
| `aroundExecute` | Wraps the entire pipeline | Full context + `next()` |
| `onError` | On any pipeline error | Error + phase |

---

## Hook Lifecycle — Reads

```
.execute() called on QueryBuilder
    │
    ▼
aroundExecute hooks  ──────────────────────── outermost wrapper (transactions, locks)
    │
    ├── beforeRead hooks  (ordered by priority)
    │     → mutate intent: inject filters, strip fields, short-circuit with cache
    │
    ├── Policy enforcement  (system, not a hook)
    │     → strips forbidden fields/includes
    │     → injects mandatory where clauses
    │
    ├── repository.findMany(intent)
    │     → only place raw DB queries execute
    │
    ├── Relation resolution  (for each included relation)
    │     → beforeRelationLoad hooks
    │     → targetModelCapability.executeQueryIntent(subIntent)
    │         ↳ runs the full pipeline on the target capability
    │     → afterRelationLoad hooks
    │     → stitch results into parent records
    │
    └── afterRead hooks  (ordered by priority)
          → enrich with external data, compute fields, redact, cache write
    │
    ▼
Typed Array<InferModel<TSchema>> returned to controller
```

---

## Hook Lifecycle — Writes

```
.execute() called on CommandBuilder
    │
    ▼
aroundExecute hooks  ──────────────────────── outermost wrapper (transactions, locks)
    │
    ├── Idempotency check
    │     → key already seen: return stored result, skip pipeline
    │
    ├── beforeCreate / beforeUpdate / beforeDelete hooks
    │     → validate business rules, transform data, inject defaults
    │     → can throw to abort the entire operation
    │
    ├── Transition guard check  (state machine fields)
    │
    ├── Policy enforcement
    │     → strips forbidden fields from data
    │
    ├── Transaction begin  (if repository supports it)
    │
    ├── repository.create / update / delete
    │
    ├── afterCreate / afterUpdate / afterDelete hooks
    │     → call other services, emit events, invalidate cache
    │     → trigger side effects (notifications, audit logs)
    │
    ├── Transaction commit
    │
    └── Idempotency key stored
    │
    ▼
Typed InferModel<TSchema> returned to controller
```

---

## Hook Context

Every hook receives a **context object** that carries the full execution state. Hooks read and mutate this context — they never call the repository directly.

### Shared across all hooks

| Property | Type | Description |
|---|---|---|
| `auth` | `AuthContext` | Caller identity — userId, role, tenantId, scopes |
| `policy` | `ResolvedPolicy \| null` | Policy resolved for this operation |
| `service` | `{ name: string }` | Service metadata |
| `store` | `HookStore` | Typed key-value bag for passing data between hooks in the same pipeline run |
| `span` | `TraceSpan` | Tracing span for observability |
| `shortCircuit(result)` | method | Abort pipeline, return this value immediately |
| `isShortCircuited` | `boolean` | Whether pipeline was short-circuited upstream |

### Read hooks additionally expose

| Property | Availability | Description |
|---|---|---|
| `intent` | always (mutable) | The compiled query intent — hooks can modify it |
| `result` | `afterRead` only | The fetched records — hooks can transform them |
| `pagination` | `afterRead` only | `{ total?, hasMore? }` |

### Write hooks additionally expose

| Property | Availability | Description |
|---|---|---|
| `intent` | always | The compiled command intent |
| `data` | `before*` (mutable) | The data being written — hooks can modify it |
| `existing` | `beforeUpdate`, `beforeDelete`, `after*` | The record as it was before the operation |
| `result` | `after*` | The record after the operation |
| `transaction` | always | Active transaction handle, or null |
| `convertToUpdate(data)` | `beforeDelete` only | Convert this delete into a soft-delete |

### Relation hooks additionally expose

| Property | Description |
|---|---|
| `relation` | The relation name being loaded — typed as `keyof TRelations` |
| `parentRecords` | The parent records that triggered this load |
| `subIntent` | The sub-intent for this relation (mutable) |
| `result` | The loaded child records (mutable in `afterRelationLoad`) |

---

## Hook Registration

Hooks are registered in the service's `registerHooks()` method, called automatically on NestJS module init. Decorator-based registration is also supported.

### Imperative registration

```ts
protected registerHooks(): void {
  this.hooks.beforeRead(handler, { priority: 100, name: "inject-tenant-filter" });
  this.hooks.afterCreate(handler, { priority: 900, soft: true, name: "send-notification" });
  this.hooks.beforeRelationLoad("volumes", handler);
  this.hooks.aroundExecute(handler, { priority: 10, name: "transaction-wrapper" });
}
```

### Decorator registration

```ts
@BeforeRead({ priority: 100, name: "inject-tenant-filter" })
async injectTenantFilter(ctx: ReadHookContext<TSchema>): Promise<void> { ... }

@AfterCreate({ soft: true, name: "send-notification" })
async sendNotification(ctx: CreateHookContext<TSchema>): Promise<void> { ... }
```

For first implementation in this repository, prefer **imperative registration** to reduce framework complexity; decorators can be added later.

### Hook options

| Option | Type | Description |
|---|---|---|
| `priority` | `number` | Execution order — lower runs first. Default: `500` |
| `name` | `string` | Human-readable name for debugging and tracing |
| `when` | `(ctx) => boolean` | Conditional — skip this hook if returns false |
| `soft` | `boolean` | Errors in this hook are logged but do not abort the pipeline |

---

## Built-in Hooks

The proposed framework should provide a set of **generic hook factories**. Each factory is parameterized by the service schema and returns typed handlers ready to be registered.

Every field name argument is constrained to `FieldKeysOf<TSchema>` — passing a field that doesn't exist on the model is a **compile-time error**.

| Factory | What it does |
|---|---|
| `softDeleteHook<TSchema, TField>` | Injects `deletedAt IS NULL` on reads; converts deletes to updates |
| `timestampHook<TSchema, TCreatedAt, TUpdatedAt>` | Injects `createdAt` / `updatedAt` automatically |
| `tenantIsolationHook<TSchema, TField>` | Scopes all reads/writes to `ctx.auth.tenantId` |
| `auditLogHook<TSchema>` | Logs create/update/delete with typed before/after diff |
| `ownershipGuardHook<TSchema, TOwnerField>` | Prevents reads/writes on records not owned by the caller |
| `uniqueConstraintHook<TSchema, TField>` | Validates uniqueness before create/update |
| `slugHook<TSchema, TSource, TSlug>` | Generates a slug from a source field with optional uniqueness |
| `rateLimitHook<TSchema>` | Rate-limits operations per caller |
| `computedFieldsHook<TSchema>` | Attaches computed properties to results after read |
| `cacheHook<TSchema>` | Read-through cache with tag-based invalidation on writes |
| `eventEmitterHook<TSchema>` | Emits typed domain events after every write |
| `transactionWithRetryHook<TSchema>` | Wraps writes in a transaction with configurable retry |
| `distributedLockHook<TSchema>` | Acquires a distributed lock before critical writes |

---

## Custom Hooks

Custom hooks follow the same pattern as built-in ones: a **factory function** that accepts typed dependencies and returns handlers typed against the service schema.

### Pattern

```ts
function myBusinessRuleHook<TSchema extends AnyZodObject>(deps: {
  relatedCapability: RelatedModelCapabilityPort;
}) {
  return {
    async beforeCreate(ctx: CreateHookContext<TSchema>): Promise<void> {
      // ctx.data is InferModel<TSchema> — fully typed
      // throw to abort, mutate ctx.data to transform
    },

    async afterRead(ctx: ReadHookContext<TSchema>): Promise<void> {
      // ctx.result is Array<InferModel<TSchema>>
      // ctx.intent is CompiledQueryIntent<TSchema>
    },
  };
}
```

### Hooks calling other model capabilities

Hooks can call other model capabilities via `from()` adapters. In this repository, these dependencies should be exposed from `core/modules/*` (ports/facades), not imported directly from another feature module.

```ts
// "prevent deleting a container if it has active volumes"
async beforeDelete(ctx: DeleteHookContext<TSchema>): Promise<void> {
  const count = await from(deps.relatedCapability)
    .where({ containerId: { eq: ctx.existing.id }, status: { eq: "mounted" } })
    .count()
    .execute();

  if (count._count > 0) {
    throw new ConflictException(`Cannot delete: ${count._count} active volume(s)`);
  }
}
```

### Hooks calling external APIs

Hooks can call any external API. Use `soft: true` for non-critical enrichment so failures don't break the main operation.

```ts
// "enrich results with live metrics from Docker API"
async afterRead(ctx: ReadHookContext<TSchema>): Promise<void> {
  const ids = ctx.result.map((r) => r.id);
  const metrics = await deps.metricsApi.getBulkStats(ids);
  for (const record of ctx.result) {
    record._metrics = metrics[record.id] ?? null;
  }
}
// registered with: { soft: true, name: "enrich-live-metrics" }
```

---

## Relation Resolution

When a query includes relations, the service is responsible for loading them. The key rule is:

> **Always call the target model capability (via core port/facade) — never the target's repository directly.**

This ensures the target's full hook pipeline (policy enforcement, caching, business rules, enrichment) is always respected, regardless of which service is loading the relation.

### How it works

1. The service fetches its own records via its repository.
2. For each included relation, it identifies the **target model capability** from `$relations`.
3. It builds a scoped sub-intent (filtered to the parent's foreign keys).
4. It calls `targetModelCapability.executeQueryIntent(subIntent)`.
5. Results are stitched back into the parent records.

Independent relations at the same level are resolved **in parallel**.

### Cross-service relation chains

Relations can span capabilities backed by completely different data sources:

```
ProjectModelService     (PostgreSQL repository)
  └── containers
    └── DockerCapabilityPort   (resolved by core registry)
              └── deployments
        └── DeploymentCapabilityPort  (external CI/CD API)
```

The controller wrote a single `from(ProjectCapabilityPort).include({ containers: { include: { deployments: true } } })`. The chain of capability calls is invisible to it.

---

## Transaction Support

Transactions are **repository-aware**. The service declares whether its operations should run inside a transaction, and the framework coordinates accordingly.

### Single-service transaction

Wrap a write operation in the service's repository transaction. If the repository doesn't support transactions, the operation runs without one.

### Multi-service transaction

The `TransactionManager` groups services by **repository identity**. Services sharing the same database share the same transaction. Services backed by external APIs or non-transactional repositories execute independently — failures must be handled via compensating actions.

### Transaction handle in hooks

When a write runs inside a transaction, `ctx.transaction` is populated. Hooks that perform additional writes (e.g. writing to an audit table in the same DB) must use this handle to participate in the same transaction.

---

## Caching Layer

Caching is opt-in per service and implemented as a pair of hooks:
- `beforeRead` with low priority — checks the cache and short-circuits if hit
- `afterRead` with high priority — writes the result to cache after a miss
- `afterCreate` / `afterUpdate` / `afterDelete` — invalidate relevant cache entries

### Cache key

Derived from `intent.meta.intentHash` — a deterministic hash of the compiled intent. Two identical queries always produce the same key.

### Cache tags

Every cached result is tagged with a list-level tag (invalidated on any write) and per-record tags (invalidated on update/delete of that specific record).

### Cache implementation

The `CacheAdapter` interface is pluggable. The service doesn't know whether it's backed by Redis, Memcached, or an in-memory store.

---

## Event System

Model services emit **typed domain events** after successful writes via the `eventEmitterHook`.

### Service-level emitter

Each service has its own `ServiceEventEmitter<TSchema>`. Subscribers receive events typed to that service's model.

### Global event bus

The `GlobalEventBus` allows cross-service subscriptions using patterns:
- `"DockerModelService:created"` — specific service + action
- `"DockerModelService:*"` — all actions from a service
- `"*:deleted"` — all deletions across all services

### Event payload

| Field | Type | Description |
|---|---|---|
| `service` | `string` | Service name |
| `action` | `EventAction` | `created`, `updated`, `deleted`, `bulkCreated`, etc. |
| `record` | `InferModel<TSchema>` | The affected record |
| `diff` | `FieldDiff<TSchema>[]` | Changed fields with before/after values (updates only) |
| `userId` | `string` | Who triggered the operation |
| `tenantId` | `string \| undefined` | Tenant context |
| `timestamp` | `Date` | When the event occurred |

Events are **fire-and-forget**. Errors in event handlers are logged but never propagate to the caller.

---

## Error Handling

### Hook errors

Any error thrown in a hook aborts the pipeline and propagates to the controller. Hooks marked `soft: true` log the error and continue.

### `onError` hooks

Services register `onError` hooks to intercept, transform, or swallow errors:
- Map database constraint errors to typed `ConflictException`
- Log all unhandled errors with full intent context
- Add retry logic for transient failures

### Typed error classes

| Class | When |
|---|---|
| `HookError<TSchema>` | An error occurred in a specific hook |
| `RelationResolutionError` | A relation could not be resolved |
| `TransitionGuardError<TSchema>` | A state machine transition was invalid |
| `IdempotencyConflictError` | An idempotency key was reused with different data |

---

## Testing

### Unit tests — mock repository

Replace the real repository with a typed in-memory implementation. No database required. Seed it with test data and assert on the results.

### Testing hooks in isolation

Hook factories return plain objects with typed methods. They can be tested independently by constructing a mock context object — no service or repository needed.

### Testing the full pipeline

Use a mock repository + real hooks to test the full service pipeline end-to-end without a database. This is the recommended approach for service-level integration tests.

### Testing cross-service logic

Mock the dependent model services using their interface type. Since all services implement `ModelServiceContract<TSchema, ...>`, they can be replaced with typed mocks that return controlled data.

---

## Guardrails

| # | Rule |
|---|---|
| 1 | The model service is the **single orchestrator** for its model — no other layer calls its repository directly. |
| 2 | Repositories are **only called from their own model service** — never from controllers, other services, or hooks of other services. |
| 2a | Cross-feature interactions must use core capability ports/facades; direct `modules/<feature-a>` → `modules/<feature-b>/services/*` coupling is forbidden. |
| 3 | Relation loading always goes through the **target model capability pipeline** — never directly to the target's repository. |
| 4 | Hooks never call the repository directly — they mutate context and let the pipeline call the repository. |
| 5 | All hook handlers are typed against `InferModel<TSchema>` — no `any` in hook signatures. |
| 6 | Built-in hook factories constrain field names to `FieldKeysOf<TSchema>` — invalid fields are compile-time errors. |
| 7 | Events are fire-and-forget — event handler errors never propagate to the caller. |
| 8 | Non-critical hooks (analytics, notifications, enrichment) must use `soft: true`. |
| 9 | Hooks that perform additional writes inside a transaction must use `ctx.transaction`. |
| 10 | For modules adopting this feature, minimum baseline hooks should include audit/error mapping and event emission; tenant hooks are only required where tenant scope exists. |

---

## Suggested incremental adoption for this project

1. Pilot in one new feature module only.
2. Keep existing controllers/contracts unchanged; add service-side query-intent + hook pipeline internally.
3. Validate with service/controller tests before broad adoption.
4. Promote stable pieces to `core/modules/modeling` and reuse in the next feature.