# Feature Status Assessment

> **Last updated:** 2026-07-17
> **Scope:** Full monorepo — `apps/api`, `apps/web`, `packages/*`, infra
> **Methodology:** Knip static analysis, grep searches, manual code review of every module

## Status Legend

| Status | Meaning |
|--------|---------|
| ✅ **WORKING** | Fully implemented with real data flow, real API calls, real DB/queries |
| ⚠️ **PARTIAL** | Implementation exists but has known gaps (missing features, TODOs, limited functionality) |
| 🧪 **MOCKED** | Uses mock/fake data instead of real API calls — UI exists but not connected to backend |
| ❌ **NOT WORKING** | Code exists but is broken, has stubs, or throws "not implemented" |
| 💀 **DEAD** | Code exists but is completely unused — no consumer, no route, no import |
| 📋 **PLANNED** | Contract defined but no implementation |
| 🔄 **MIGRATING** | In transition from old pattern to new pattern |

## Dashboard View

### API (Backend) — 16 Product Modules + 2 System Modules

```
Analytics      ─── ✅ WORKING (real service, real controller, real contract)
Deployment     ─── ✅ WORKING (18 tests, full CRUD + streams + queue + state machine)
Docker         ─── ✅ WORKING (complex, 7 domains, SSE streams, real dockerode)
Domain         ─── ✅ WORKING (3 domain types: org/project/service)
Fleet          ─── ⚠️ PARTIAL (services exist but NO controller — system/fleet is DEAD)
GitHub         ─── ⚠️ PARTIAL (webhook controller works but NO ORPC contract)
Health         ─── ✅ WORKING (real controller, service, repository)
Organization   ─── ✅ WORKING (CRUD + members + invites)
Permission     ─── ⚠️ PARTIAL (internal only, no controller, no HTTP exposure)
Project        ─── ✅ WORKING (CRUD + envs + templates + collaborators, some TODOs)
ProviderSchema ─── ✅ WORKING (schema resolution for providers/builders)
Push           ─── ✅ WORKING (Web Push API subscriptions + notifications)
Service        ─── ✅ WORKING (CRUD + lifecycle + dependencies + streams)
Setup          ─── ✅ WORKING (node status, probe, initialize, hints)
Test           ─── ✅ WORKING (auth test endpoints, upload/download, stream)
User           ─── ✅ WORKING (CRUD + email check + count)
```

### API Core (Infrastructure) — 23 Core Modules

```
Auth           ─── ✅ WORKING (Better Auth integration, middleware, guards, ORPC auth)
Bootstrap      ─── ✅ WORKING (app initialization pipeline)
Configuration  ─── ✅ WORKING (env/config management)
Context         ─── ❌ NOT WORKING (no module file, empty)
Database       ─── ✅ WORKING (Postgres global + SQLite local Drizzle setup)
DeploymentCore ─── ⚠️ PARTIAL (shared deployment utilities)
DockerCore     ─── ⚠️ PARTIAL (shared docker utilities, no tests)
DomainCore     ─── ⚠️ PARTIAL (shared domain utilities, no tests)
EphemeralHttp  ─── ❌ NOT WORKING (no module file, flakey)
Events         ─── ✅ WORKING (event system with contracts + outbox + dispatch)
Git            ─── ❌ NOT WORKING (no module file — services exist but unwired)
Lifecycle      ─── ✅ WORKING (app lifecycle management)
Loader         ─── 💀 DEAD (unused startup loader)
Mesh           ─── ✅ WORKING (distributed node coordination, 15 spec files)
ProjectCore    ─── ⚠️ PARTIAL (shared project utilities)
Reachability   ─── ✅ WORKING (node reachability checks)
SetupCore      ─── ✅ WORKING (initialization module)
StateMachine   ─── 💀 DEAD (completely unused)
SubAppOrch     ─── 💀 DEAD (superseded orchestrator)
SubAppRunner   ─── 💀 DEAD (superseded runner)
SystemMetrics  ─── ⚠️ PARTIAL (metrics collection, unknown if consumed)
Traefik        ─── ⚠️ PARTIAL (Traefik config builder, 7 tests, unknown if consumed)
Triggers       ─── ❌ NOT WORKING (no module file, empty)
```

### System Modules

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

### Web Frontend — Pages

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
Docker Shell                          ─── ⚠️ PARTIAL (terminal, may not be full)
Docker Terminal                       ─── ⚠️ PARTIAL (terminal)
Deployments List                      ─── 🧪 MOCKED (uses MOCK_DEPLOYMENTS)
Services List                         ─── 🧪 MOCKED (uses mock data)
Projects List                         ─── 🧪 MOCKED (uses MOCK_PROJECTS)
Project Detail                        ─── 🧪 MOCKED (mock data heavily)
Project Config                        ─── 🧪 MOCKED
Service Detail                        ─── 🧪 MOCKED
Service Config (all subtabs)          ─── 🧪 MOCKED
Service Deployments                   ─── 🧪 MOCKED
Service Logs                          ─── 🧪 MOCKED
Service Monitoring                    ─── 🧪 MOCKED
Service Previews                      ─── 🧪 MOCKED
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
