# api-services — where it is, when web can link, when the monolith can go

> Compiled 2026-10-15 from 10 parallel audits (BFF, 5 services, web linkage,
> contracts, DB/schema, infra/networking, auth, tests, monolith surface, docs).
> Every claim below was verified against source at audit time. Items marked
> **UNVERIFIED** could not be confirmed without running a stack.
>
> **2026-10-16 update — the first three blockers are fixed.** See §5 for the
> change log: mesh routing, the BFF readiness route, and the web↔BFF compose
> link are done and verified. Current state: **1607 tests green across 7
> suites, 0 type errors across 10 projects.**

## TL;DR

| Question | Answer |
|---|---|
| Is the backend migrated? | **Yes.** 360 procedures declared, 339 implemented, 1607 tests green across 7 suites, 0 type errors. |
| Can web link to the BFF **today**? | **Yes — done for dev.** Source was already ready; the services profile now runs `web-dev` against the BFF. Remaining: the prod image + ingress (blockers 3–4). |
| Can `apps/api` be deleted? | **Closer, not yet.** Blockers 1, 2 and the web link are fixed. What remains: a prod image for the BFF/services, ingress pointed at the BFF, boot coordination, and SSR wiring. |

---

## 1. Current state — measured, not claimed

### 1.1 The BFF (`apps/api-services/bff`)

`src/screens/**` **does not exist** despite `apps/api-services/ARCHITECTURE.md:63` mandating it. Screens live in `src/modules/` + `src/domains/` — the doc is stale.

| Surface | Count | State |
|---|---|---|
| `bff.*` screen procedures | 7 | REAL, composed from 5 sources |
| `console.*` management | 6 | REAL |
| `setup.*` wizard | 11 | REAL (10) / 1 stub |
| `serviceSurface()` delegations | 315 | REAL — generated 1:1 forwarders |
| **Implemented total** | **339** | |
| `test.*` declared, not implemented | 5 | **404 at runtime** |
| `template.*` declared, not implemented | 16 | **404 at runtime** |
| **Declared total** | **360** | |

Delegation is real, not mock: each generated handler is `implement(X).handler(({input}) => this.client.Y(input))` against a typed `OpenAPILink` client.

**Stubs / hardcoded values in production handlers:**

| Location | What |
|---|---|
| `bff/src/domains/setup/controllers/setup.controller.ts:321` | `listPostSetupHints` returns literal `["scanning","notifications"]` |
| `bff/src/modules/dashboard/controllers/orchestration.controller.ts:112` | `system: { available: false, cpu: null, … }` always |
| `bff/src/modules/dashboard/controllers/orchestration.controller.ts:268` | `notificationCount: 0` |
| `bff/src/modules/dashboard/controllers/orchestration.controller.ts:76,288` | `.catch(() => [])` / `.catch(() => ({…}))` — swallowed failures, unreported |
| `svc-project/src/modules/project/controllers/project.controller.ts:385` | `refreshEnvironmentStatus` throws `NotImplementedException` |

**Dead code:** `HealthClient`, `FleetClient`, `AnalyticsClient` are provided but injected nowhere; `health.client.ts:24` also constructs a registry as a module-load side effect.

### 1.2 The five services

| | identity | project | runtime | fleet | health |
|---|---|---|---|---|---|
| Domain folders | 4 | 4 | 4 | 6 | 1 |
| `@Implement` handlers | 34 | 69 | 85 | 92 | 2 |
| Unit specs | 3 | 8 | 30 | 17 | 1 |
| **E2E specs** | 1 | **0** | 2 | 1 | **0** |
| Stubs | 0 (1 dead URL) | **1** | 0 (1 aliased preview) | 1 placeholder | 1 (`supervisors: []`) |
| Own-contract-only | ✅ | ❌ 1 file | ✅ | ❌ 7 files | ✅ |
| Cross-service source import | none | none | none | none | none |

**Structure deviations (all five):** none has the mandated `src/app.config.ts`, local `src/config/`, `nest-cli.json`, `scripts/build.ts`, `scripts/entrypoint.dev.ts`, `dto/`, or `*.errors.ts`. No service has a `pkg-build.config.ts` — they run from source (`start: bun --bun src/main.ts`).

