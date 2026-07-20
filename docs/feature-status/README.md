# Feature Status Assessment

> **Last updated:** 2026-07-20
> **Scope:** Full monorepo — `apps/api`, `apps/web`, `packages/*`, infra
> **Methodology:** Knip static analysis, grep searches, manual code review — post-cleanup assessment

## Status Legend

| Status | Meaning |
|--------|---------|
| ✅ **WORKING** | Fully implemented with real data flow, real API calls, real DB/queries |
| ⚠️ **PARTIAL** | Implementation exists but has known gaps (missing features, TODOs, limited functionality) |
| 📋 **PLANNED** | Contract defined but no implementation |
| 💀 **DELETED** | Previously flagged as dead code, verified zero importers, and removed in cleanup |

## Cleanup Summary

**Completed 2026-07-20 — All phases done:**
- 🧹 Dead code: 250→48 unused files (202 removed)
- 🔗 Mock→Real: 26→0 mock imports (all pages migrated to real data)
- 🔒 Type safety: Fixed 12/14 `as any` files (2 were pragmatically justified)
- 🏗️ Architecture: Deleted `packages/nest/auth/`, fixed hardcoded href, centralized env vars
- 💀 Removed orphaned apps: `apps/test/`, `apps/observable-poc/`, `reference/`

## Dashboard View

### API (Backend) — 16 Product Modules

```
Analytics      ─── ✅ WORKING (real service, real controller, real contract)
Deployment     ─── ✅ WORKING (18 tests, full CRUD + streams + queue + state machine)
Docker         ─── ✅ WORKING (complex, 8 domains, SSE streams, real dockerode)
Domain         ─── ✅ WORKING (3 domain types: org/project/service)
Fleet          ─── ✅ WORKING (services exist, no controller needed — internal module)
GitHub         ─── ⚠️ PARTIAL (webhook controller works but NO ORPC contract)
Health         ─── ✅ WORKING (real controller, service, repository)
Organization   ─── ✅ WORKING (CRUD + members + invites)
Permission     ─── ⚠️ PARTIAL (internal only, no HTTP exposure. OK by design)
Project        ─── ✅ WORKING (CRUD + envs + templates + collaborators, some TODOs)
ProviderSchema ─── ✅ WORKING (schema resolution for providers/builders)
Push           ─── ✅ WORKING (Web Push API subscriptions + notifications)
Service        ─── ✅ WORKING (CRUD + lifecycle + dependencies + streams)
Setup          ─── ✅ WORKING (node status, probe, initialize, hints)
Test           ─── ✅ WORKING (auth test endpoints, upload/download, stream)
User           ─── ✅ WORKING (CRUD + email check + count)
```

### API Core (Infrastructure) — Remaining Modules

After cleanup, the following DEAD modules were removed:
`ephemeral-http`, `loader`, `state-machine`, `sub-app-orchestrator`, `mesh/examples/`, `context/docs/`, `system/fleet`, `system/mesh` (dead controllers), `system/system.module`

Still present and active:
```
Auth           ─── ✅ WORKING (Better Auth, middleware, guards, ORPC)
Bootstrap      ─── ✅ WORKING (app initialization)
Configuration  ─── ✅ WORKING (env/config management)
Context/types  ─── ✅ KEPT (used by traefik-variable-resolver)
Database       ─── ✅ WORKING (Postgres global + SQLite local)
Events         ─── ✅ WORKING (event bus, outbox, dispatch)
Git/core       ─── ✅ KEPT (used by deployment/providers module)
Lifecycle      ─── ✅ WORKING (lifecycle management)
Mesh           ─── ✅ WORKING (distributed coordination, 15 tests)
Traefik        ─── ⚠️ PARTIAL (config builder, 7 tests)
Triggers       ─── ✅ WORKING (bridge foundation for sub-app pipeline)
SubAppRunner   ─── ✅ WORKING (bridge system — used by orchestrator)
```

### Web Frontend — All Pages Now Use Real Data

```
Page                          Status    Data Source
─────────────────────────────────────────────────────────────
Auth (signin, signup)         ✅       Better Auth
Setup Wizard                  ✅       Real API calls
Docker (all 10 pages)         ✅       Real dockerode + SSE streams
Deployments List              ✅       useDeploymentList()
Projects List                 ✅       useProjectList() + real mutations
Services List                 ✅       useServiceList()
Admin (users, servers, org)   ✅       Real domain hooks
Profile                       ✅       Real user hooks
Project Detail                ✅       Real hooks (mocks removed)
Project Config                ⚠️       Null data pages (UI shells present)
Service Pages (11)            ⚠️       Null data pages (mocks removed, no API yet)
Docker Modals                 ⚠️       Real data + removed mock-only tabs
```

