# Phase 2: Mock→Real Data Migration 🔗

> **Goal:** Replace mock data in all web frontend pages with real ORPC API calls through domain hooks.
> **Total pages to migrate:** 14 pages + 1 component
> **Risk:** HIGH (touches core UI pages)
> **Est. time:** ~30 hours
> **Prerequisite:** Phase 1 complete, API running (for testing)

---

## Architecture

```mermaid
flowchart LR
    subgraph BEFORE["Before (Mock Data)"]
        WebPage -->|imports| MockData[MOCK_PROJECTS<br/>MOCK_SERVICES<br/>MOCK_DEPLOYMENTS]
        WebPage -->|local mutations| MockStore[mock data set<br/>(in-memory only)]
    end

    subgraph AFTER["After (Real API)"]
        WebPage2 -->|imports| DomainHooks[domain/hooks.ts]
        DomainHooks -->|ORPC call| APIBackend[NestJS API]
        WebPage2 -->|mutations| useMutation[tanStack mutation]
        useMutation -->|ORPC call| APIBackend
    end
```

---

## 2.1 Projects List Page

**File:** `apps/web/src/app/dashboard/projects/page.tsx`

### Current State
```typescript
import { MOCK_PROJECTS, MOCK_SERVICES_BY_PROJECT } from '@/mocks/platform'
import { MOCK_DEPLOYMENTS, MOCK_INCIDENTS, MOCK_NOTIFICATIONS } from '@/mocks/platform/entities/operations.mock'
// ... uses these directly as data
```

### Target State
```typescript
import { useProjectList } from '@/domains/project/hooks'
// Use useProjectList() instead of MOCK_PROJECTS
// Use useServiceList() instead of MOCK_SERVICES_BY_PROJECT
```

### Migration Steps — DETAILED

1. **Remove mock imports:**
   ```typescript
   // DELETE these lines:
   import { MOCK_PROJECTS, MOCK_SERVICES_BY_PROJECT } from '@/mocks/platform'
   import { MOCK_DEPLOYMENTS, MOCK_INCIDENTS, MOCK_NOTIFICATIONS } from '@/mocks/platform/entities/operations.mock'
   ```

2. **Add real domain hook imports:**
   ```typescript
   import { useProjectList, useProjectEnvironmentStatuses } from '@/domains/project/hooks'
   import { useServiceList } from '@/domains/service/hooks'
   ```

3. **Replace data source:**
   ```typescript
   // Before:
   const projects = MOCK_PROJECTS
   // After:
   const { data: projects, isLoading, error } = useProjectList()
   ```

4. **Add state handling:**
   - Add `isLoading` → show loading skeleton
   - Add `error` → show error state with retry
   - Add empty state when `data.length === 0`
   - Keep existing table/list rendering

5. **Remove mock-specific UI:**
   - Search for any "mock dashboard" strings and remove them
   - Replace any mock-only create/delete operations with real mutation hooks

6. **Test:**
   ```typescript
   // Verify data loads from real API
   // Verify loading state renders correctly
   // Verify error state handles API failures
   ```

### Available Hooks

| Mock Data | Real Hook | Endpoint |
|-----------|-----------|----------|
| `MOCK_PROJECTS` | `useProjectList()` | `project.list` |
| `MOCK_SERVICES_BY_PROJECT` | `useServiceList({ projectId })` | `service.list` |
| Deployment data | `useDeploymentList()` | `deployment.list` |
| Incident data | `useFleetServerMetrics()` | `fleet.getMetricsSummary` |

---

## 2.2 Project Detail Page

**File:** `apps/web/src/app/dashboard/projects/[projectId]/page.tsx`

### Current State (HYBRID)
This page already uses SOME real hooks but mixes them with mock data:
```typescript
import { useProjectList } from '@/domains/project/hooks'  // REAL
import { useServiceList } from '@/domains/service/hooks'   // REAL
// BUT ALSO:
import { MOCK_PROJECTS, MOCK_SERVICES_BY_PROJECT } from '@/mocks/platform'  // MOCK
```

### Mock-Specific Patterns to Remove