**Verified breakage:** `svc-project/src/modules/project/project.module.ts:2` and `module/service/service.module.ts:2` import `"../../core/modules/database/database.module"` — that path does not exist (`src/core/` is absent). Every sibling uses the `@/core/...` alias. **This is a live dangling import.**

### 1.3 Contracts

- Per-service contract coverage is **complete**: every controller's `@Implement` has a matching contract.
- `servicePreviewTopology` is mounted in the surface but has no web domain.
- Error declarations are **incomplete**: 26 of 30 `mesh.*` procedures declare no `.errors(...)`; whole modules omit them (`fleet/modules/nodes` 9/11, `fleet/modules/cluster` 6/15 streams, `github` 3/15, `runtime` `uploadBundle`).
- Duplicate definitions exist: `entities/setup/{state,node,initialize}.schema.ts` shadow `entities/setup/index.ts` with **different enum members** and are imported by nothing (dead + divergent).
- `scripts/check-service-surface-parity.py` exists but **is invoked by nothing** — no CI, no script, no hook. Its "fails the build if the two diverge" claim is false today.

### 1.4 Database

- One Postgres, one schema package (`@deployer/nest-schema`), **92 global tables**, 40 migrations; 6 SQLite local tables, 13 migrations.
- Ownership is real and enforced: 91 registry entries + `SHARED_TABLES` (8) + `INFRASTRUCTURE_TABLES` (1), checked by a 12-test spec **and** an ESLint rule (`deployer-schema/boundary`) that reads the registry from disk at lint time. **0 violations across all 5 services.**
- `TableOwner` includes a `"monolith"` member assigned to **zero tables** — dead union member.
- **Stale mirror to remove:** `apps/api/src/config/drizzle/global/migrations/` duplicates the package's 39 files but its journal stops at `0037` while the package has `0038`. Three call sites in `shared/` walk relative paths to it.

### 1.5 Tests

- **663 tests green** across six suites (`identity` 64, `project` 127, `runtime` 288, `fleet` 142, `health` 6, `bff` 36) — `docs/qa/api-services/phase-report.md:252`. A different doc claims 671/fleet 139 — **the two disagree**.
- `apps/api-services/shared` (79 spec files, ~919 tests) has **no recorded green count** in any doc.
- **No skipped tests** anywhere — the suite hides nothing behind `.skip`.
- The e2e gap is the real weakness: only 5 e2e files total, and almost none exercise a procedure over HTTP. `project` and `health` ship an `e2e/runtime.ts` that **no spec imports**.

### 1.6 Documentation contradictions

| # | Contradiction | Resolution |
|---|---|---|
| C-3 | Plan says services "not done"; another doc counts all 6 built | Plan checkboxes were never updated |
| C-5 | Ports: docs say 3006–3009; code uses **3101–3105** | Code wins |
| C-8 | Doc says `apps/setup` deleted; it exists on disk | Doc is wrong |
| C-9 | Doc says `apps/api/src` emptied; it is intact (766 files) | Doc states a goal as done |
| C-7 | Test totals 671 vs 663 | Unresolved |

---

## 2. When can web link to the BFF?

### 2.1 The surprising part: **web source is already done**

- `apps/web` has **zero** imports of `@deployer/contracts-api` (the package does not exist).
- `@deployer/bff-contracts` is already a dependency (`apps/web/package.json:50`).
- `apps/web/src/lib/orpc/app-contract.ts` already mounts `bff`, `console`, `setup`, `test`, `template` + `serviceSurface()`.
- Only one origin changes: `apps/web/src/lib/orpc/index.ts:72-78` reads `API_URL` (SSR) / `NEXT_PUBLIC_API_URL` (browser).

**No web source rewrite is required.** The 18 service namespaces survive because the BFF serves the same paths.

### 2.2 Important caveat — screens are still composed in the browser

`apps/web/src/lib/orpc/app-contract.ts:19` documents the target: *"A screen asks for a screen (`orpc.bff.projectDetail`)"*. Reality:

```
orpc.bff.* / orpc.console.* call sites in apps/web/src: 1  (a comment)
orpc.project.* 42   orpc.docker.* 36   orpc.providers.* 31   orpc.mesh.* 27
```

