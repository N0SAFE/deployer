# Image Catalog — Scoped

## Current Problem

Images have **no project/service fields** in their schema. The `dockerImageSchema` is:

```typescript
{ id, hash, parentId, tags, repoDigests, 
  created, size, virtualSize, 
  sharedSize, uniqueSize, 
  containers: number, 
  os, architecture, author,
  dockerVersion, 
  labels: Record<string, string>  // ← Only labels!
}
```

Images are fetched from the Docker daemon globally — there's no concept of "images belonging to project X". The only way to associate an image with a project is through:
- Container `imageId` → Container's `projectId`
- Deployment `containerImage` → string match

## New Architecture: Image Project Membership

### Tracking Table

A new `image_project_membership` table tracks which projects/services have used which images (see `01-data-model.md` for exact schema with partial unique indexes):

### Image → Project Association Triggers

| Event | Action |
|-------|--------|
| Container starts | Read container's `projectId`/`serviceId`, upsert into `image_project_membership` with the container's imageId |
| Deployment creates container | Upsert image membership from deployment's `containerImage` |
| Image is pulled on a node | Check if any container uses it → associate with container's project |
| Periodic reconciliation | Scan all running containers, reconcile image membership |
| Orphan cleanup | Images with no membership for >30 days are cleaned up |

### Scoped Image List API

```typescript
// GET /docker/projects/:projectId/images
dockerProjectImageListContract = dockerImageListOps
  .list()
  .path("/projects/:projectId/images")
  .input((b) => b
    .params(z.object({ projectId: z.uuid() }))
    .query(dockerImageListInputSchema.omit({ projectId: true }))
  )
  .output((b) => b.body(dockerImageListSchema))
  .build()
```

The handler:
1. Reads `image_project_membership WHERE project_id = :projectId`
2. Fetches image details from Docker daemon (cached)
3. Merges membership data with Docker image info
4. Returns scoped image list

### Image Detail: Scoped Scan Results

When viewing an image's security scan results:

```typescript
// GET /docker/projects/:projectId/images/:imageId/security
dockerImageSecurityScanContract = dockerImageSecurityScanOps
  .list()
  .path("/projects/:projectId/images/:imageId/security")
  .input((b) => b
    .params(z.object({ projectId: z.uuid(), imageId: z.string() }))
    .query(z.object({ forceScan: z.boolean().optional() }))
  )
  .output((b) => b.observable(dockerImageSecurityScanEventSchema))
  .build()
```
