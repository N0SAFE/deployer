# Web App Review Summary
**Date**: December 11, 2025  
**Reviewer**: AI Coding Agent  
**Scope**: Full architecture, standards compliance, and enhancement opportunities

---

## Executive Summary

The web application follows most architectural standards but has **several critical violations** of the ORPC Client Hooks Pattern and **333+ TypeScript errors** that need immediate attention. The project shows strong organization in hooks, components, and routing but needs systematic fixes for:

1. ❌ **Direct ORPC usage in components** (violates Core Concept #11)
2. ❌ **TypeScript strict mode violations** (undefined safety, missing types)
3. ⚠️ **Hardcoded navigation links** (instead of declarative routing)
4. ⚠️ **Missing or incomplete hooks** for several API domains
5. ⚠️ **Inconsistent error handling** across components

---

## 🔴 Critical Issues (Must Fix)

### 1. Direct ORPC Usage in Components

**Violation**: Components directly using `orpc.*` and `useQuery`/`useMutation` instead of custom hooks.

**Standard**: [.docs/core-concepts/11-ORPC-CLIENT-HOOKS-PATTERN.md]

#### Affected Files (20+ violations):

```typescript
// ❌ INCORRECT - Direct ORPC usage in component
// File: apps/web/src/components/orchestration/StackList.tsx
const { data, isLoading } = useQuery(orpc.orchestration.listStacks.queryOptions({
    input: { projectId }
}))

// ❌ INCORRECT - Direct ORPC call in component
// File: apps/web/src/components/domains/ProjectDomainSelector.tsx
const results = await Promise.allSettled(
    domainIds.map(domainId =>
        orpc.domain.addProjectDomain.call({
            projectId,
            organizationDomainId: domainId,
        })
    )
)

// ❌ INCORRECT - Direct ORPC usage with useMutation
// File: apps/web/src/components/domains/OrganizationDomainManagement.tsx
const addOrgDomain = useMutation({
    ...orpc.domain.addOrganizationDomain.mutationOptions(),
    onSuccess: (data) => { /* ... */ }
})
```

**List of Violating Files**:
1. `apps/web/src/components/orchestration/StackList.tsx` - Direct query usage
2. `apps/web/src/components/deployment/DeploymentRollbackHistory.tsx` - Direct query
3. `apps/web/src/components/domains/DomainConflictWarning.tsx` - Direct query
4. `apps/web/src/components/orchestration/CreateStackDialog.tsx` - Direct mutation
5. `apps/web/src/components/domains/OrganizationDomainManagement.tsx` - Direct mutations (3 instances)
6. `apps/web/src/components/domains/ProjectDomainSelector.tsx` - Direct queries + call
7. `apps/web/src/components/orchestration/ServiceScalingCard.tsx` - Direct mutation
8. `apps/web/src/components/orchestration/ResourceMonitoringDashboard.tsx` - Direct queries (4 instances)
9. `apps/web/src/components/domains/ServiceDomainMapping.tsx` - Direct mutations (4 instances)
10. `apps/web/src/components/orchestration/JobManagementInterface.tsx` - Direct queries (2 instances)

**Required Action**:
- Create domain-specific hooks for ALL these operations
- Move to `apps/web/src/hooks/` organized by domain:
  - `useOrchestration.ts` - Stack operations, system metrics, job management
  - `useDomains.ts` - Domain management operations
  - Expand existing hooks where applicable

**Example Fix**:

```typescript
// ✅ CORRECT - Create hook in apps/web/src/hooks/useOrchestration.ts

export function useStacks(projectId: string) {
  return useQuery(orpc.orchestration.listStacks.queryOptions({
    input: { projectId },
    enabled: !!projectId,
    staleTime: 1000 * 60, // 1 minute
    gcTime: 1000 * 60 * 5, // 5 minutes
  }))
}

export function useCreateStack() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.orchestration.createStack.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.orchestration.listStacks.queryKey({ input: {} })
      })
      toast.success('Stack created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create stack: ${error.message}`)
    },
  }))
}

