# API Architecture (v3)

> **Scope**: `v3/apps/api`
> 
> **Status**: Canonical architecture reference for API backend structure and module design.
> 
> **Last Updated**: 2026-04-17

---

## Why this file exists

This document defines how the API must be structured from top-level app wiring down to controllers, services, repositories, listeners, queues, and events.

It is intentionally opinionated so we avoid returning to oversized “mega” components/repositories and keep each feature modular, testable, and maintainable.

---

## Architecture principles (non-negotiable)

1. **Contract-first**: contracts are defined before API implementation.
2. **Thin controllers**: controllers bind contract + auth and delegate.
3. **Business logic in orchestration/application/runtime/listener components only**.
4. **Data access in repositories only**.
5. **No cross-feature component imports** (`modules/a` must not import `modules/b` internals directly).
6. **Shared concerns move to `core/modules/*`**.
7. **No `as any` / cast chains to silence typing problems**.
8. **Global runtime streams/listeners are explicit services, not hidden side effects**.
9. **Feature decomposition by domain** (especially for complex modules like Docker/deployment).
10. **Legacy global mega components/repositories must be removed through direct full cutover (no temporary compatibility shells)**.

---

## Implementation flow (end-to-end)

1. Contracts (`packages/contracts/api/modules/<feature>`)
2. API module (`apps/api/src/modules/<feature>`)
3. Orchestration/component/repository wiring
4. Tests (`*.service.spec.ts`, `*.controller.spec.ts`)

---

## Repository-level placement (v3)

```text
v3/
  apps/
    api/
      src/
        app.module.ts
        core/
        modules/
        system/
  packages/
    contracts/api/
    utils/
    types/
```

API app is the NestJS runtime host. Contracts live in `packages/contracts/api`.

---

## API app top-level structure

```text
apps/api/src/
  app.module.ts
  main.ts
  auth.ts
  config/
  core/
    middlewares/
    modules/
      auth/
      configuration/
      context/
      database/
      deployment/
      docker/
      domain/
      events/
      git/
      local-database/
      mesh/
      node-config/
      project/
      push/
      system-metrics/
      traefik/
  modules/
    analytics/
    deployment/
    docker/
    domain/
    fleet/
    github/
    health/
    organization/
    permission/
    project/
    provider-schema/
    push/
    service/
    setup/
    test/
    user/
  system/
```

---

## Layering model

### Layer A: Core modules (`core/modules/*`)

Use for reusable infrastructure and cross-feature domain utilities.

Examples:
- `database` (DB wiring/services)
- `auth` (auth middleware/plugins/guards)
- `events` (event contracts, outbox, dispatch helpers)
- `mesh` (distributed coordination primitives)
- `deployment` / `project` core utility services used by multiple features

### Layer B: Feature modules (`modules/<feature>/*`)

Use for feature orchestration and feature-owned behaviors.

Each feature module can depend on core modules, never on another feature module’s internals.

### Layer C: External contracts/packages

- API contracts from `@repo/api-contracts`
- Shared entities/types from contracts/types packages
- Shared auth/permissions utilities from `@repo/auth`

### Dependency direction matrix (must follow)

| From | To | Allowed | Notes |
|---|---|---|---|
| `modules/<feature>/*` | `core/modules/*` | ✅ | Preferred dependency direction |
| `core/modules/*` | `core/modules/*` | ✅ | Keep minimal and intentional |
| `modules/<feature-a>/*` | `modules/<feature-b>/*` internals | ❌ | Promote shared logic to `core/modules/*` |
| `modules/<feature-a>/*` | `modules/<feature-b>/repositories/*` | ❌ | Cross-feature data coupling forbidden |
| `core/modules/*` | `modules/*` | ❌ | Inverts architecture layering |
| `controllers/*` | DB access/repository internals | ❌ | Controllers delegate only |

---

## Module architecture profiles (required)

This repository now supports **two explicit module profiles**.

### Profile 1 — Standalone module (single domain module)

Use this when a module is not a container of sub-modules.