The BFF's 7 orchestration procedures are **contracted and implemented but unconsumed**. The front still does its own fan-out and joining across the 18 service namespaces. Linking web to the BFF therefore works *immediately* but delivers **no architectural benefit yet** — the screens still know service topology. Adopting `orpc.bff.*` per screen is separate, incremental work.

### 2.3 The four deployment changes

| # | Change | File |
|---|---|---|
| 1 | Add a `web` service + include | `infra/docker/compose/docker-compose.services.dev.yml` (currently has **no** web include) |
| 2 | Point `API_URL` at `http://bff:3005` | `infra/docker/compose/common/web/docker-compose.config.dev.yml:31,38` |
| 3 | Set `NEXT_PUBLIC_API_URL` / port to the BFF and **rebuild** (`NEXT_PUBLIC_*` is inlined at build) | `.env`, prod compose |
| 4 | Add `NEXT_PUBLIC_APP_URL` / `APP_URL` to the `bff` service so Better Auth trusts the web origin | `common/api/docker-compose.config.services.yml` |

Plus one fix: `apps/web/package.json:15` hardcodes a `wait-port api:3001` fallback.

### 2.4 Auth — will it just work?

**Yes.** The BFF is already the sole session authority; `apps/api-services/shared/src/auth.ts` is the same Better Auth factory the monolith uses (diff: 2 import lines). Same cookie name (`better-auth.session_token`), same `/api/auth` base path, same plugin set.

Two conditions: `AUTH_SECRET`/`BETTER_AUTH_SECRET` must match between web and BFF (web decrypts the cookie locally via `getCookieCache`), and `TRUSTED_ORIGINS` must include the web origin (currently defaults to `http://localhost:3000`).

**Auth tables are owned by `identity`** in the registry (`table-ownership.ts:88-105`) even though the BFF writes them — a documented deliberate exception, but the registry does not model it.

---

## 3. When can `apps/api` be deleted?

### 3.1 Blockers, ordered

| # | Blocker | Evidence | Severity |
|---|---|---|---|
| **1** | **`mesh.*` + `meshResource.*` are delegated to `svc-fleet`, which does not host them.** Both delegation files call `clients.for("fleet", …)`. `MeshCoreModule` (which declares both controllers) is imported by `svc-runtime` and `shared` modules — **zero references in `svc-fleet`**. Every mesh call through the BFF 404s. | `mesh.delegation.ts:43`, `meshResource.delegation.ts:43`; grep `MeshCoreModule` in `services/fleet/` → none | **Critical** |
| **2** | **The BFF does not serve `/health/ready`** yet compose probes it for all six apps. `ServiceHealthModule` is imported by all five services and **not** by `BffModule`. The BFF stays unhealthy forever → any `depends_on: bff: service_healthy` is unsatisfiable. | `bff.module.ts` imports; `docker-compose.config.services.yml:82` | **Critical** |
| **3** | **No BFF/services image for prod.** Every image is `Dockerfile.app.dev` (dev-only). `Dockerfile.api.prod` hardcodes `turbo prune api`. In prod, setup schedules the **monolith** image. | `infra/docker/builder/api/Dockerfile.api.prod:39,57` | **Critical** |
| **4** | **No ingress → BFF.** Traefik's backend is `deployer-api` (`platform-names.ts`). Nothing in the shared ingress code references `bff` or `svc-*`. | `supervisors/platform/traefik-supervisor.service.ts` | High |
| **5** | **Boot coordination unwired.** `BootstrapModule` (migrations + seed + admin) and `SwarmInventoryModule` are imported by **nothing** in `api-services`. | grep → only own definitions | High |
| **6** | **SSR not wired in the BFF.** `views/**` exists but no `RenderModule`, no `vite.config`, no `build:client`. `SsrAuthGuardMiddleware` is registered by **no module** → `/manage/*` would be unguarded once it renders. | grep `RenderModule` in api-services → 0 | High |
| **7** | **No OpenAPI/Scalar.** Monolith owns `openapi.ts`, `generate-openapi.ts`, `/openapi.json`, `/reference`. Absent in api-services. Breaks the devtools iframe. | grep → 0 hits | Medium |
| **8** | **Zero e2e for project/health**; the BFF contract test (Phase 8) never written — the one that would have caught blocker 1. | `phase-report.md:143` | Medium |
| **9** | **`configurator` service absent** though `ARCHITECTURE.md:22` lists it. | `services/` listing | Medium |
| **10** | Stale migration mirror + 3 relative-path walks in `shared/` that only work because `apps/api` exists. | `apps/api/src/config/drizzle/global/migrations/` | Medium |

