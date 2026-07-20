# 📋 Exhaustive Feature Catalog

> Complete inventory of every feature in the deployer platform, organized by domain.
> Each entry includes: status, implementation location, and verification method.

---

## Legend

| Column | Meaning |
|--------|---------|
| **Status** | ✅ Working / ⚠️ Partial / 🧪 Mocked / ❌ Not Working / 💀 Dead / 📋 Planned |
| **API** | Backend implementation status |
| **Web** | Frontend page/hook status |
| **Contract** | ORPC contract existence |
| **Tests** | Test file count |

---

## 1. 🐳 Docker Management

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 1.1 | Container list | ✅ | ✅ | ✅ | ✅ | 7 | Real dockerode integration, grouped list, SSE stream |
| 1.2 | Container inspect | ✅ | ✅ | ✅ | ✅ | | Real docker inspect |
| 1.3 | Container logs stream | ✅ | ✅ | ✅ | ✅ | | Real-time log streaming |
| 1.4 | Container processes | ✅ | ✅ | ❌ | ✅ | | List + stream processes |
| 1.5 | Container files | ✅ | ✅ | ❌ | ✅ | | Read, write, create dir, rename, delete |
| 1.6 | Container terminal | ⚠️ | ✅ | ⚠️ | ✅ | | Open/input/close/stream — web shell may be partial |
| 1.7 | Container runtime actions | ✅ | ✅ | ❌ | ✅ | | Start/stop/restart/kill/etc |
| 1.8 | Container linked list | ✅ | ✅ | ❌ | ✅ | | Linked containers view |
| 1.9 | Container create modal | ✅ | ✅ | ✅ | ✅ | | Docker create container UI |
| 1.10 | Container detail modal | ⚠️ | ✅ | ⚠️ | ✅ | | Uses real hooks + supplementary mock data |
| 1.11 | Image list | ✅ | ✅ | ✅ | ✅ | 7 | Real dockerode image listing |
| 1.12 | Image inspect | ✅ | ✅ | ❌ | ✅ | | |
| 1.13 | Image security scan | ⚠️ | ✅ | ❌ | ✅ | | Stream-based scan |
| 1.14 | Image detail modal | ✅ | ✅ | ✅ | ✅ | | Real data |
| 1.15 | Network list | ✅ | ✅ | ✅ | ✅ | 7 | Real dockerode network listing |
| 1.16 | Network detail modal | ⚠️ | ✅ | ⚠️ | ✅ | | Real + supplementary mock |
| 1.17 | Volume list | ✅ | ✅ | ✅ | ✅ | 7 | Real dockerode volume listing |
| 1.18 | Volume detail modal | ⚠️ | ✅ | ⚠️ | ✅ | | Real + supplementary mock |
| 1.19 | Registry list | ✅ | ✅ | ✅ | ✅ | 7 | Docker registry management |
| 1.20 | Registry detail modal | ✅ | ✅ | ✅ | ✅ | | Real data |
| 1.21 | Stack list | ✅ | ✅ | ✅ | ✅ | 7 | Docker compose stacks |
| 1.22 | Stack detail modal | ⚠️ | ✅ | ⚠️ | ✅ | | Real + supplementary mock |
| 1.23 | Runtime events stream | ✅ | ✅ | ✅ | ✅ | | SSE-based real-time Docker events |
| 1.24 | Runtime snapshot | ✅ | ✅ | ❌ | ✅ | | Point-in-time state capture |
| 1.25 | Runtime activity | ✅ | ✅ | ✅ | ✅ | | Activity list/detail/stream |
| 1.26 | Live container stream | ✅ | ✅ | ✅ | ❌ | | `useDockerLiveContainers` — SSE auto-update |
| 1.27 | Live image stream | ✅ | ✅ | ✅ | ❌ | | `useDockerLiveImages` — SSE auto-update |
| 1.28 | Entity stream (unified) | ✅ | ✅ | ❌ | ✅ | | Cross-entity-type SSE stream |
| 1.29 | Scan config | 💀 | ✅ | ❌ | ❌ | | `docker-project-scan-config.repository.ts` — DEAD |
| 1.30 | Logs viewer page | ✅ | ✅ | ✅ | ✅ | | Docker logs with runtime event integration |
| 1.31 | Activity page | ✅ | ✅ | ✅ | ✅ | | Activity feed with SSE |
| 1.32 | Events page | ✅ | ✅ | ✅ | ✅ | | Event stream viewer |
| 1.33 | Web terminal | ⚠️ | ✅ | ⚠️ | ✅ | | Shell + terminal pages |
| 1.34 | Queue viewer | ⚠️ | ✅ | ⚠️ | ✅ | | `docker/queu/` (typo — should be "queue") |

