# API E2E Findings (oRPC + Docker + Traefik)

> **Added**: 2026-03-17  
> **Type**: Discovery  
> **Confidence**: Verified ✅  
> **Scope**: v3 / apps/api / e2e

## Summary
This document captures validated findings from the API e2e exploration: Testcontainers runtime compatibility, oRPC-native testing strategy, and a fully controlled Docker+Traefik integration approach.

## Context
Goal: move from raw endpoint-only testing to a realistic but controlled e2e strategy that validates:
- application behavior (oRPC contract/client path),
- infrastructure behavior (Docker runtime + Traefik routing),
- deterministic test execution in Vitest.

### Terminology (important)
In this document, when we say **"in-memory"** for infrastructure-heavy e2e, we mean:
- **ephemeral, isolated runtime spun up by Testcontainers** for the test lifecycle,
- not long-lived/shared host services,
- not hand-managed external Docker resources.

For DB + Traefik scenarios, this is the intended meaning and the required approach.

---

## Finding 1 — Root cause of initial Testcontainers crash

> **Added**: 2026-03-17  
> **Type**: Bug  
> **Confidence**: Verified ✅  
> **Scope**: v3 dependency graph

### Summary
`TypeError: onExit is not a function` came from an API mismatch in transitive dependencies used by Testcontainers.

### Details / Implementation
- `proper-lockfile@4.1.2` expects `signal-exit` v3 function-style export.
- Dependency resolution was pulling `signal-exit@4.x` object-style export in the same graph.
- This mismatch caused runtime failure when Testcontainers attempted file lock handling.

### Affected Files / Locations
- `v3/package.json` — workspace override affecting transitive resolution
- `v3/apps/api/package.json` — e2e dependency/scripts wiring

### Known Limitations / Caveats
- Bun override behavior can differ from npm/pnpm for nested overrides; keep flat compatible overrides.

---

## Finding 2 — Best oRPC-compatible API e2e approach

> **Added**: 2026-03-17  
> **Type**: Pattern  
> **Confidence**: Verified ✅  
> **Scope**: v3 / apps/api

### Summary
For this Nest integration (`@orpc/nest`), the best contract-aware e2e style is Vitest + typed oRPC client calls (OpenAPI link path), not raw HTTP assertions only.

### Details / Implementation
Recommended stack:
- Vitest (runner)
- `@orpc/client` + `@orpc/openapi-client/fetch` (`OpenAPILink`) for typed calls
- Testcontainers for real infra dependencies (Postgres, Traefik-related integration)
- Optional `orpc-msw` for mocked integration tests (not for real infra e2e)

### Evidence
- `v3/apps/api/src/app.module.ts` — `ORPCModule` integrated in Nest app
- `v3/apps/api/src/main.ts` — OpenAPI/oRPC-oriented bootstrap behavior
- `v3/apps/web/src/lib/orpc/index.ts` — existing typed OpenAPI-link client path in repo

### Known Limitations / Caveats
- `orpc-msw` is OpenAPI-mocking focused and not a replacement for real Docker/Traefik infra verification.

---

## Finding 3 — Controlled Docker + Traefik test design

> **Added**: 2026-03-17  
> **Type**: Workflow  
> **Confidence**: Verified ✅  
> **Scope**: v3 / apps/api / e2e

### Summary
A fully controlled infra e2e can be achieved by provisioning ephemeral Docker network + Traefik + controlled upstream app container per test suite.

### Details / Implementation
Target topology (per suite):
1. Create ephemeral Docker network.
2. Start Traefik container with docker provider and `exposedByDefault=false`.
3. Start a tiny controlled upstream app container (runtime-only process).
4. Attach Traefik labels to upstream container for router/service mapping.
5. Assert routing via host header and response payload.
6. Assert negative path (unknown host → 404).
7. Teardown all resources in `afterAll`.

### Why this is “fully controlled”
- No shared host state.
- No dependency on pre-existing local Traefik.
- Deterministic startup/teardown lifecycle managed by tests.
- Entire runtime is provisioned by Testcontainers inside the suite lifecycle.

### Known Limitations / Caveats
- A truly same-process in-memory app cannot be directly discovered by Traefik docker provider; the controlled upstream should run as an ephemeral container.

---

## Finding 4 — Database “in-memory first” strategy

> **Added**: 2026-03-17  
> **Type**: Pattern  
> **Confidence**: Verified ✅  
> **Scope**: v3 / apps/api / e2e

### Summary
All test targets should run in-memory when technically possible; for Postgres-specific behavior and infra-level validation, use ephemeral Testcontainers-managed containers.

### Details / Implementation
Use a tiered approach:

1. **Pure unit/service tests**
	- No database process.
	- Repository mocked with `vi.fn()` object literals.
	- Fastest feedback, no I/O.

2. **App integration tests (no Postgres-specific SQL constraints)**
	- Prefer in-memory DB engine when query semantics are compatible with tested behavior.
	- Suitable for control-flow validation, auth guards, handler wiring.

3. **True API e2e with Drizzle + PostgreSQL behavior**
	- Use ephemeral Postgres container (Testcontainers).
	- Required for extensions, transaction semantics, unique/index behavior, and SQL dialect parity.

4. **Infra e2e (Docker + Traefik routing)**
	- Use ephemeral Docker network + containers (all provisioned by Testcontainers).
	- Cannot be fully in-process/in-memory because Traefik docker provider discovers container metadata.

### What should run in-memory vs containerized

| Test scope | In-memory possible | Recommended mode | Why |
|---|---:|---|---|
| Service logic (`*.service.spec.ts`) | ✅ | In-memory (no DB) | Business logic isolation |
| Controller contract wiring | ✅ | In-memory (mocked deps) | Fast contract/auth verification |
| API behavior needing real SQL parity | ❌ (practically) | Ephemeral Postgres container | Prevent dialect drift and false positives |
| Setup/bootstrap DB flow | ⚠️ Partial | Ephemeral Postgres container | Mirrors production bootstrap path |
| Docker + Traefik routing | ❌ | Ephemeral containers + network | Requires docker-provider discovery |

### Practical rule
- Default to **in-memory** for logic and wiring tests.
- Escalate to **ephemeral Testcontainers resources** when behavior depends on real Postgres or Docker/Traefik runtime characteristics.

### Known Limitations / Caveats
- “100% in-memory e2e” is not realistic for Traefik docker-provider and Postgres-dialect guarantees.
- For those paths, ephemeral containers are the closest deterministic equivalent to in-memory isolation at infra level.

---

## Current E2E Artifacts
- `v3/apps/api/src/e2e/setup-configure-database.e2e-spec.ts` — API setup/database e2e scaffold
- `v3/apps/api/src/e2e/setup-workflows/setup-advanced-workflow.e2e-spec.ts` — advanced multi-step setup workflow checks (error path, REST/oRPC parity, concurrent testOnly semantics)
- `v3/apps/api/src/e2e/setup-workflows/support/setup-workflow-context.ts` — shared setup workflow test context (runtime + typed oRPC + HTTP client)
- `v3/apps/api/src/e2e/setup-workflows/support/setup-workflow-assertions.ts` — schema-driven assertions and reusable workflow invariants
- `v3/apps/api/vitest.config.mts` — unified Vitest config (includes e2e project unless `VITEST_DISABLE_E2E=1`)
- `v3/apps/api/vitest.setup.e2e.ts` — isolated e2e setup hooks

## Next Implementation Step (when resuming code)
- Add `traefik-routing.e2e-spec.ts` under `v3/apps/api/src/e2e/` using Testcontainers core to validate Docker+Traefik routing deterministically.