```text
modules/<feature>/
  <feature>.module.ts
  controllers/
    <feature>.controller.ts
    *.controller.spec.ts
  orchestration/
    *.service.ts
  application/
    *.service.ts
  runtime/
    *.service.ts
  listeners/
    *.service.ts
  queues/
    *.service.ts
  events/
    *.service.ts
  mesh/
    *.service.ts
    registrars/
    handlers/
  providers/
    *.service.ts
  repositories/
    *.repository.ts
    *.repository.spec.ts
  common/
    ...shared helpers/types used by 2+ folders in this module
```

### Profile 2 — Container module (nested domain modules)

Use this when a module is a composition root over multiple domains (example: Docker with `containers`, `images`, `runtime`, `networks`, ...).

```text
modules/<feature>/
  <feature>.module.ts                      # container/aggregator module
  controllers/
    <feature>.controller.ts                # delegates to domain orchestration services

  common/                                  # shared code across nested domains only
    controllers/
    orchestration/
    application/
    runtime/
    listeners/
    queues/
    events/
    mesh/
    providers/
    repositories/

  domains/
    <domain-a>/
      <domain-a>.module.ts
      controllers/
      orchestration/
      application/
      runtime/
      listeners/
      queues/
      events/
      mesh/
      providers/
      repositories/

    <domain-b>/
      <domain-b>.module.ts
      controllers/
      orchestration/
      application/
      runtime/
      listeners/
      queues/
      events/
      mesh/
      providers/
      repositories/
```

### Hard rules for both profiles

1. Controllers must call **orchestration components** only.
2. Controllers must not call repositories/providers/mesh/listeners directly.
3. Shared cross-domain logic must live in `<feature>/common/*`.
4. Domain-specific logic must stay in its own domain folder/module.
5. No fallback legacy facades/shims in `v3`.

### Optional folders (allowed when clearly scoped)

- `policies/` or `guards/`
- `mappers/` or `serializers/`
- `schemas/` or `contracts/` (internal only)

Not allowed as catch-all folders: `misc/`, `helpers/`, `tmp/`, ambiguous `utils/` buckets.

---

## Controller structure (required)

Controllers are contract bindings only.

### Responsibilities
- bind ORPC contract operation
- apply middleware (`requireAuth()` etc.)
- adapt input/output shape
- delegate to `orchestration/*` component

### Must not do
- direct DB queries
- multi-step business decisions
- calling external providers directly (unless via dedicated adapter/service)
- calling repositories/providers/mesh services directly

### Controller pattern

```ts
@Controller()
export class FeatureController {
  constructor(private readonly featureOrchestratorService: FeatureOrchestratorService) {}

  @Implement(featureContract.list)
  list() {
    return implement(featureContract.list)
      .use(requireAuth())
      .handler(async ({ input, context }) => {
        context.auth.requireAuth();
        return this.featureOrchestratorService.list(input.query);
      });
  }
}
```

---

## Component taxonomy (what to create)

Use explicit service categories to avoid mixing concerns.

1. **Orchestration component (controller entrypoint)**
  - Mandatory entrypoint for controller calls.
  - Coordinates domain/application/runtime/listener/queue components.
  - Example folder: `orchestration/`

2. **Application component**
   - Business logic for one domain scope.
  - Example: `domains/<domain>/application/*.service.ts`

3. **Listener component**
   - Reacts to runtime events, startup hooks, subscriptions.
  - Example folder: `<domain>/listeners/`

4. **Queue component / worker**
   - Pulls and processes queued work (sequential/concurrent policy explicit).
  - Example folder: `<domain>/queues/`

5. **Event stream component**
   - Produces/relays/aggregates observable event streams.
  - Example folder: `<domain>/events/`

6. **Runtime component**
   - Handles runtime snapshots, logs, process streams, terminal sessions.
  - Example folder: `<domain>/runtime/`

7. **Cross-domain orchestration component**
  - For container modules only: coordinates multiple domain modules.
  - Example folder: `<feature>/common/orchestration/`