---

## 2. 📦 Deployment Management

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 2.1 | Deployment list | ✅ | ✅ | 🧪 | ✅ | 18 | API working, web uses mock data |
| 2.2 | Deployment findById | ✅ | ✅ | ❌ | ✅ | | |
| 2.3 | Deployment create/trigger | ✅ | ✅ | ❌ | ✅ | | |
| 2.4 | Deployment upload bundle | ✅ | ✅ | ❌ | ✅ | | |
| 2.5 | Deployment cancel | ✅ | ✅ | ❌ | ✅ | | |
| 2.6 | Deployment rollback | ✅ | ✅ | ❌ | ✅ | | |
| 2.7 | Deployment retry | ✅ | ✅ | ❌ | ✅ | | |
| 2.8 | Deployment logs | ✅ | ✅ | ❌ | ✅ | | Get + stream |
| 2.9 | Deployment delete | ✅ | ✅ | ❌ | ✅ | | |
| 2.10 | Rollback history | ✅ | ✅ | ❌ | ✅ | | |
| 2.11 | Plan compilation | ✅ | ✅ | ❌ | ✅ | | compile, compilePlanPreview, compileRollbackEdges |
| 2.12 | Plan snapshots | ✅ | ✅ | ❌ | ✅ | | create/get/list compiled plan snapshots |
| 2.13 | Template provenance | ✅ | ✅ | ❌ | ✅ | | get/upsert |
| 2.14 | State machine | ✅ | ✅ | ❌ | ✅ | | Phase transitions: list/validate/apply |
| 2.15 | Queue management | ✅ | ✅ | ❌ | ✅ | | Claim/complete/fail/enqueue/heartbeat/list/dead letter |
| 2.16 | Lifecycle events | ✅ | ✅ | ❌ | ✅ | | Emit/list/stream node lifecycle events |
| 2.17 | Execution management | ✅ | ✅ | ❌ | ✅ | | Cancel/resume/get checkpoint |
| 2.18 | Retry policy | ✅ | ✅ | ❌ | ✅ | | List catalog/resolve policy |
| 2.19 | Streams | ✅ | ✅ | ❌ | ✅ | | Service deployments stream, query stream, internal stream |
| 2.20 | Deployments page (web) | 🧪 | ✅ | 🧪 | ✅ | | Web UI exists but uses `MOCK_DEPLOYMENTS` |

---

## 3. 👥 Organization Management

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 3.1 | Organization list | ✅ | ✅ | ✅ | ✅ | 2 | Real data flow |
| 3.2 | Organization admin | ✅ | ✅ | ✅ | ✅ | | Sub-router |
| 3.3 | Organization members | ✅ | ✅ | ✅ | ✅ | | Admin pages use real hooks |
| 3.4 | Organization invites | ✅ | ✅ | ✅ | ✅ | | Create/accept/reject |
| 3.5 | Create organization | ✅ | ✅ | ✅ | ✅ | | Admin page |
| 3.6 | Organization settings | ✅ | ✅ | ✅ | ✅ | | Admin page |

---

## 4. 👤 User Management

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 4.1 | User list | ✅ | ✅ | ✅ | ✅ | 4 | Real data flow |
| 4.2 | User findById | ✅ | ✅ | ❌ | ✅ | | |
| 4.3 | User create | ✅ | ✅ | ❌ | ✅ | | |
| 4.4 | User update | ✅ | ✅ | ❌ | ✅ | | |
| 4.5 | User delete | ✅ | ✅ | ❌ | ✅ | | |
| 4.6 | User check email | ✅ | ✅ | ❌ | ✅ | | |
| 4.7 | User count | ✅ | ✅ | ❌ | ✅ | | |
| 4.8 | Admin users page | ✅ | ✅ | ✅ | ❌ | | Real `useAdminListUsers` |

---