// ✅ CORRECT - Use in component
import { useStacks } from '@/hooks/useOrchestration'

export default function StackList({ projectId }: StackListProps) {
  const { data: stacksResponse, isLoading, refetch } = useStacks(projectId)
  // ...
}
```

---

### 2. TypeScript Strict Mode Violations (333 Errors)

**Impact**: Type safety compromised, potential runtime errors.

#### Major Categories:

##### A. Undefined Safety Violations

**Pattern**: Accessing properties without checking for `undefined`.

**Examples**:

```typescript
// File: apps/web/src/components/environment/variable-template-parser.ts
if (!content.trim()) {  // ❌ 'content' is possibly 'undefined'
  
if (content.includes('{')) {  // ❌ 'content' is possibly 'undefined'
  
const refMatch = content.match(this.REFERENCE_REGEX);  // ❌ 'content' is possibly 'undefined'

// File: apps/web/src/components/analytics/AnalyticsDashboardClient.tsx
resourceMetrics.data[resourceMetrics.data.length - 1].cpu.usage  // ❌ Object is possibly 'undefined'
```

**Fix Strategy**:
```typescript
// ✅ CORRECT - Add undefined checks
if (!content?.trim()) {
  
if (content?.includes('{')) {
  
const refMatch = content?.match(this.REFERENCE_REGEX);

// Or use optional chaining with nullish coalescing
const cpuUsage = resourceMetrics?.data?.[resourceMetrics.data.length - 1]?.cpu?.usage ?? 0
```

##### B. Missing Type Parameters

**Examples**:

```typescript
// File: apps/web/src/app/dashboard/cicd/page.tsx
<CICDDashboard projectId={projectId} />  // ❌ Type 'undefined' is not assignable to type 'string'

// File: apps/web/src/app/dashboard/environment/page.tsx
<EnvironmentDashboard projectId={projectId} />  // ❌ Same issue

// File: apps/web/src/app/dashboard/orchestration/page.tsx
<OrchestrationDashboard projectId={projectId} />  // ❌ Same issue
```

**Fix**:
```typescript
// ✅ CORRECT - Ensure projectId is defined before passing
export default function DashboardPage() {
  const projectId = useSelectedProject()
  
  if (!projectId) {
    return <NoProjectSelected />
  }
  
  return <CICDDashboard projectId={projectId} />
}
```

##### C. Missing Dependencies

```typescript
// File: apps/web/src/app/dashboard/containers/ContainersPageContent.tsx
import { formatDistanceToNow } from 'date-fns';  // ❌ Cannot find module 'date-fns'
```

**Fix**: Add `date-fns` to `package.json`:
```bash
bun add date-fns
```

##### D. Missing API Contracts

```typescript
// File: apps/web/src/hooks/useProviderBuilder.ts
orpc.providerSchema.getAllProviders.queryOptions({  // ❌ Property 'providerSchema' does not exist

// File: apps/web/src/app/page.tsx
import { Authsignin, Dashboard, Deployments, Health } from '@/routes'  
// ❌ Module '"@/routes"' has no exported member 'Deployments' or 'Health'
```

**Fix**: 
1. Ensure API contracts are generated and exported
2. Rebuild declarative routes: `bun run web -- dr:build`

---

### 3. Hardcoded Navigation Links

**Issue**: Using raw `href` strings instead of declarative routing.

**Standard**: [apps/web/AGENTS.md] - "Always use the declarative routing system"

**Violations Found (9 instances)**:

```typescript
// ❌ INCORRECT
<Link href="/auth/me" className="flex items-center">

<Link href="/dashboard/team/members">

<Link href="/dashboard/team/invitations">

<Link href="/forgot-password">
```

**Fix**: Use declarative routes from `@/routes`:

```typescript
// ✅ CORRECT
import { Authme, Dashboardteammembers, Dashboardteaminvitations } from '@/routes'

<Authme.Link className="flex items-center">
  
<Dashboardteammembers.Link>
  
<Dashboardteaminvitations.Link>
```

**Affected Files**:
1. `apps/web/src/app/not-found.tsx`
2. `apps/web/src/app/auth/signin/page.tsx`
3. `apps/web/src/components/layout/UserProfileFooter.tsx`
4. `apps/web/src/components/layout/AppSidebar.tsx`

---

## ⚠️ Major Issues (Should Fix)

### 4. Missing or Incomplete Hooks

Several API domains lack proper hook abstractions:

#### Missing Hooks:

| Domain | Current State | Required Hooks |
|--------|--------------|----------------|
| **Orchestration** | ❌ Direct ORPC in components | `useStacks()`, `useCreateStack()`, `useDeleteStack()`, `useSystemMetrics()`, `useResourceAlerts()`, `useScaleServices()`, `useJobs()` |
| **Domains** | ❌ Direct ORPC in components | `useOrganizationDomains()`, `useProjectDomains()`, `useServiceDomains()`, `useAddDomain()`, `useRemoveDomain()`, `useVerifyDomain()`, `useCheckSubdomainAvailability()` |
| **CICD** | ⚠️ Partially exists | Expand `useCICD.ts` with pipeline hooks |
| **Storage** | ⚠️ Exists but basic | Add file upload/download hooks |
| **Activity** | ✅ Exists | Good coverage |
| **Analytics** | ✅ Exists | Good coverage |

#### Incomplete Hook Files:

**File: `apps/web/src/hooks/useTraefik.ts`**
- Only has file management hooks
- Missing: Config validation, route management, middleware operations

**File: `apps/web/src/hooks/useDeployments.ts`**
- Good coverage but missing prefetch functions
- No infinite query support for long deployment lists
- Missing composite utility hooks

**File: `apps/web/src/hooks/useServices.ts`**
- Missing prefetch functions
- No infinite query support
- WebSocket placeholders not implemented (documented in comments)

---

### 5. Inconsistent Error Handling

**Pattern Issues**:

1. **Some hooks have error toasts, others don't**:
   ```typescript
   // Has error handling
   export function useCreateUser() {
     return useMutation({
       onError: (error) => toast.error(`Failed: ${error.message}`)
     })
   }
   
   // Missing error handling
   export function useToggleServiceActive() {
     return useMutation({
       onSuccess: (data) => { /* ... */ }
       // ❌ No onError handler
     })
   }
   ```

2. **Inconsistent invalidation patterns**:
   ```typescript
   // Some use broad invalidation
   queryClient.invalidateQueries({ queryKey: ['service', 'listByProject'] })
   
   // Some use specific invalidation
   queryClient.invalidateQueries({ 
     queryKey: orpc.service.getById.queryKey({ input: { id } })
   })
   ```

**Fix**: Standardize error handling across all mutation hooks:

```typescript
// ✅ CORRECT - Consistent pattern
export function useCreateResource() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.resource.create.mutationOptions({
    onSuccess: (data) => {
      // Specific invalidation
      queryClient.invalidateQueries({ 
        queryKey: orpc.resource.list.queryKey({ input: {} })
      })
      queryClient.invalidateQueries({ 
        queryKey: orpc.resource.count.queryKey({ input: {} })
      })
      toast.success('Resource created successfully')
    },
    onError: (error: Error) => {
      console.error('[useCreateResource] Error:', error)
      toast.error(`Failed to create resource: ${error.message}`)
    },
  }))
}
```

---

### 6. Missing Utility Hooks

**Standard Pattern** ([11-ORPC-CLIENT-HOOKS-PATTERN.md](file:///home/sebille/Bureau/projects/tests/deployer/.docs/core-concepts/11-ORPC-CLIENT-HOOKS-PATTERN.md)): Each domain should export utility hooks.

**Good Examples** (Follow these patterns):

```typescript
// ✅ File: apps/web/src/hooks/useUser.ts
export function useUserActions() {
  // Composite actions hook
}

export function useUserProfile(userId?: string) {
  // Profile-specific hook
}

export function useUserAdministration(options?: {...}) {
  // Admin dashboard hook
}

export function useUserSelector(options?: {...}) {
  // Selection management hook
}
```

**Missing in Other Domains**:

- `useProjectActions()` in `useProjects.ts`
- `useServiceActions()` in `useServices.ts`
- `useDeploymentActions()` in `useDeployments.ts` (partially exists)
- `useDomainActions()` in missing `useDomains.ts`
- `useOrchestrationActions()` in missing `useOrchestration.ts`

---

## ✅ Strengths (Keep These)

### 1. Hook Organization

**File: `apps/web/src/hooks/useUser.ts`** - ⭐ **Exemplary Implementation**

This file perfectly demonstrates the ORPC Client Hooks Pattern:

- ✅ Comprehensive domain coverage
- ✅ Query hooks with proper options
- ✅ Mutation hooks with cache invalidation
- ✅ Composite utility hooks
- ✅ Type exports
- ✅ Consistent error handling with toasts
- ✅ Proper `staleTime` and `gcTime` configuration
- ✅ Well-documented with JSDoc

**Use this as the template for all other domain hooks.**

### 2. Hook Implementation Quality

**Good Patterns Found**:

```typescript
// ✅ Proper query hook structure
export function useProjects(options?: {
  limit?: number
  offset?: number
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}) {
  return useQuery(orpc.project.list.queryOptions({
    input: options || {},
    select: (data) => ({
      ...data,
      projects: data.projects.map(transformProject)
    }),
    staleTime: 1000 * 60 * 5,
  }))
}

// ✅ Proper mutation with invalidation
export function useUpdateProject() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.update.mutationOptions({
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.project.list.queryKey() 
      })
      queryClient.invalidateQueries({ 
        queryKey: orpc.project.getById.queryKey({ 
          input: { id: variables.id } 
        })
      })
    }
  }))
}
```

### 3. Authentication Hooks

**File: `apps/web/src/hooks/useAuth.ts`**

✅ **Correctly uses Better Auth SDK** (not custom ORPC hooks) per Core Concept #11:

```typescript
import { authClient } from '@/lib/auth'