**Line `createDescription.trim() || 'Service created from mock dashboard action.'`**
→ Replace with real service creation mutation result

**Line `if (!confirm('Delete this service from the mock dashboard?')) return`**
→ Replace with real `useServiceDelete` mutation with proper confirmation

**Line `toast.success('Service deleted from mock dashboard')`**
→ Replace with real success message from mutation result

### Migration Steps

1. **Remove ALL mock imports:**
   ```typescript
   // DELETE all imports from '@/mocks/platform'
   ```

2. **Replace `useProjectList` with `useProjectFindById`:**
   ```typescript
   // Before: const { data: projects } = useProjectList()
   //        const project = projects?.find(p => p.id === projectId)
   // After:  const { data: project, isLoading } = useProjectFindById({ id: projectId })
   ```

3. **Add loading/error states:**
   - Wrap main content in loading boundary
   - Handle error state when project not found

4. **Fix service operations:**
   - Replace mock create → `useServiceCreate` mutation
   - Replace mock delete → `useServiceDelete` mutation
   - Replace mock update → `useServiceUpdate` mutation

### Available Real Hooks

| Operation | Hook | Contract |
|-----------|------|----------|
| Get project by ID | `useProjectFindById({ id })` | `project.findById` |
| List project services | `useServiceList({ projectId })` | `service.list` |
| Create service | `useServiceCreate()` | `service.create` |
| Delete service | `useServiceDelete()` | `service.delete` |
| Update service | `useServiceUpdate()` | `service.update` |
| Get environments | `useProjectEnvironmentList({ projectId })` | `project.environments.list` |

---

## 2.3 Project Configuration Pages

**Files:**
- `apps/web/src/app/dashboard/projects/[projectId]/configuration/page.tsx`
- `apps/web/src/app/dashboard/projects/[projectId]/configuration/environments/[environmentId]/page.tsx`

### Current State
Both pages import mock data only. No real hooks.

### Migration Steps

**Config page:**
1. Replace with `useProjectConfigDeployment()`, `useProjectConfigEnvironment()` etc.
2. Each config type (deployment, environment, general, notification, resource, security) has get+update contracts

**Environment detail:**
1. Replace with `useProjectEnvironmentFindById({ projectId, environmentId })`
2. Environment update via `useProjectEnvironmentUpdate()`

### Available Real Hooks

| Config Type | Get Hook | Update Hook |
|-------------|----------|-------------|
| Deployment config | `useProjectConfigDeployment({ projectId })` | `useProjectConfigDeploymentUpdate()` |
| Environment config | `useProjectConfigEnvironment({ projectId })` | `useProjectConfigEnvironmentUpdate()` |
| General config | `useProjectConfigGeneral({ projectId })` | `useProjectConfigGeneralUpdate()` |
| Notification config | `useProjectConfigNotification({ projectId })` | `useProjectConfigNotificationUpdate()` |
| Resource config | `useProjectConfigResource({ projectId })` | `useProjectConfigResourceUpdate()` |
| Security config | `useProjectConfigSecurity({ projectId })` | `useProjectConfigSecurityUpdate()` |

---

## 2.4 Service Pages (8 pages + 1 component)

### 2.4.1 Service Detail

**File:** `.../services/[serviceId]/page.tsx`

**Replacement:**
```typescript
// Mock: const service = MOCK_SERVICES_BY_PROJECT[projectId]?.find(...)
// Real:  const { data: service } = useServiceFindById({ id: serviceId })
```

### 2.4.2 Service Configuration Pages (5 pages)

**Files:**
- `.../configuration/page.tsx` — Main config page
- `.../configuration/general/page.tsx`
- `.../configuration/network/page.tsx`
- `.../configuration/provider/page.tsx`
- `.../configuration/environment/page.tsx`

**Replacement pattern for each:**
```typescript
// 1. Remove: import { MOCK_PROJECTS, MOCK_SERVICE_CONFIGS_BY_PROJECT, ... } from '@/mocks/platform'
// 2. Remove any type imports like MockServiceProvider, MockServiceRunner
// 3. Add: import { useServiceFindById } from '@/domains/service/hooks'
// 4. Use real data: const { data: service } = useServiceFindById({ id: serviceId })
```