8. **Mesh component**
  - Handles mesh transport contracts, relays, cross-node resolution, and mesh registration bootstrap.
  - Example folder: `<domain>/mesh/`

9. **Adapter component**
   - Encapsulates external provider/SDK behavior.
   - Keep provider-specific code isolated.

---


2. **Projection Repository**
   - Read model optimized for listing/filtering/reporting.

3. **Link/Relation Repository**
   - Resolves linked entities across boundaries (still no business decisions).

4. **Common Repository Helpers**
   - Shared query builder/filter normalization/pagination utilities.
   - Must be generic and domain-safe.

### Repository rules
- No business policy checks.
- No auth/permission decisions.
- No side-effect orchestration.
- Strong typing from schema/contracts/Drizzle models.

---

## Mesh/event architecture (for distributed features)

For distributed runtime features, keep mesh concerns isolated at top-level domain folders:

```text
modules/<feature>/domains/<domain>/mesh/
  *.service.ts   # mesh contracts, relays, resolution clients
  registrars/    # registration/bootstrap wiring
  handlers/      # message/event handlers (if needed)
```

And within each domain folder:
- `events/` for feature event APIs/streams
- `listeners/` for consumers
- `queues/` for deferred/background execution
- `mesh/` for distributed transport + registration concerns

### Lifecycle contract (listeners, queues, events)

Components that maintain subscriptions, intervals, or workers must implement explicit lifecycle handling:

1. `onModuleInit`
   - initialize subscriptions/workers exactly once
   - record startup phase logs
2. `onModuleDestroy`
   - unsubscribe/stop workers/clear intervals
   - flush or safely stop in-flight work where applicable
3. Startup bootstrap
   - bootstrap routines must be idempotent
   - avoid duplicate enqueue/processing across retries

No long-running subscription should exist without explicit teardown logic.

### Event envelope standard

All cross-component runtime events should use a stable envelope:

```ts
type EventEnvelope<TPayload = unknown> = {
  eventId: string;
  eventType: string;
  version: number;
  source: string;
  timestamp: string; // ISO
  correlationId?: string | null;
  idempotencyKey?: string | null;
  payload: TPayload;
};
```

Minimum guarantees:

- `eventId` unique per emission
- `version` increments for breaking payload changes
- consumers are tolerant to unknown fields

### Queue policy defaults

Unless feature-specific requirements differ, queue workers should default to:

- **retry attempts**: 3
- **backoff**: exponential (base 2s)
- **concurrency**: 1 for stateful flows; >1 only with idempotent handlers
- **job timeout**: explicit and finite
- **dedupe**: idempotency key per resource/action pair
- **dead-letter handling**: failed terminal jobs moved to DLQ/review stream

Any deviation must be documented in the feature module.

### Error handling model

Map errors consistently across layers:

- domain not found → `NotFoundException`
- conflict/state violation → `ConflictException`
- unauthorized/ownership violation → `ForbiddenException`
- invalid input/state precondition → `BadRequestException`

Queue/listener code must classify errors as:

- **retryable** (transient infra/network/timeouts)
- **terminal** (invalid payload, forbidden operation, invariant violation)

---

## Module wiring rules (`<feature>.module.ts`)

- `imports`: only required core modules + feature dependencies.
- `providers`: orchestration/application/runtime/listener components, repositories, mesh registrars/components.
- `exports`: only what another module actually needs.

Avoid exporting internals by default.

---

## Testing structure

### Component tests
- One `describe` per method.
- Cover happy path + conflict + not-found + null returns.
- Mock repositories with plain `vi.fn()` object literals.

### Controller tests
- Mock ORPC bindings (`implement`, `Implement`) and auth middleware.
- Assert each controller method returns implementation with `.handler`.
- Assert delegation contract to orchestration component.

### Complex feature tests
- Add listener/queue regression tests.
- Add runtime stream tests (dedupe, ordering, completion semantics).

### Architecture guard tests (recommended)

