# ✅ Working Features

> Features with fully functional implementations — real API calls, real database queries, real data flow from backend to frontend.

---

## 1. API Backend — Product Modules

### 1.1 Docker Management (✅ WORKING — Most Complex Feature)

**Status:** Fully working with real Docker daemon integration via `dockerode`.

**API Contracts:** `packages/contracts/api/modules/docker/`
**API Implementation:** `apps/api/src/modules/docker/`
**Web Pages:** `apps/web/src/app/dashboard/docker/`

**Capabilities:**
- **Containers:** List, inspect, grouped list, logs stream, processes, files (read/write/create/delete), terminal (open/input/close/stream), runtime actions
- **Images:** List, inspect, security scan stream
- **Networks:** List
- **Volumes:** List
- **Registries:** List, detail
- **Stacks:** List, detail
- **Runtime:** Events stream, snapshot, activity list/detail/stream
- **Entity (unified):** List, inspect, stream (SSE-based real-time updates for all entity types)
- **Containers + Images live streams:** Real-time SSE updates via `useDockerLiveContainers` / `useDockerLiveImages`

**Architecture:** Container module profile — 8 domains (`containers`, `images`, `networks`, `volumes`, `registries`, `stacks`, `runtime`, `entity`)

**Tests:** 7 spec files in the docker module

### 1.2 Deployment Management (✅ WORKING)

**Status:** Fully working with ORPC contract, CRUD, streams, queue, state machine, rollback, plan compilation.

**API Contracts:** `packages/contracts/api/modules/deployment/`
**API Implementation:** `apps/api/src/modules/deployment/`

**Capabilities:**
- **CRUD:** List, findById, delete, trigger, uploadBundle, cancel, rollback, retry
- **Logs:** Get logs, stream
- **Rollback:** Get rollback history
- **Plans:** Template provenance, compiled plan snapshots (create, get, list), compile plan, compile plan preview, compile rollback edges
- **State Machine:** List phase transitions, validate transition, apply transition
- **Queue:** Claim jobs, complete, fail, enqueue, heartbeat, list, find, dead letter management, replay
- **Lifecycle Events:** Emit, list, stream node lifecycle events
- **Execution:** Cancel, resume, get checkpoint
- **Retry Policy:** List catalog, resolve policy
- **Streams:** Service deployments stream, query stream, internal stream

**Architecture:** Standalone module profile with nested sub-modules (adapters, builders, events, mesh, preview, providers, runners, queue, storage)

**Tests:** 18 spec files — highest coverage in the codebase

### 1.3 User Management (✅ WORKING)

**API Contracts:** `packages/contracts/api/modules/user/`
**API Implementation:** `apps/api/src/modules/user/`

**Capabilities:**
- CRUD: List, findById, create, update, delete
- checkEmail, count

**Tests:** 4 spec files

### 1.4 Organization Management (✅ WORKING)

**API Contracts:** `packages/contracts/api/modules/organization/`
**API Implementation:** `apps/api/src/modules/organization/`

**Capabilities:**
- Admin sub-router, List all, List members
- Invitations (accept, reject, manage)

**Tests:** 2 spec files

**Web integration:** 6 page files use organization hooks (`admin/organizations/`, `admin/system/`, auth components)

### 1.5 Project Management (✅ WORKING with TODOs)

**API Contracts:** `packages/contracts/api/modules/project/`
**API Implementation:** `apps/api/src/modules/project/`

**Capabilities:**
- CRUD: List, findById, create, update, delete
- **Collaborators:** Get, invite, update, remove
- **Environments:** List, get, create, update, delete, clone
- **Templates:** List, get, create, update, delete
- **Config:** Deployment, environment, general, notification, resource, security (get + update for all)
- **Utils:** getAllEnvironmentStatuses, getAvailableVariables, getEnvironmentStatus, refreshEnvironmentStatus, resolveVariables
- **Query Stream**
- **Webhooks:** Repository-based with API key auth

**Known Gaps (TODOs):**
- `project.controller.ts:337,354`: `servicesCount: 0` — TODO: join with services
- `project.controller.ts:367`: TODO: trigger actual health check
- `project.service.ts:739,752`: TODO: integrate with variable-resolver module
- `project.repository.ts:573`: TODO: consider adding projectId to variableTemplates

**Tests:** 4 spec files

### 1.6 Health Check (✅ WORKING)

**API Contracts:** `packages/contracts/api/modules/health/`
**API Implementation:** `apps/api/src/modules/health/`

**Capabilities:**
- `GET /health` — basic health check (working, verified via curl)
- `GET /health/detailed` — detailed health information

**Tests:** 4 spec files

### 1.7 Setup Wizard (✅ WORKING)

**API Contracts:** `packages/contracts/api/modules/setup/`
**API Implementation:** `apps/api/src/modules/setup/`

**Capabilities:**
- getState, getNodeStatus, probeDatabase, probeMesh, remoteAuth, initialize, listHints, dismissHint

**Web Pages:** `apps/web/src/app/setup/page.tsx`

**Note:** There's a **DEAD duplicate** at `apps/api/src/sub-apps/setup-wizard/` (6 unused files). The working version is in `modules/setup/`.

**Tests:** 1 spec file

### 1.8 Push Notifications (✅ WORKING)

**API Contracts:** `packages/contracts/api/modules/push/`
**API Implementation:** `apps/api/src/modules/push/`

**Capabilities:**
- subscribe, unsubscribe, getPublicKey, getSubscriptions, sendTestNotification, getStats
- Uses Web Push API