## 5. 🏗️ Project Management

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 5.1 | Project list | ✅ | ✅ | 🧪 | ✅ | 4 | API working, web uses mock |
| 5.2 | Project findById | ✅ | ✅ | 🧪 | ✅ | | |
| 5.3 | Project create | ✅ | ✅ | ❌ | ✅ | | |
| 5.4 | Project update | ✅ | ✅ | ❌ | ✅ | | |
| 5.5 | Project delete | ✅ | ✅ | ❌ | ✅ | | |
| 5.6 | Collaborators | ✅ | ✅ | ❌ | ✅ | | get/invite/update/remove |
| 5.7 | Environments CRUD | ✅ | ✅ | ❌ | ✅ | | list/get/create/update/delete/clone |
| 5.8 | Templates CRUD | ✅ | ✅ | ❌ | ✅ | | list/get/create/update/delete |
| 5.9 | Project config | ✅ | ✅ | ❌ | ✅ | | deployment/environment/general/notification/resource/security |
| 5.10 | Environment statuses | ✅ | ✅ | ❌ | ✅ | | getAll/get/refresh/resolveVariables |
| 5.11 | Query stream | ✅ | ✅ | ❌ | ✅ | | |
| 5.12 | API key management | ✅ | ✅ | ❌ | ❌ | | `api-key.service.ts`, `api-key.repository.ts` |
| 5.13 | Webhook repository | ✅ | ✅ | ❌ | ❌ | | `webhook.repository.ts` |
| 5.14 | Project page (web) | 🧪 | ✅ | 🧪 | ✅ | | Hybrid — some real hooks, mostly mock |
| 5.15 | Project config pages (web) | 🧪 | ✅ | 🧪 | ✅ | | All config sub-pages use mock data |

---

## 6. 🔧 Service Management

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 6.1 | Service list | ✅ | ✅ | 🧪 | ✅ | 2 | API working, web uses mock |
| 6.2 | Service findById | ✅ | ✅ | ❌ | ✅ | | |
| 6.3 | Service create | ✅ | ✅ | ❌ | ✅ | | |
| 6.4 | Service update | ✅ | ✅ | ❌ | ✅ | | |
| 6.5 | Service delete | ✅ | ✅ | ❌ | ✅ | | |
| 6.6 | Service lifecycle | ✅ | ✅ | ❌ | ✅ | | start/stop/restart/toggleActive |
| 6.7 | Service dependencies | ✅ | ✅ | ❌ | ✅ | | get/add/remove |
| 6.8 | Service query stream | ✅ | ✅ | ❌ | ✅ | | |
| 6.9 | Service events | ✅ | ✅ | ❌ | ❌ | | `service-event.service.ts` |
| 6.10 | Service pages (web) | 🧪 | ✅ | 🧪 | ✅ | | All service sub-pages use mock data |

---

## 7. 🔐 Authentication & Authorization

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 7.1 | Sign-in (email/password) | ✅ | ✅ | ✅ | ❌ | 8 | Better Auth, real flow |
| 7.2 | Sign-up | ✅ | ✅ | ✅ | ❌ | | |
| 7.3 | Session management | ✅ | ✅ | ✅ | ❌ | | httpOnly cookies |
| 7.4 | Organization auth | ✅ | ✅ | ✅ | ❌ | | Organization-based permissions |
| 7.5 | Platform roles | ✅ | ✅ | ✅ | ❌ | | Admin/member roles |
| 7.6 | Permission engine | ✅ | ✅ | ✅ | ❌ | | With FK-chain TODOs |
| 7.7 | Master token auth | ✅ | ✅ | ✅ | ❌ | | Service-to-service auth |
| 7.8 | Auth guards/middleware | ✅ | ✅ | ✅ | ❌ | | Decorators, ORPC middleware |
| 7.9 | AllowAnonymous decorator | ✅ | ✅ | ❌ | ❌ | | |
| 7.10 | OptionalAuth decorator | ✅ | ✅ | ❌ | ❌ | | |

---

## 8. 🌐 Domain Management

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 8.1 | Organization domains | ✅ | ✅ | ❌ | ✅ | 3 | CRUD + verify |
| 8.2 | Project domains | ✅ | ✅ | ❌ | ✅ | | list/getAvailable/add/update/remove |
| 8.3 | Service domains | ✅ | ✅ | ❌ | ✅ | | checkSubdomain/list/add/update/setPrimary/remove |
| 8.4 | Domain auto-verification | 📋 | ❌ | ❌ | ❌ | | Blocked by missing @nestjs/schedule |

---

