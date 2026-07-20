# 🧪 Features Using Mock Data

> Features where the web UI exists but uses mock/fake data instead of real API calls.
> These have a frontend, but the data is static / hardcoded — not connected to the backend.

---

## 1. Projects Module — Web Frontend Only

### 1.1 Projects List Page

**Page:** `apps/web/src/app/dashboard/projects/page.tsx`
**Imports:** `MOCK_PROJECTS, MOCK_SERVICES_BY_PROJECT` from `@/mocks/platform`
**Status:** The page renders a list of projects but uses hardcoded mock data. The real API contract exists (`packages/contracts/api/modules/project/`), but the page doesn't use the domain hooks (`@/domains/project/hooks.ts`).

### 1.2 Project Detail Page

**Page:** `apps/web/src/app/dashboard/projects/[projectId]/page.tsx`
**Imports:** Heavily from `@/mocks/platform`
**Contains:**
- Mock service operations (`createDescription.trim() || 'Service created from mock dashboard action.'`)
- Mock delete with `confirm('Delete this service from the mock dashboard?')` and `toast.success('Service deleted from mock dashboard')`
- Uses both mock data AND some real hooks (`useProjectList`, `useServiceList`, etc.)

**Status:** ⚠️ HYBRID — uses both real domain hooks AND mock data. The service operations (create, delete) only affect the mock data store.

### 1.3 Project Configuration Pages

**Pages:**
- `projects/[projectId]/configuration/page.tsx`
- `projects/[projectId]/configuration/environments/[environmentId]/page.tsx`

**Imports:** Mock data from `@/mocks/platform`
**Status:** 🧪 Fully mocked — no real API calls

### 1.4 Service Detail & Sub-Pages

**Pages:**
- `projects/[projectId]/services/[serviceId]/page.tsx`
- `projects/[projectId]/services/[serviceId]/configuration/page.tsx`
- `projects/[projectId]/services/[serviceId]/configuration/general/page.tsx`
- `projects/[projectId]/services/[serviceId]/configuration/network/page.tsx`
- `projects/[projectId]/services/[serviceId]/configuration/provider/page.tsx`
- `projects/[projectId]/services/[serviceId]/configuration/environment/page.tsx`
- `projects/[projectId]/services/[serviceId]/deployments/page.tsx`
- `projects/[projectId]/services/[serviceId]/logs/page.tsx`
- `projects/[projectId]/services/[serviceId]/monitoring/page.tsx`
- `projects/[projectId]/services/[serviceId]/previews/page.tsx`

**Imports:** All use `from '@/mocks/platform'` extensively
**Status:** 🧪 Fully mocked — these are the deepest nested pages and none connect to real APIs
**Note:** Some pages like `service-ops-overview-cards.tsx` also use mock data

---

## 2. Deployments Module — Web Frontend

### 2.1 Deployments List Page

**Page:** `apps/web/src/app/dashboard/deployments/page.tsx`
**Imports:** `MOCK_DEPLOYMENTS, MOCK_INCIDENTS, MOCK_NOTIFICATIONS` from `@/mocks/platform/entities/operations.mock`
**Status:** 🧪 Fully mocked — uses mock operations data instead of real deployment hooks

---

## 3. Services Module — Web Frontend

### 3.1 Services List Page

**Page:** `apps/web/src/app/dashboard/services/page.tsx`
**Imports:** Mock data from `@/mocks/platform`
**Status:** 🧪 Fully mocked

---

## 4. Docker Components Using Mock Data

**Files:**
- `apps/web/src/app/dashboard/docker/_components/container-detail-modal/container-detail-modal-trigger.tsx`
- `apps/web/src/app/dashboard/docker/_components/docker-network-detail-modal.tsx`
- `apps/web/src/app/dashboard/docker/_components/docker-operations-controls.tsx`
- `apps/web/src/app/dashboard/docker/_components/docker-stack-detail-modal.tsx`
- `apps/web/src/app/dashboard/docker/_components/docker-volume-detail-modal.tsx`

**Status:** ⚠️ HYBRID — These are Docker detail modals that use real domain hooks for primary data BUT also import mock data for supplementary display. The container detail modal, for example, uses real `useDockerContainerGroupedList` but also imports from mock.

---

## 5. All Mock Files Inventory

### Platform Entity Mocks (13 files)

**Location:** `apps/web/src/mocks/platform/entities/`

| File | Contains |
|------|----------|
| `docker.mock.ts` | Docker containers, deployments, images, networks, etc. |
| `docker.large.mock.ts` | Large/realistic docker mock data |
| `projects.mock.ts` | Project entities |
| `services.mock.ts` | Service entities |
| `organizations.mock.ts` | Organization entities |
| `teams.mock.ts` | Team entities |
| `configurations.mock.ts` | Configuration entities |
| `service-configs.mock.ts` | Service config entities |
| `service-providers.mock.ts` | Service provider entities |
| `service-runners.mock.ts` | Service runner entities |
| `dependencies.mock.ts` | Dependency entities |
| `dependency-policies.mock.ts` | Dependency policy entities |
| `operations.mock.ts` | Operation entities (deployments, incidents, notifications) |

### Scenario Mocks (2 files)

| File | Contains |
|------|----------|
| `scenarios/dependency-graph.mock.ts` | Dependency graph scenario |
| `scenarios/platform-overview.mock.ts` | Platform overview scenario |

### Index & Types

| File | Purpose |
|------|---------|
| `mocks/platform/index.ts` | Re-exports all entity + scenario mocks |
| `mocks/platform/types.ts` | Re-exports contract entity types |

### Domain Mock Hooks (9 files — ALL DEAD)

| File | Status |
|------|--------|
| `domains/docker/mock-hooks.ts` | 💀 Unused (12 mock hooks) |
| `domains/deployment/mock-hooks.ts` | 💀 Unused |
| `domains/fleet/mock-hooks.ts` | 💀 Unused |
| `domains/invitation/mock-hooks.ts` | 💀 Unused |
| `domains/mesh/mock-hooks.ts` | 💀 Unused |
| `domains/organization/mock-hooks.ts` | 💀 Unused |
| `domains/project/mock-hooks.ts` | 💀 Unused |
| `domains/setup/mock-hooks.ts` | 💀 Unused (empty `export {}`) |
| `domains/user/mock-hooks.ts` | 💀 Unused |

---

## 6. Why Are These Mocked?

The mocks suggest the development followed this pattern:

```
1. Contract definition (ORPC)     → packages/contracts/api/modules/<domain>/
2. API implementation             → apps/api/src/modules/<domain>/
3. Web page with mock data        → apps/web/src/app/dashboard/<domain>/  ⬅️ HERE
4. Web page with real hooks       → NOT YET DONE for these pages
```

The **Docker** and **Admin** pages made it to step 4 (real hooks). But the **Projects**, **Deployments**, and **Services** frontend pages are stuck at step 3 (mock data). The API implementations exist — what's missing is the frontend connection.

## 7. Migration Path: Mock → Real

For each mocked page, the fix is:

1. Import from `@/domains/<domain>/hooks.ts` instead of `@/mocks/platform`
2. Replace mock data references with real hook return values
3. Handle loading/error/empty states properly
4. Remove mock imports

**Priority order** (based on API completeness):
1. **Projects** — API is fully working with CRUD + environments + templates + collaborators (4 tests)
2. **Services** — API is fully working with CRUD + lifecycle + dependencies + streams (2 tests)
3. **Deployments** — API is fully working with 18 tests, full queue + state machine
4. **Service Config** — Depends on `provider-schema` API which is working
