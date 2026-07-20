# Deployment — Web Layer (Subagent 2/3)

## Pages
- ✅ `/dashboard/deployments/page.tsx` — exists
- ❌ Uses MOCK data (`MOCK_DEPLOYMENTS`, `MOCK_INCIDENTS`, `MOCK_NOTIFICATIONS`)
- ✅ `/dashboard/projects/.../services/.../deployments/page.tsx` — exists (uses real hooks via adapter)

## Domain Hooks (9 total)
- `useDeploymentList` — query
- `useDeployment` — query detail
- `useDeploymentLogs` — query
- `useDeploymentRollbackHistory` — query
- `useTriggerDeployment` — mutation
- `useCancelDeployment` — mutation
- `useRollbackDeployment` — mutation
- `useRetryDeployment` — mutation
- `useDeleteDeployment` — mutation
- ✅ 0 `as unknown as` violations in deployment hooks

## Issues Found
- Main deployments page: NO loading state, NO error state, NO empty state
- All 6 action buttons are cosmetic (toast only, no mutations wired)
- Nested page uses `as DeploymentLite[]` cast (no Zod validation at boundary)
- mock-hooks.ts file is unused (dead code)
- useDockerDeploymentList adapter creates cross-domain coupling

## Action Items (9)
1. [L] Wire real `useDeploymentList()` into deployments page
2. [S] Add loading skeleton/state to deployments page
3. [S] Add error state to deployments page
4. [M] Wire real mutation hooks (Retry, Rollback, Cancel)
5. [M] Wire Trigger rollout to `useTriggerDeployment()`
6. [S] Add true-empty state (zero deployments CTA)
7. [S] Remove `as DeploymentLite[]` cast, add Zod validation
8. [S] Remove unused mock-hooks.ts
9. [M] Remove MOCK_INCIDENTS/MOCK_NOTIFICATIONS usage