## 9. 📊 Analytics

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 9.1 | Resource metrics | ✅ | ✅ | ❌ | ✅ | 2 | |
| 9.2 | Application metrics | ✅ | ✅ | ❌ | ✅ | | |
| 9.3 | Database metrics | ✅ | ✅ | ❌ | ✅ | | |
| 9.4 | Deployment metrics | ✅ | ✅ | ❌ | ✅ | | |
| 9.5 | Service health metrics | ✅ | ✅ | ❌ | ✅ | | |
| 9.6 | Real-time metrics | ✅ | ✅ | ❌ | ✅ | | |
| 9.7 | Reports | ✅ | ✅ | ❌ | ✅ | | generate/list/get/delete/download |
| 9.8 | Report configs | ✅ | ✅ | ❌ | ✅ | | create/list/update/delete |

---

## 10. 🔔 Push Notifications

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 10.1 | Subscribe | ✅ | ✅ | ✅ | ✅ | 3 | Web Push API |
| 10.2 | Unsubscribe | ✅ | ✅ | ❌ | ✅ | | |
| 10.3 | Get public key | ✅ | ✅ | ❌ | ✅ | | VAPID keys |
| 10.4 | Get subscriptions | ✅ | ✅ | ❌ | ✅ | | |
| 10.5 | Send test notification | ✅ | ✅ | ❌ | ✅ | | |
| 10.6 | Get stats | ✅ | ✅ | ❌ | ✅ | | |

---

## 11. 🩺 Health & Monitoring

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 11.1 | Health check | ✅ | ✅ | ❌ | ✅ | 4 | `GET /health` — verified working |
| 11.2 | Detailed health | ✅ | ✅ | ❌ | ✅ | | More comprehensive health info |
| 11.3 | System metrics | ⚠️ | ✅ | ❌ | ❌ | 0 | `core/modules/system-metrics/` — exists, may be unwired |

---

## 12. 🚢 Fleet Management

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 12.1 | List servers | ✅ | ✅ | ✅ | ✅ | 5 | Product module (modules/fleet/) has services + tests |
| 12.2 | List allocations | ✅ | ✅ | ❌ | ✅ | | |
| 12.3 | Get server | ✅ | ✅ | ❌ | ✅ | | |
| 12.4 | Update/remove allocation | ✅ | ✅ | ❌ | ✅ | | |
| 12.5 | Server metrics | ✅ | ✅ | ❌ | ✅ | | |
| 12.6 | Admission requests | ✅ | ✅ | ❌ | ✅ | | approve/reject |
| 12.7 | Orphan services | ✅ | ✅ | ❌ | ✅ | | |
| 12.8 | Dashboard summary | ✅ | ✅ | ❌ | ✅ | | |
| 12.9 | Rollout planner | ✅ | ✅ | ❌ | ❌ | | `fleet-rollout-planner.service.ts` |
| 12.10 | Drift reconciliation | ✅ | ✅ | ❌ | ❌ | | `drift-reconciliation.service.ts` |
| 12.11 | Failure containment | ✅ | ✅ | ❌ | ❌ | | `fleet-failure-containment.service.ts` |
| 12.12 | Cross-project gate | ✅ | ✅ | ❌ | ❌ | | `cross-project-gate.service.ts` |
| 12.13 | **System Fleet module** | 💀 | ✅ | ❌ | ❌ | | `system/modules/fleet/` — DEAD, superseded |
| 12.14 | Admin servers page | ✅ | ✅ | ✅ | ❌ | | Real `useFleetServers` hook |

---

## 13. 🔗 Mesh (Distributed Coordination)

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 13.1 | Node ping | ✅ | ✅ | ✅ | ✅ | 15 | Health check |
| 13.2 | Local node info | ✅ | ✅ | ✅ | ✅ | | |
| 13.3 | Node metrics | ✅ | ✅ | ❌ | ✅ | | |
| 13.4 | Peer management | ✅ | ✅ | ✅ | ✅ | | list sessions, connect, disconnect, heartbeat |
| 13.5 | Event streams | ✅ | ✅ | ✅ | ✅ | | list, findById, subscribe |
| 13.6 | Topology streaming | ✅ | ✅ | ❌ | ✅ | | Real-time topology updates |
| 13.7 | Resource lookup/index | ✅ | ✅ | ❌ | ✅ | | Upsert resource index |
| 13.8 | Queue partition planning | ✅ | ✅ | ❌ | ✅ | | |
| 13.9 | Join grants | ✅ | ✅ | ❌ | ✅ | | issue, consume, revoke |
| 13.10 | Trust keyring | ✅ | ✅ | ❌ | ✅ | | status, secrets, rotate, convergence, strict mode |
| 13.11 | Node configuration | ✅ | ✅ | ❌ | ✅ | | get, update, regenerate secret |
| 13.12 | Node DB test | ✅ | ✅ | ❌ | ✅ | | |
| 13.13 | Route stream plan | ✅ | ✅ | ❌ | ✅ | | |
| 13.14 | Membership operations | ✅ | ✅ | ❌ | ✅ | | snapshot, reconcile |
| 13.15 | Control envelopes | ✅ | ✅ | ❌ | ✅ | | publish |
| 13.16 | Connect flow (web) | ⚠️ | ✅ | ⚠️ | ❌ | | Uses direct `fetch()` instead of ORPC |
| 13.17 | Admin servers page | ✅ | ✅ | ✅ | ❌ | | Real mesh hooks |