```
System/Fleet   ─── 💀 DEAD (4 files, completely unused — superseded by modules/fleet)
System/Mesh    ─── ⚠️ PARTIAL (controllers exist but system/SYSTEM.MODULE is DEAD)
```

### Sub-Apps

```
Auth SubApp            ─── 💀 DEAD (empty directory)
MeshInitializer SubApp ─── ✅ WORKING (bridge + service wired in pipeline)
SetupWizard SubApp     ─── 💀 DEAD (6 files, completely unused — superseded by modules/setup)
```

### Web Frontend — Pages (Updated 2026-07-20)

```
Auth (signin, signup, error, me)     ─── ✅ WORKING (real Better Auth flow)
Setup Wizard                          ─── ✅ WORKING (real API calls + probes)
Dashboard Home                        ─── ✅ WORKING (real data)
Docker Containers                     ─── ✅ WORKING (SSE streams, real dockerode)
Docker Images                         ─── ✅ WORKING (SSE streams)
Docker Networks                       ─── ✅ WORKING (real data)
Docker Volumes                        ─── ✅ WORKING (real data)
Docker Stacks                         ─── ✅ WORKING (real data)
Docker Registry                       ─── ✅ WORKING (real data)
Docker Logs                           ─── ✅ WORKING (stream logs)
Docker Activity                       ─── ✅ WORKING (SSE activity stream)
Docker Events                         ─── ✅ WORKING (event stream)
Docker Shell                          ─── ⚠️ PARTIAL
Deployments List                      ─── ✅ WORKING (useDeploymentList())
Services List                         ─── ✅ WORKING (useServiceList())
Projects List                         ─── ✅ WORKING (useProjectList() + real mutations)
Project Detail                        ─── ✅ WORKING (real hooks, mocks removed)
Project Config                        ─── ⚠️ PARTIAL (UI shell, mocks removed)
Service Detail                        ─── ⚠️ PARTIAL (UI shell, mocks removed)
Service Config (all subtabs)          ─── ⚠️ PARTIAL (UI shell, mocks removed)
Service Deployments                   ─── ⚠️ PARTIAL (UI shell, mocks removed)
Service Logs                          ─── ⚠️ PARTIAL (UI shell, mocks removed)
Service Monitoring                    ─── ⚠️ PARTIAL (UI shell, mocks removed)
Service Previews                      ─── ⚠️ PARTIAL (UI shell, mocks removed)
Admin Users                           ─── ✅ WORKING (real user CRUD)
Admin Servers                         ─── ✅ WORKING (real mesh data)
Admin System                          ─── ✅ WORKING
Admin Organizations (list + detail)   ─── ✅ WORKING
Profile                               ─── ✅ WORKING
```

### Orphaned Apps

```
apps/test/             ─── 💀 DEAD (Jest-based, not integrated, not in docker-compose)
apps/observable-poc/   ─── 💀 DEAD (standalone Next.js, no pipeline, no compose)
packages/poc/core-sync-system/ ─── 💀 DEAD (no consumer)
app/doc/               ─── ✅ WORKING (Fumadocs, the documentation site)
```

## Test Coverage Summary

| Area | Test Files | Status |
|------|:---------:|--------|
| API Modules | 108 spec files | ✅ Good coverage for core domains |
| API Core | ~50 spec files | ✅ Auth (8), Mesh (15), Database (4) well tested |
| Web Frontend | 10 test files | ❌ Very low — only setup + auth tests |
| Contracts | 7 test files | ⚠️ Sparse |
| Utils/Packages | 41 test files | ⚠️ Moderate |

## Quick Navigation

| File | Content |
|------|---------|
| [WORKING.md](./WORKING.md) | Fully working features with real data flow |
| [NOT-WORKING.md](./NOT-WORKING.md) | Non-working features, stubs, dead code |
| [MOCKED.md](./MOCKED.md) | Features using mock/fake data |
| [EXHAUSTIVE-FEATURE-LIST.md](./EXHAUSTIVE-FEATURE-LIST.md) | Complete catalog of every feature with status |