export function useSignInEmailMutation() {
  return useMutation({
    mutationFn: async (params) => {
      return authClient.signIn.email({
        email: params.email,
        password: params.password,
      })
    },
    onSuccess: ({ error }) => { /* ... */ }
  })
}
```

### 4. Component Organization

Well-structured component directory with clear domain separation:

```
apps/web/src/components/
├── activity/          ✅ Domain-based organization
├── analytics/         ✅ Domain-based organization
├── cicd/             ✅ Domain-based organization
├── deployment/       ✅ Domain-based organization
├── domains/          ✅ Domain-based organization
├── environment/      ✅ Domain-based organization
├── orchestration/    ✅ Domain-based organization
├── project/          ✅ Domain-based organization
├── services/         ✅ Domain-based organization
├── storage/          ✅ Domain-based organization
├── traefik/          ✅ Domain-based organization
└── layout/           ✅ Shared layout components
```

### 5. Routing Implementation

✅ Uses declarative routing system (mostly):

```typescript
// apps/web/src/app/dashboard/page.tsx
import { Dashboard } from '@/routes'

export default Dashboard.Page(async function DashboardPage() {
  // Server-side data prefetching
  await queryClient.prefetchQuery(
    orpc.project.list.queryOptions({ input: {} })
  )
  // ...
})
```

### 6. Type Safety

✅ Proper type inference from ORPC contracts:

```typescript
import type { z } from 'zod'
import type { userSchema } from '@repo/api-contracts/common/user'