---

## 14. 🧪 Test Utilities

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 14.1 | Non-authenticated test | ✅ | ✅ | ❌ | ✅ | 0 | |
| 14.2 | Authenticated test | ✅ | ✅ | ❌ | ✅ | | |
| 14.3 | File upload test | ✅ | ✅ | ❌ | ✅ | | |
| 14.4 | File download test | ✅ | ✅ | ❌ | ✅ | | |
| 14.5 | Stream output test | ✅ | ✅ | ❌ | ✅ | | |
| 14.6 | Health domain hooks | 💀 | ✅ | 💀 | ✅ | | No page consumer |

---

## 15. 🎛️ Setup & Initialization

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 15.1 | Get setup state | ✅ | ✅ | ✅ | ✅ | 1 | |
| 15.2 | Node status | ✅ | ✅ | ✅ | ✅ | | |
| 15.3 | Probe database | ✅ | ✅ | ✅ | ✅ | | |
| 15.4 | Probe mesh | ✅ | ✅ | ✅ | ✅ | | |
| 15.5 | Remote auth | ✅ | ✅ | ✅ | ✅ | | |
| 15.6 | Initialize node | ✅ | ✅ | ✅ | ✅ | | |
| 15.7 | Hints | ✅ | ✅ | ❌ | ✅ | | list/dismiss |
| 15.8 | Setup wizard sub-app | 💀 | ❌ | ❌ | ❌ | | Superseded by modules/setup/ |
| 15.9 | Setup wizard page (web) | ✅ | ✅ | ✅ | ❌ | | Uses real API calls |
| 15.10 | Mesh initializer sub-app | ✅ | ✅ | ❌ | ❌ | | Bridge + service in orchestrator pipeline |

---

## 16. 🧩 Provider Schema

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 16.1 | List providers | ✅ | ✅ | ❌ | ✅ | 2 | |
| 16.2 | Get provider schema | ✅ | ✅ | ❌ | ✅ | | |
| 16.3 | Find compatible builders | ✅ | ✅ | ❌ | ✅ | | |
| 16.4 | List builders | ✅ | ✅ | ❌ | ✅ | | |
| 16.5 | Get builder schema | ✅ | ✅ | ❌ | ✅ | | |
| 16.6 | Find compatible providers | ✅ | ✅ | ❌ | ✅ | | |
| 16.7 | Validate provider config | ✅ | ✅ | ❌ | ✅ | | |
| 16.8 | Validate builder config | ✅ | ✅ | ❌ | ✅ | | |

---

## 17. 🔄 GitHub Integration

| # | Feature | Status | API | Web | Contract | Tests | Details |
|---|---------|--------|:---:|:---:|:--------:|:-----:|---------|
| 17.1 | Webhook receiver | ⚠️ | ⚠️ | ❌ | ❌ | 1 | Raw `@Controller` — no ORPC contract |
| 17.2 | Webhook dispatch | ⚠️ | ⚠️ | ❌ | ❌ | | GitHub → internal event dispatch |
| 17.3 | Webhook idempotency | ⚠️ | ⚠️ | ❌ | ❌ | | Duplicate delivery prevention |
| 17.4 | Preview lifecycle events | ❓ | ✅ | ❌ | ❌ | | `preview-lifecycle-event.service.ts` |

**Critical Issue:** This is the ONLY module without an ORPC contract. It uses raw NestJS `@Controller` + `@Post()`. Needs contract-first migration.

---

## 18. 🎨 UI Component Library

| # | Feature | Status | Details |
|---|---------|--------|---------|
| 18.1 | DataTable | ✅ | Advanced table with sorting, filtering, pagination, sub-rows, export |
| 18.2 | Shadcn base components | ✅ | Button, Input, Badge, Card, Dialog, etc. |
| 18.3 | Auth components | ⚠️ | `RequireAuth` + `RequirePlatformRole` work; `RequireOrganizationRole` is DEAD |
| 18.4 | Dashboard sidebar | ✅ | Real navigation with projects/services lists |
| 18.5 | Loading states | ✅ | `DockerInlineLoadingState`, `DockerTableLoadingRows` |
| 18.6 | Error handling | ⚠️ | Some pages have error states, many mocked pages don't |

