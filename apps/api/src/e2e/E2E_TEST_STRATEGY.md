# API E2E Test Strategy (Comprehensive Coverage)

> **Added**: 2026-03-18  
> **Type**: Workflow / Strategy  
> **Confidence**: Verified ✅ (based on current app architecture + existing suites)  
> **Scope**: `v3/apps/api/src/e2e`

## Why this document exists

This file defines **what should be tested** in API e2e for the whole app, with explicit focus on:

- cross-module workflows,
- edge cases and failure paths,
- auth/permission boundaries,
- infrastructure/runtime behavior,
- deterministic execution under shared runtime.

Use this as the source-of-truth checklist when adding new e2e specs.

---

## E2E coverage goals

1. Validate that core user journeys work from API boundary to persistence/runtime side effects.
2. Validate important failure semantics (HTTP/orpc status, message shape, no state corruption).
3. Validate security boundaries (anonymous/authenticated/role/organization checks).
4. Validate time/queue/concurrency behavior (leases, retries, dedupe, pagination, scheduling).
5. Validate infra behavior where unit/integration tests cannot (Docker, Traefik, container networking).

---

## Test architecture rules

### Runtime model

- Use shared runtime bootstrap in `utils/shared-api-runtime.ts`.
- Keep logs quiet by default; enable deep diagnostics only with env flags.
- Keep tests deterministic (`fileParallelism: false` in e2e Vitest config).

### Test style

- Prefer workflow-oriented specs over single-endpoint happy-path checks.
- In every suite include:
  - at least one **negative path**,
  - at least one **edge case** (timing, invalid token, dedupe, pagination, etc.),
  - explicit assertions on state transitions.

### Assertion quality

- Assert semantic outcomes, not incidental implementation details.
- For expected failures, assert status + stable error meaning.
- For stateful features, assert both action result and persisted/read-back state.

---

## Coverage matrix (what should be tested)

### 1) Setup module

Must cover:

- DB URL validation (valid/unreachable).
- testOnly mode behavior (no persistent node config).
- setup state-machine consistency (`states`, `transitions`, terminal states).
- REST and oRPC parity for same operations.
- initialize strategy guards (`remote_instance` rejection in local flow).
- concurrent configure requests and deterministic outcomes.

Current status: **partially covered** ✅ (advanced setup workflow suites exist).

### 2) Deployment queue lifecycle

Must cover:

- idempotent enqueue dedupe.
- claim semantics (type filters, limits, scheduled availability).
- lease/heartbeat behavior.
- transition lock validation (wrong worker/token safety).
- retry path (custom and default backoff).
- dead-letter transitions and replay modes (same payload / patched payload / scheduled replay).
- dead-letter pagination and not-found replay behavior.

Current status: **strong coverage** ✅ (advanced queue suite with edge cases).

### 3) Auth patterns / access boundaries (`test` module endpoints)

Must cover:

- public endpoints accessible anonymously.
- authenticated endpoints reject anonymous requests.
- optional-auth endpoints return stable anonymous context shape.
- admin/organization protected endpoints reject anonymous or invalid token requests.
- ORPC public/authenticated optional-auth parity.

Current status: **needs dedicated suite** 🔄.

### 4) Traefik + Docker routing

Must cover:

- host-based routing to labeled upstream.
- unknown-host fallback/404 behavior.
- startup stability with deterministic wait strategies.

Current status: **baseline covered** ✅.

### 5) Domain / Project / Service modules (CRUD + workflow)

Must cover (minimum):

- create/update/delete list flows with contract shape checks.
- cross-entity consistency (project-service-domain linkage).
- conflict / not-found / validation boundaries.
- auth + organization scoping.

Current status: **not yet covered in e2e** ❗.

### 6) Provider schema module

Must cover:

- provider/builder listing and schema retrieval.
- config validation success/failure payload shapes.
- compatible builders/providers contracts.

Current status: **not yet covered in e2e** ❗.

### 7) System mesh / fleet control-plane endpoints

Must cover:

- list/read endpoints baseline.
- command endpoints (connect/reconcile/rotate) negative-path guards.
- stream endpoints behavior contracts (snapshot/replay fields where applicable).

Current status: **not yet covered in e2e** ❗.

---

## Edge-case catalog (mandatory categories)

When adding a new suite, include at least one case from each relevant category:

1. **Authorization edge cases**
   - anonymous access to protected route,
   - malformed token/header,
   - role/permission mismatch.

2. **State transition safety**
   - invalid state transition does not mutate state,
   - idempotent repeated requests.

3. **Concurrency / timing**
   - concurrent calls on same logical entity,
   - scheduled/future availability windows.

4. **Pagination / filtering**
   - limit/offset behavior,
   - scoped filter integrity.

5. **Failure handling**
   - not found,
   - bad request,
   - internal boundaries with stable error surface.

---

## Suite roadmap (execution order)

1. Auth patterns (`test` module) e2e suite.
2. Provider schema e2e suite.
3. Domain/project/service workflow e2e suite.
4. System mesh/fleet baseline e2e suite.
5. Broader multi-module scenario suites (e.g., setup → project/service/domain → deployment queue trigger).

---

## Definition of done for a new e2e suite

- At least 4-6 meaningful workflow tests.
- Contains positive + negative + edge paths.
- Uses shared helpers/context where practical.
- Green in isolated run and in broader workflow batch.
- Added to this strategy matrix status (covered/partial/not covered).
