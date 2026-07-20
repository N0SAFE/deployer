# Service — Subagent 2/3: Web/Frontend Layer

## Pages: 11 service page.tsx files
### Standalone:
- `dashboard/services/page.tsx` — services list, FULLY MOCKED
### Nested under projects:
- `dashboard/projects/.../services/[serviceId]/page.tsx` — detail, FULLY MOCKED
- `dashboard/projects/.../services/[serviceId]/deployments/page.tsx` — FULLY MOCKED
- `dashboard/projects/.../services/[serviceId]/logs/page.tsx` — FULLY MOCKED
- `dashboard/projects/.../services/[serviceId]/monitoring/page.tsx` — FULLY MOCKED
- `dashboard/projects/.../services/[serviceId]/previews/page.tsx` — FULLY MOCKED
- `dashboard/projects/.../services/[serviceId]/configuration/page.tsx` — FULLY MOCKED
- `dashboard/projects/.../services/[serviceId]/configuration/general/page.tsx` — FULLY MOCKED
- `dashboard/projects/.../services/[serviceId]/configuration/provider/page.tsx` — FULLY MOCKED
- `dashboard/projects/.../services/[serviceId]/configuration/network/page.tsx` — FULLY MOCKED
- `dashboard/projects/.../services/[serviceId]/configuration/environment/page.tsx` — FULLY MOCKED

## Domain Hooks: 9 real hooks available
- useServiceList, useService, useServiceDependencies — queries
- useCreateService, useUpdateService, useDeleteService — mutations
- useToggleServiceActive, useAddServiceDependency, useRemoveServiceDependency — mutations

## Current Status
- 0 pages use real domain hooks
- 11 pages FULLY MOCKED
- 2 files (DashboardSidebar, ServiceDependencyGraphPanel) use real hooks — but not the service pages themselves

## Web-specific Issues
- All mock data from @/mocks/platform
- No loading/error/empty states needed (mock data never fails)
- 1 unused mock-hooks.ts file

## Todo List (Web Layer ONLY)
1. [XL] Migrate all 11 service pages from mock → real domain hooks
2. [S] Delete mock-hooks.ts after migration complete
3. [M] Add loading/error/empty states for real API data
4. [M] Add SSE stream consumer hook for real-time updates