type User = z.infer<typeof userSchema>

export type UserData = User
export type UserList = ReturnType<typeof useUsers>
export type UserActions = ReturnType<typeof useUserActions>
```

---

## 📋 Enhancement Opportunities

### 1. Prefetching Strategy

**Missing**: Prefetch functions for optimistic navigation.

**Add to all domain hooks**:

```typescript
// Add to useProjects.ts
export function usePrefetchProjects(
  queryClient: ReturnType<typeof useQueryClient>,
  options?: { /* ... */ }
) {
  return queryClient.prefetchQuery(
    orpc.project.list.queryOptions({
      input: options || {},
      staleTime: 1000 * 60 * 5,
    })
  )
}

// Usage in components
const queryClient = useQueryClient()
const handleMouseEnter = () => {
  usePrefetchProjects(queryClient)
}
```

### 2. Infinite Query Support

**Missing**: Scroll-based pagination for large lists.

**Add to relevant hooks**:

```typescript
export function useProjectsInfinite(options?: {
  pageSize?: number
  search?: string
}) {
  return useInfiniteQuery(
    orpc.project.list.infiniteQueryOptions({
      input: (context) => ({
        limit: options?.pageSize || 20,
        offset: (context?.pageParam || 0) * (options?.pageSize || 20),
        search: options?.search,
      }),
      getNextPageParam: (lastPage, _, lastPageParam) => {
        if (!lastPage.hasMore) return undefined
        return (lastPageParam as number) + 1
      },
      initialPageParam: 0,
      staleTime: 1000 * 60,
    })
  )
}
```

### 3. WebSocket Integration

**Documented but not implemented** in:
- `apps/web/src/hooks/useServices.ts` - Service logs/metrics streaming
- Real-time deployment updates

**Recommendation**: Implement WebSocket hooks for real-time features:

```typescript
export function useServiceLogsStream(
  serviceId: string,
  options?: {
    level?: 'info' | 'warn' | 'error' | 'debug'
    onLog?: (log: LogEntry) => void
  }
) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isConnected, setIsConnected] = useState(false)
  
  useEffect(() => {
    // Implement WebSocket connection
    const ws = new WebSocket(`${WS_URL}/services/${serviceId}/logs`)
    
    ws.onopen = () => setIsConnected(true)
    ws.onmessage = (event) => {
      const log = JSON.parse(event.data)
      setLogs(prev => [...prev, log])
      options?.onLog?.(log)
    }
    ws.onclose = () => setIsConnected(false)
    
    return () => ws.close()
  }, [serviceId])
  
  return { logs, isConnected }
}
```

### 4. Testing Coverage

**Current**: Basic tests exist but coverage unclear.

**Recommendation**: Add comprehensive hook tests:

```typescript
// apps/web/src/hooks/__tests__/useProjects.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper } from '@/test-utils'
import { useProjects, useCreateProject } from '../useProjects'

