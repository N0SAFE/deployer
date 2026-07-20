# API Surface — Scoped Docker Endpoints

## Contract Reorganization

### New Module Structure

```
docker/
├── index.ts                     — Root dockerContract (unchanged entry point)
├── containers/
│   ├── index.ts                 — Aggregates all container contracts
│   ├── list.ts                  — Global list (admin only, UNCHANGED)
│   ├── grouped.ts               — Grouped by status (UNCHANGED)
│   ├── inspect.ts               — Inspect by ID (UNCHANGED)
│   ├── scoped/
│   │   ├── list.ts              — NEW: scoped by project
│   │   ├── list-by-service.ts   — NEW: scoped by project+service
│   │   └── list-orphans.ts      — NEW: unmanaged containers
│   └── ...
├── images/
│   ├── index.ts
│   ├── list.ts                  — Global list (admin only, UNCHANGED)
│   ├── scoped/
│   │   ├── list.ts              — NEW: images by project
│   │   └── list-by-service.ts   — NEW: images by project+service
│   └── security/
│       └── scanning/
│           ├── stream.ts        — UNCHANGED: scan stream by imageId
│           └── scoped/
│               └── stream.ts    — NEW: scan stream scoped by project
├── scan-config/
│   ├── get.ts                   — NEW: get ProjectScanConfig
│   ├── update.ts                — NEW: update ProjectScanConfig
│   └── trigger.ts               — NEW: trigger manual scan for project
├── networks/                    — UNCHANGED (add scoped variants)
├── volumes/                     — UNCHANGED (add scoped variants)
├── runtime/                     — UNCHANGED
├── entity/
│   ├── list.ts                  — MODIFIED: accept projectId filter
│   ├── stream.ts                — MODIFIED: filter by projectId
│   └── scoped/
│       └── stream.ts            — NEW: scoped entity stream
└── ...
```

## New Endpoints

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `GET` | `/docker/projects/:projectId/containers` | List containers scoped to project | `requireAuth` + project membership |
| `GET` | `/docker/projects/:projectId/services/:serviceId/containers` | List containers for a service | `requireAuth` + project membership |
| `GET` | `/docker/projects/:projectId/images` | List images scoped to project | `requireAuth` + project membership |
| `GET` | `/docker/projects/:projectId/images/:imageId/security` | Stream scan for project image | `requireAuth` + project membership |
| `GET` | `/docker/projects/:projectId/containers/unmanaged` | Orphan containers for project | `requireAuth(admin)` |
| `GET` | `/docker/scan-config/projects/:projectId` | Get scan config | `requireAuth` + project membership |
| `PUT` | `/docker/scan-config/projects/:projectId` | Update scan config | `requireAuth` + project admin |
| `POST` | `/docker/scan-config/projects/:projectId/trigger` | Manual scan trigger | `requireAuth` + project admin |
| `GET` | `/docker/entity/stream?projectId=...` | Entity stream filtered by project | `requireAuth` + project membership |

## Modified Endpoints

| Endpoint | Change |
|----------|--------|
| `POST /docker/containers/list` | Input now REQUIRES `projectId` (breaks old clients without it) |
| `POST /docker/images/list` | Input now accepts optional `projectId` filter |
| `GET /docker/entity/stream` | New `projectId` query parameter filters stream |
| `GET /docker/runtime/activity/list` | New `projectId` filter parameter |

## UI Impact

The web hooks (`apps/web/src/domains/docker/hooks.ts`) gain new scoped query hooks:

```typescript
// New hooks
export function useProjectContainers(projectId: string, filters?: ContainerFilters) {
  return useQuery(
    dockerEndpoints.containers.scoped.list.queryOptions({
      input: { params: { projectId }, query: filters }
    })
  )
}

export function useServiceContainers(projectId: string, serviceId: string, filters?: ContainerFilters) {
  return useQuery(
    dockerEndpoints.containers.scoped.listByService.queryOptions({
      input: { params: { projectId, serviceId }, query: filters }
    })
  )
}

export function useProjectImages(projectId: string) {
  return useQuery(
    dockerEndpoints.images.scoped.list.queryOptions({
      input: { params: { projectId } }
    })
  )
}

export function useProjectScanConfig(projectId: string) {
  return useQuery(
    dockerEndpoints.scanConfig.get.queryOptions({
      input: { params: { projectId } }
    })
  )
}

export function useUpdateProjectScanConfig(projectId: string) {
  return useMutation(
    dockerEndpoints.scanConfig.update.mutationOptions()
  )
}
```

## Deprecation Path

Old global endpoints remain but log deprecation warnings:

| Old Endpoint | Deprecated In | Removed In |
|-------------|---------------|------------|
| `POST /docker/containers/list` (without projectId) | v1.1 | v2.0 |
| `POST /docker/images/list` (without projectId) | v1.1 | v2.0 |
| `GET /docker/entity/stream` (without projectId) | v1.1 | v2.0 |