**Tests:** 3 spec files

**Web integration:** Hooks used in `auth/me/page.tsx` and `components/push-notifications/`

### 1.9 Analytics (✅ WORKING)

**API Contracts:** `packages/contracts/api/modules/analytics/`
**API Implementation:** `apps/api/src/modules/analytics/`

**Capabilities:**
- Resource metrics, application metrics, database metrics, deployment metrics, service health
- Real-time metrics, resource usage, user activity, API usage
- Reports: generate, list, get, delete, download
- Report configs: create, list, update, delete

**Tests:** 2 spec files

### 1.10 Provider Schema (✅ WORKING)

**API Contracts:** `packages/contracts/api/modules/provider-schema/`
**API Implementation:** `apps/api/src/modules/provider-schema/`

**Capabilities:**
- getAllProviders, getProviderSchema, getCompatibleBuilders
- getAllBuilders, getBuilderSchema, getCompatibleProviders
- validateProviderConfig, validateBuilderConfig

**Tests:** 2 spec files

### 1.11 Test Endpoints (✅ WORKING)

**API Contracts:** `packages/contracts/api/modules/test/`
**API Implementation:** `apps/api/src/modules/test/`

**Capabilities:**
- nonAuthenticated, authenticated, fileUpload, fileDownload, streamOutput

**Note:** This is an internal testing utility — not a product feature.

**Tests:** 0 spec files

### 1.12 Domain Management (✅ WORKING)

**API Contracts:** `packages/contracts/api/modules/domain/`
**API Implementation:** `apps/api/src/modules/domain/`

**Capabilities:**
- Organization domains: list, add, get, verify, delete
- Project domains: list, get available, add, update, remove
- Service domains: check subdomain availability, list, add, update, set primary, remove

**Tests:** 3 spec files

---

## 2. API Backend — Core Infrastructure

### 2.1 Authentication (✅ WORKING)

**Implementation:** `apps/api/src/core/modules/auth/`

**Capabilities:**
- Better Auth integration (server + client)
- Session management, email/password sign-in/sign-up
- Organization-based permissions
- Platform roles (admin, member)
- ORPC auth middleware + guards
- Master token plugin for service-to-service auth
- Anonymous/optional auth decorators

**Architecture:** Built-in (internal) — the shared `packages/nest/auth/` is **DEAD** (20+ files, superseded by this)

**Tests:** 8 spec files

### 2.2 Database (✅ WORKING)

**Implementation:** `apps/api/src/core/modules/database/`

**Capabilities:**
- **Global DB:** PostgreSQL via Drizzle ORM
- **Local DB:** SQLite via better-sqlite3
- Custom types (encrypted text, custom drizzle types)
- Migration pipeline (`api-db generate/push/migrate`)
- Auth schema auto-generation (`auth:generate`)

**Tests:** 4 spec files

### 2.3 Mesh (✅ WORKING)

**Implementation:** `apps/api/src/core/modules/mesh/`

**Capabilities:**
- Distributed peer-to-peer node coordination
- Multi-node Docker host management
- Peer discovery, sessions, event streams
- Topology streaming, resource lookup/index
- Trust keyring (status, secrets, rotate, convergence, strict mode)
- Node configuration management
- Join grants, membership reconciliation

**Tests:** 15 spec files — highest core module coverage

### 2.4 Events (✅ WORKING)

**Implementation:** `apps/api/src/core/modules/events/`

**Capabilities:**
- Event contracts with builder pattern
- Event bus with publish/subscribe
- Outbox pattern
- Core event sync service

**Tests:** 3 spec files

### 2.5 Lifecycle (✅ WORKING)

**Implementation:** `apps/api/src/core/modules/lifecycle/`

**Capabilities:**
- App lifecycle management (startup, shutdown hooks)
- Bootstrap pipeline orchestration

---

## 3. Web Frontend — Working Pages

### 3.1 Docker Dashboard (All Docker pages)

**Pages:** containers, images, networks, volumes, stacks, registry, logs, activity, events
**Data source:** Real — `@/domains/docker/hooks.ts` with SSE live streams
**Pattern:** Deferred values for SSE performance, real-time updates
**UX:** Loading states, error handling, empty states

### 3.2 Admin Pages

**Pages:** Users, Servers, System, Organizations (list, detail, members, invites, settings, new)
**Data source:** Real — domain hooks connected to real API contracts

### 3.3 Authentication Flow

**Pages:** Sign-in, Sign-up, Auth error, My profile
**Data source:** Real — Better Auth flow with session management

### 3.4 Setup Wizard

**Page:** `/setup`
**Data source:** Real — `@/domains/setup/hooks.ts` with real API calls
**Note:** Some steps use `fetch("/api/auth/sign-in/email")` directly (ORPC bypass)

### 3.5 Profile

**Page:** `/dashboard/profile`
**Data source:** Real — user domain hooks

---

## 4. Other Working Apps

### 4.1 Documentation App (apps/doc)

**Status:** ✅ WORKING
**Framework:** Fumadocs (Next.js-based)
**Content:** architecture/, deployment/, dev/, docker/, intro/, reference/, testing/, tooling/
The documentation covers most major features.

### 4.2 Load Balancer (apps/load-balancer)

**Status:** ✅ WORKING
**Capabilities:**
- Load balancing service with controller + service + types
- Auth module (API session auth)
- Health endpoint
- Integrated in docker-compose (dev, prod-like, prod, mesh-6)

**Note:** Has actual consumers — referenced in docker-compose files, has spec files, wired in turbo pipeline.