### 3.2 Live references to delete/redirect

- `scripts/verify-mesh-master-decision.ts:12` — a real **code import** of `../apps/api/src/core/modules/swarm/services/swarm-join-grant.service`.
- `tooling/vitest/src/service.ts` borrows `apps/api/vitest.{global-setup,setup}.e2e.ts` as the e2e hooks for every service.
- `tooling/dependency-builder`, `scripts/check-di-graph.ts:21`, `analyze-cycle-cost.py`, `scripts/sync-api-vitest-aliases.py:37`, `knip.config.ts`, `.github/dependabot.yml:47`, `.github/workflows/deploy.yml:57`.
- Compose: `docker-compose.dev.yml`, `mesh-6.dev.yml` (×7 includes), `*.prod.yml`, `*.dev-supervised.yml`, `builder/api/*`.

### 3.3 Monolith size (what deletion actually removes)

| Area | Files (`.ts`/`.tsx`) |
|---|---|
| `core/**` | 402 |
| `modules/**` | 296 |
| `e2e/**` | 30 |
| root + cli + config + views | 38 |
| **Total** | **766** |

`api-services/shared/src/core/**` is **402 files** — the monolith's `core/` copied verbatim. The shared packages both trees import (`packages/**`) all survive.

---

## 4. Recommended sequence

**Phase A — unblock (blockers 1–3).** Point mesh delegation at a service that hosts `MeshCoreModule` (or import it into fleet); import `ServiceHealthModule` into `BffModule`; add a prod Dockerfile parameterised like `Dockerfile.app.dev`. *After this the split is deployable.*

**Phase B — link web.** The four compose/env changes from §2.3. Web links with no source rewrite. *After this web runs against the BFF.*

**Phase C — verify.** Write the Phase 8 BFF contract test (samples delegated procedures over HTTP) and an e2e each for `project` and `health`. This is what proves Phase A worked.

**Phase D — wire the rest.** Ingress → BFF (4), `BootstrapModule` + `SwarmInventoryModule` (5), SSR/`SsrAuthGuardMiddleware` (6), OpenAPI (7), the stale migration mirror (10).

**Phase E — delete.** Compose profiles, tooling references, then `apps/api/**`. Note it deletes 766 files while removing ~0 shared code — `packages/**` is untouched.

> **Do not skip Phase C.** Every blocker in §3.1 is invisible to the current test suite. Blocker 1 is a routing mismatch between two hand-maintained lists; the parity script that could catch that class of bug exists and is invoked by nothing.

---

## 5. Change log — 2026-10-16

### Blockers closed

| Blocker | Fix | Verified by |
|---|---|---|
| **1. mesh 404** — `mesh`/`meshResource` delegated to `svc-fleet`, but `MeshCoreModule` (which declares those controllers) was imported only by `runtime` and `shared`. | `MeshCoreModule` added to `FleetServiceModule`. Fleet owns `meshContract`, so fleet is where the delegation target must resolve. | fleet suite boots and passes 142/142 (the e2e boots the whole app graph, so DI resolution is proven, not inferred). |
| **2. BFF `/health/ready` 404** — `PreflightModule` bound `SERVICE_READINESS` but nothing served the route, while compose probes that exact path for all six apps. | `ServiceHealthModule` imported into `BffModule`. | BFF type-checks; route now has an owner. |
| **Web not in the services profile** — the profile proved the BFF served but never that the browser path worked. | `web-dev` added, `API_URL: http://bff:3005`, gated on `bff: service_healthy`. | compose YAML parses; 13 services, 0 duplicate keys. |
| **`@/` broken imports in `contracts-entities`** — 33 imports across 3 files pointed at `@/entities/...`, which resolves to nothing in a package. Fleet's suite failed at collection. | Rewritten to the package-absolute form. | fleet suite collects and passes. |

### Entities first — the domain layer