- Add import-boundary checks (no cross-feature direct component imports).
- Add smoke tests ensuring lifecycle components teardown subscriptions on destroy.
- Add regression tests for queue idempotency and retry policy.

---

## Naming conventions

- Controller: `<feature>.controller.ts`
- Orchestration component: `*-orchestrator.service.ts`
- Application/runtime/listener/queue/event/mesh components: capability-specific `*.service.ts`
- Repository: `<feature>.repository.ts`

Folder names must express capability:
- prefer `domains/<domain>/runtime`, `domains/<domain>/mesh`, `domains/<domain>/events`
- avoid ambiguous buckets like `misc`, `helpers`, `tmp`

---

## Anti-patterns to reject

1. Mega orchestration component with unrelated concerns mixed together.
2. Mega repository with all feature queries in one file.
3. Controller performing business orchestration directly.
4. Cross-feature direct component imports.
5. Duplicated regex/normalization logic in multiple components.
6. Hidden startup side effects without dedicated listener/initializer component.

---

## Migration strategy for legacy mega modules (full cutover only)

When a feature currently has global/monolithic component-repository classes:

1. Create domain folders directly under `domains/<domain>/*` and `repositories/*`.
2. Move one domain end-to-end (orchestration/application/runtime/listener + repository + tests).
3. Introduce `common/*` / `repositories/common` for shared logic.
4. Migrate all imports/call sites/tests/docs to the new structure in the same change set.
5. Remove old component/repository files in that same change set (no compatibility layer).

### Hard rule

No temporary compatibility facades, re-export shims, or legacy aliases are allowed in `v3/`.

### Migration definition of done

A migration away from legacy mega classes is complete only if all are true:

- no legacy facade/repository compatibility files remain
- no direct call sites remain to deprecated internals
- domain components + repositories fully own moved behavior
- common logic extracted where reused by 2+ domains
- tests moved to new locations and passing
- deprecated files removed in the same cutover change set

---

## Docker module target shape (reference)

```text
modules/docker/
  docker.module.ts
  controllers/
    docker.controller.ts
  orchestration/
  application/
  runtime/
  listeners/
  queues/
  events/
  mesh/
  providers/
  common/
    controllers/
    orchestration/
    application/
    runtime/
    listeners/
    queues/
    events/
    mesh/
    providers/
    repositories/

  domains/
    containers/
      controllers/
      orchestration/
      application/
      runtime/
      listeners/
      queues/
      events/
      mesh/
      providers/
      repositories/

    images/
      controllers/
      orchestration/
      application/
      runtime/
      listeners/
      queues/
      events/
      mesh/
      providers/
      repositories/

    runtime/
      controllers/
      orchestration/
      application/
      runtime/
      listeners/
      queues/
      events/
      mesh/
      providers/
      repositories/

  repositories/
    common/
    facade/
      docker.repository.ts
    containers/
      links/
    images/
      catalog/
      security/
```

Goal: domain-granular behavior, not a single global Docker component/repository.

---

## Observability baseline (required)

Each service type should emit minimal telemetry:

- **listeners**: consumed events count, lag, failures
- **queues**: queue depth, retries, terminal failures, processing duration
- **runtime streams**: subscriber count, replay count, stream errors
- **orchestration**: workflow start/finish/failure with correlation id

Logs should include:

- `module`
- `service`
- `operation`
- `resourceId` (if available)
- `correlationId` (when part of an end-to-end flow)

---

## Quick checklist before merging architecture-sensitive changes

- [ ] No business logic in controllers or repositories
- [ ] No new mega component/repository introduced
- [ ] Domain folders used for complex feature work
- [ ] Shared logic extracted to `common/` where justified
- [ ] Feature modules depend on `core/modules/*`, not other feature internals
- [ ] Tests updated for moved logic
- [ ] Contracts and API implementations remain aligned
- [ ] Queue policies (retry/backoff/concurrency/idempotency) explicitly defined
- [ ] Lifecycle services have explicit init/destroy cleanup
- [ ] Observability baseline implemented for listeners/queues/streams