### 2.4.3 Service Deployments

**File:** `.../services/[serviceId]/deployments/page.tsx`

**Replacement:**
```typescript
// Mock: MOCK_PROJECTS, MOCK_SERVICES_BY_PROJECT, docker.large.mock
// Real: useServiceDeploymentsStream({ serviceId })
// Or:   useDeploymentList({ serviceId })
```

### 2.4.4 Service Logs

**File:** `.../services/[serviceId]/logs/page.tsx`

**Replacement:**
```typescript
// Mock: MOCK_PROJECTS, MOCK_SERVICES_BY_PROJECT
// Real: useDeploymentGetLogs({ deploymentId })
// Or: useDockerContainerLogStream(...)
```

### 2.4.5 Service Monitoring

**File:** `.../services/[serviceId]/monitoring/page.tsx`

**Replacement:**
```typescript
// Mock: MOCK_PROJECTS, MOCK_SERVICE_CONFIGS_BY_PROJECT, MOCK_DEPENDENCIES_BY_PROJECT
// Real: useServiceDependencies({ serviceId })
// Plus: useFleetServerMetrics() for metrics
```

### 2.4.6 Service Previews

**File:** `.../services/[serviceId]/previews/page.tsx`

**Replacement:**
```typescript
// Mock: MOCK_PROJECTS, MOCK_SERVICES_BY_PROJECT
// Real: No direct contract for previews — check useDeploymentList or mesh contracts
// May need: useMeshListEventStreams()
```

### 2.4.7 Service Ops Overview Cards

**File:** `.../services/[serviceId]/_components/service-ops-overview-cards.tsx`

**Replacement:**
```typescript
// Mock: MOCK_DEPENDENCIES_BY_PROJECT, MOCK_SERVICE_CONFIGS_BY_PROJECT
// Real: useServiceFindById() for config data
//       useServiceDependencies() for dependency data
```

---

## 2.5 Deployments List Page

**File:** `apps/web/src/app/dashboard/deployments/page.tsx`

### Current State
```typescript
import { MOCK_DEPLOYMENTS, MOCK_INCIDENTS, MOCK_NOTIFICATIONS } from '@/mocks/platform/entities/operations.mock'
```

### Replacement
```typescript
import { useDeploymentList } from '@/domains/deployment/hooks'
// or
import { useDeploymentServiceDeploymentsStream } from '@/domains/deployment/hooks'
```

**Note:** The deployments page is the simplest migration — the contract (`deployment.list`) is fully implemented with 18 spec files.

---

## 2.6 Services List Page

**File:** `apps/web/src/app/dashboard/services/page.tsx`

### Current State
```typescript
import { ... } from '@/mocks/platform'
```

### Replacement
```typescript
import { useServiceList } from '@/domains/service/hooks'
```

---

## 2.7 Cleanup After Migration

After ALL pages are migrated:

1. **Run Knip again:**
   ```bash
   bun --bun run knip
   # All mock files should now appear as unused
   ```

2. **Delete all mock data files:**
   ```bash
   rm -rf apps/web/src/mocks/platform
   ```

3. **Update `@/mocks/platform` references:**
   - If any import chains remain, fix them
   - Remove the mocks alias from `tsconfig.json` if it has one

4. **Final verification:**
   ```bash
   grep -rn "from '@/mocks" apps/web/src/ --include="*.tsx" --include="*.ts"
   # → should be zero
   ```

---

## 2.8 Testing Strategy

After each page migration:

1. **Manual:**
   - Start the API: `bun --bun run dev:api`
   - Start the web: `bun --bun run dev:web`
   - Navigate to the page — verify data loads
   - Check loading state appears briefly
   - Verify error state (stop API, refresh, see error)

2. **Add tests:**
   ```typescript
   // Example test pattern for migrated page
   it('renders projects list from API', async () => {
     // Mock the ORPC hook
     // Render the page
     // Assert data appears
   })
   ```

3. **Type check:**
   ```bash
   bun --bun run web -- type-check
   ```