`svc-project` had **no domain layer at all**; its access policy was stated as a role list at **32 call sites**, and those lists named `"admin"` and `"developer"` — roles the permission builder does **not** define. The real vocabulary is `owner`/`maintainer`/`deployer`/`viewer`, so `allowedRoles.includes(role)` never matched:

> **Every non-owner collaborator was denied everything.** A `maintainer` could not read a project they had been invited to. The repository already mapped legacy rows to canonical names, so the stored data was right — only the comparison was wrong.

Now:

- `src/modules/project/domain/project.entity.ts` — a pure entity (no Nest, no Drizzle, no HTTP) exporting `projectRules`, the role vocabulary **derived from the contract schema** (`Collaborator["role"]`, so an undefined role cannot be written), and an access-LEVEL API (`"read" | "deploy" | "manage" | "admin"`) replacing the repeated role lists.
- `assertProjectAccess` takes a level and delegates; the 32 call sites became 13 `"read"` + 19 `"admin"`.
- Ownership rules moved in with it: deleting is the owner's alone (`maintainer` is defined as management *without* deletion, so it cannot be folded into an admin level), and the owner's membership cannot be edited, removed, or granted through the collaborator API.
- `project.entity.spec.ts` — 12 tests pinning the regression (including a test asserting `admin`/`developer` are *not* roles) plus the full access matrix.

### Two enabling fixes

Without these the entity could not throw, which is why the service layer had been throwing NestJS exceptions instead (a layering violation the architecture forbids):

1. **`AppError` now carries `httpStatus` and `orpcCode`**, derived from its `code` via one table. A domain error previously had nowhere to say "this is 404".
2. **The oRPC error interceptor maps `AppError`** alongside the NestJS and mesh branches, emitting the identical payload shape so clients still receive *defined* errors.

### Also fixed

- `svc-project` **could not boot**: `ProjectDomainModule` was never `export`ed (the class existed, so it type-checked in isolation but the root module's import failed), `ServiceModule` was not named `ServiceDomainModule`, and two module files imported `../../core/...`, a path that does not exist.
- `project-event.service.ts` declared its own `role` enum listing `admin`/`developer`, so the emitted event failed its own schema on every invite. Now uses `projectRoleSchema`.
- `database.module.spec.ts` stubbed the *package* module without `forRootAsync`, while its subject imports the app-local *wrapper* that calls it. The suite failed at **collection** with 927 tests never running — and vitest reported the file, not a test, so it looked like nothing was wrong. Every api-services suite is green now.
- The e2e fixture's enum columns (`builderId`, `providerId`) widened to `string`; `as const` restores the inference.

### Type-check: 41 → 0 in `apps/web`, 19 → 0 in `svc-runtime`

Most lingering type errors were **stale `dist`** in the contract packages, not real defects — rebuilding what they consume was the fix. That is a workflow hazard worth noting: `pkg-build` output is git-ignored, so a consumer can type-check against types that no longer match the source it just changed.

### Current verified state

| Suite | Files | Tests |
|---|---|---|
| `shared` | 79 | 932 |
| `bff` | 5 | 36 |
| `svc-identity` | 4 | 64 |
| `svc-project` | 9 | 139 |
| `svc-runtime` | 32 | 288 |
| `svc-fleet` | 18 | 142 |
| `svc-health` | 1 | 6 |
| **Total** | **148** | **1607** |

Type-check: **0 errors across 10 projects** (`errors`, `shared`, `bff`, 5 services, `apps/setup`, `apps/web`).

### Still outstanding

- Prod image for the BFF/services (blocker 3) and ingress → BFF (blocker 4).
- `BootstrapModule` + `SwarmInventoryModule` imported by nothing (blocker 5).
- SSR/`SsrAuthGuardMiddleware` unwired in the BFF (blocker 6).
- The BFF's 7 `bff.*` orchestration procedures are implemented but **unconsumed** — the front still fans out across the 18 service namespaces itself, so it still knows service topology. Adopting `orpc.bff.*` per screen is incremental.
- `scripts/check-service-surface-parity.py` is still invoked by nothing, which is why blocker 1 existed undetected.
- No domain layer yet in `svc-fleet`, `svc-runtime` or `svc-identity` beyond the two existing entities.