---

## 19. 🏗️ Infrastructure

| # | Feature | Status | Details |
|---|---------|--------|---------|
| 19.1 | Docker Compose dev | ✅ | Full stack: API, Web, DB, Mesh services |
| 19.2 | Docker Compose prod | ✅ | Production-like configuration |
| 19.3 | Mesh 6-node dev | ✅ | 6-node mesh cluster for dev |
| 19.4 | Mesh 6-node prod | ✅ | 6-node mesh in production mode |
| 19.5 | Load balancer | ✅ | Integrated in docker-compose |
| 19.6 | Documentation site | ✅ | Fumadocs with architecture, dev guides, deployment docs |
| 19.7 | Database Postgres | ✅ | Global database schema |
| 19.8 | Database SQLite | ✅ | Local per-node database |
| 19.9 | Build pipeline | ✅ | Turborepo with caching |
| 19.10 | Dead code detection | ✅ | Knip configured |
| 19.11 | Auth schema generation | ✅ | `auth:generate` script |
| 19.12 | Scanner runner | ✅ | Docker security scanner |

---

## 20. 💀 Orphaned / Unused Features

| # | Feature | Status | Location | Reason |
|---|---------|--------|----------|--------|
| 20.1 | apps/test | 💀 | `/apps/test/` | Jest-based, not integrated, no pipeline |
| 20.2 | apps/observable-poc | 💀 | `/apps/observable-poc/` | Standalone Next.js, no pipeline |
| 20.3 | packages/poc/core-sync-system | 💀 | `/packages/poc/` | No consumers |
| 20.4 | packages/nest/auth (shared) | 💀 | `/packages/nest/auth/` | 20+ files — API has its own auth |
| 20.5 | packages/utils/auth/permissions/builder | 💀 | `/packages/utils/auth/src/permissions/system/builder/` | Superseded by permissions engine |
| 20.6 | Core: State Machine | 💀 | `core/modules/state-machine/` | 4 files, superseded |
| 20.7 | Core: SubApp Orchestrator | 💀 | `core/modules/sub-app-orchestrator/` | 2 files, superseded |
| 20.8 | Core: SubApp Runner | 💀 | `core/modules/sub-app-runner/` | 3 files, superseded |
| 20.9 | Core: Loader | 💀 | `core/modules/loader/` | 3 files, superseded |
| 20.10 | Core: Gateway Module | 💀 | `core/gateway/` | 3 files, superseded |
| 20.11 | System: Fleet | 💀 | `system/modules/fleet/` | 4 files, superseded by modules/fleet/ |
| 20.12 | System: System Module | 💀 | `system/system.module.ts` | 1 file, unused root |
| 20.13 | Sub-App: Setup Wizard | 💀 | `sub-apps/setup-wizard/` | 6 files, superseded by modules/setup/ |
| 20.14 | Sub-App: Auth | 💀 | `sub-apps/auth/` | Empty directory |
| 20.15 | Web: Health domain hooks | 💀 | `domains/health/` | No consumer |
| 20.16 | Web: Test domain hooks | 💀 | `domains/test/` | No consumer |
| 20.17 | Web: Mock hooks (9 files) | 💀 | `domains/*/mock-hooks.ts` | All unused |
| 20.18 | Web: Permissions component | 💀 | `components/permissions/` | Duplicate of auth components |
| 20.19 | Web: Unused lib files | 💀 | `lib/auth/*`, `lib/debug/*`, `lib/errors/*`, `lib/mock-*` | 15+ files unused |
| 20.20 | reference/ directory | 💀 | `/reference/` | 20+ standalone files, not integrated |

---

## Summary

| Status | Count (approx) |
|--------|:--------------:|
| ✅ **WORKING** | ~60 features |
| ⚠️ **PARTIAL** | ~15 features |
| 🧪 **MOCKED** | ~12 web pages |
| ❌ **NOT WORKING** | ~6 infrastructure gaps |
| 💀 **DEAD** | ~25 items (files/directories/modules) |
| 📋 **PLANNED** | ~3 features |

**Key takeaway:** The backend API is largely complete and working. The gaps are mostly in the web frontend (mock data usage) and dead code cleanup (superseded modules).