describe('useProjects', () => {
  it('fetches projects successfully', async () => {
    const { result } = renderHook(() => useProjects(), {
      wrapper: createWrapper()
    })
    
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    
    expect(result.current.data?.projects).toBeDefined()
  })
})
```

### 5. Documentation

**Missing**: Hook usage documentation.

**Add to each hook file**:

```typescript
/**
 * Project Management Hooks
 * 
 * @module useProjects
 * 
 * @example
 * ```tsx
 * // Fetch projects with pagination
 * const { data, isLoading } = useProjects({ 
 *   limit: 10, 
 *   offset: 0 
 * })
 * 
 * // Create a new project
 * const { mutate: createProject } = useCreateProject()
 * createProject({ name: 'My Project' })
 * ```
 */
```

---

## 🚀 Action Plan (Prioritized)

### Phase 1: Critical Fixes (1-2 days)

1. **Fix Direct ORPC Usage** (HIGH PRIORITY)
   - [ ] Create `useOrchestration.ts` with all orchestration hooks
   - [ ] Create `useDomains.ts` with all domain management hooks
   - [ ] Update all 20+ components to use new hooks
   - [ ] Test each component after migration

2. **Fix TypeScript Errors** (HIGH PRIORITY)
   - [ ] Add undefined checks to variable-template-parser.ts
   - [ ] Add optional chaining to analytics components
   - [ ] Fix missing projectId checks in dashboard pages
   - [ ] Add `date-fns` dependency
   - [ ] Regenerate API contracts and routes

### Phase 2: Major Improvements (2-3 days)

3. **Standardize Error Handling**
   - [ ] Add error handlers to all mutations
   - [ ] Standardize invalidation patterns
   - [ ] Add consistent logging

4. **Complete Missing Hooks**
   - [ ] Expand `useCICD.ts`
   - [ ] Expand `useTraefik.ts`
   - [ ] Add utility hooks to all domains

5. **Fix Hardcoded Navigation**
   - [ ] Replace all `href` strings with declarative routes
   - [ ] Verify route generation is up-to-date

### Phase 3: Enhancements (3-5 days)

6. **Add Prefetching**
   - [ ] Add prefetch functions to all query hooks
   - [ ] Implement hover-based prefetching in navigation

7. **Add Infinite Queries**
   - [ ] Add infinite query support to list hooks
   - [ ] Implement scroll-based loading in components

8. **WebSocket Integration**
   - [ ] Implement service logs streaming
   - [ ] Implement deployment status streaming
   - [ ] Implement system metrics streaming

9. **Testing**
   - [ ] Add unit tests for all hooks
   - [ ] Add integration tests for critical flows
   - [ ] Achieve 80%+ coverage

10. **Documentation**
    - [ ] Add JSDoc to all hooks
    - [ ] Create hook usage examples
    - [ ] Update AGENTS.md with patterns

---

## 📊 Metrics Summary

| Category | Count | Status |
|----------|-------|--------|
| **TypeScript Errors** | 333 | 🔴 Critical |
| **Direct ORPC Usage** | 20+ | 🔴 Critical |
| **Hardcoded Links** | 9 | ⚠️ Major |
| **Missing Hooks** | 2 domains | ⚠️ Major |
| **Incomplete Hooks** | 3 domains | ⚠️ Major |
| **Missing Prefetch** | All hooks | 💡 Enhancement |
| **Missing Infinite** | All hooks | 💡 Enhancement |
| **Missing WebSocket** | 3 features | 💡 Enhancement |
| **Good Hooks** | 8 domains | ✅ Excellent |
| **Test Coverage** | Unknown | ⚠️ Needs audit |

**Overall Assessment**: 
- **Architecture**: 7/10 (Good foundation, needs critical fixes)
- **Standards Compliance**: 5/10 (Major violations of ORPC pattern)
- **Type Safety**: 4/10 (Too many undefined safety issues)
- **Code Quality**: 8/10 (Well-organized, clear patterns)
- **Maintainability**: 7/10 (Needs standardization)

---

## 📝 Notes

1. **Template File**: Use `apps/web/src/hooks/useUser.ts` as the gold standard for all new hooks.

2. **Reference Documentation**:
   - Primary: `.docs/core-concepts/11-ORPC-CLIENT-HOOKS-PATTERN.md`
   - Supporting: `apps/web/AGENTS.md`
   - Routes: `apps/web/src/routes/README.md`

3. **Critical Path**: Fix direct ORPC usage first, then TypeScript errors, then enhancements.

4. **Risk**: Without fixing these issues, the application is vulnerable to:
   - Runtime errors from undefined access
   - Inconsistent cache behavior
   - Poor error reporting
   - Difficult debugging

5. **Estimated Effort**:
   - Phase 1 (Critical): 16-24 hours
   - Phase 2 (Major): 24-32 hours  
   - Phase 3 (Enhancements): 32-48 hours
   - **Total**: 72-104 hours (9-13 working days)

---

**Generated**: 2025-12-11  
**Reviewed by**: AI Coding Agent  
**Status**: Ready for implementation
