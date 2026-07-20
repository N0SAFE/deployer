# Migration Plan — Global → Scoped Docker

## Phase 1: Data Layer (Week 1)

### 1.1 Create Migration

Generate a Drizzle migration for:
- `image_project_membership` table
- `project_scan_config` table  
- Add `project_id` column to `image_security_scans` table
- Add `service_id` column to `image_security_scans` table

### 1.2 Seed Membership for Existing Containers

On deploy, run a background job that:

```
1. List all running containers from Docker daemon
2. For each container:
   a. Read deployer.projectId label → upsert into image_project_membership
   b. Read deployer.serviceId label → upsert with service_id
   c. If no labels → skip (orphan)
3. Reconcile: remove memberships for images no longer in use
```

### 1.3 Create Default Scan Configs

For each existing project that has active deployments:

```typescript
await db.insert(projectScanConfig).values({
  projectId: project.id,
  autoScanEnabled: false,  // OFF by default
  scanners: ["trivy"],
  serviceFilters: [],
  schedule: "on_deploy",
  maxCacheAgeHours: 6,
});
```

## Phase 2: API Layer (Week 2)

### 2.1 Add Scoped Endpoints

1. Create `scoped/` sub-directories in contracts
2. Implement `docker.containers.scoped.*` handlers
3. Implement `docker.images.scoped.*` handlers
4. Implement `docker.scanConfig.*` handlers
5. Implement `docker.entity.stream?projectId=` filter
6. Add scoped web hooks

### 2.2 Add Project Resolution to Entity Stream

Modify `DockerEntityOrchestratorService`:

```typescript
// Before emitting entity events, resolve project scope
const scope = await this.resolveProjectScope(entity)
if (scope) {
  // Emit to project-specific stream
  this.projectEventBus.emit(scope.projectId, event)
}
// Always emit to global stream (for admin views)
this.globalEventBus.emit(event)
```

## Phase 3: Scanning Layer (Week 3)

### 3.1 Implement Scan Config

1. Create `DockerScanConfigService` with CRUD for `ProjectScanConfig`
2. Modify `DockerImageAutoScanListenerService`:
   - On container start → resolve projectId → read `ProjectScanConfig`
   - If `autoScanEnabled` + service filter passes → queue scan
   - If not → skip
3. Add `triggerManualScan(projectId, imageIds)` endpoint

### 3.2 Modify Scan Result Persistence

1. Update `DockerImageSecurityRepository` to persist `projectId` + `serviceId` with scan results
2. Backfill existing scan results with projectId from container inspection

## Phase 4: UI Layer (Week 4)

### 4.1 New Project Docker Views

1. Replace global Docker dashboard with project-scoped view
2. Add project context switcher in Docker section
3. Add orphan container view in admin panel

### 4.2 Scanning Configuration UI

1. Add `/dashboard/projects/:id/security` page
2. Add scan config form (enable/disable, scanners, filters, schedule)
3. Add scan results view per project with service breakdown

### 4.3 Auto-Login Hint Update

The post-setup "Configure image scanning" hint now points to:

```
/dashboard/projects → select project → Security tab
```

Instead of the generic `/dashboard/admin/system`.

## Rollback Plan (Phased with Safe Reversibility)

The migration is designed so EVERY phase is individually reversible without data loss:

```
Phase 0 (Data Layer)
  ├── Adds image_project_membership table
  ├── Adds container_scope_mapping table
  ├── Adds project_scan_config table  
  ├── Adds columns to image_security_scans
  └── ROLLBACK: DROP TABLE, REMOVE COLUMNS. Zero data loss.
        Old endpoints still work. Backfill data simply disappears.

Phase 1 (Scoped API — additive only)
  ├── Adds new scoped endpoints alongside old endpoints
  ├── Old endpoints: `POST /docker/containers/list` (works WITHOUT projectId)
  ├── New endpoints: `POST /docker/projects/:projectId/containers` (requires projectId)
  ├── Both code paths exist simultaneously
  ├── ROLLBACK: Remove scoped endpoints. Old endpoints still serve.
        No client migration needed — web UI can switch back instantly.

Phase 2 (Web UI migration)
  ├── Web UI switches to new scoped endpoints
  ├── Old endpoints still live for backward compat
  ├── ROLLBACK: Revert web UI to old endpoints. Server unchanged.

Phase 3 (Deprecation — optional)
  ├── Add deprecation warnings to old endpoints
  ├── ROLLBACK: Remove warnings. No functional change.
```

**Critical rule**: No code path is ever removed in the same PR that adds a new one. Old endpoints are kept for at least 1 major version after deprecation announcement.

### Backfill Locking

The backfill job MUST use a distributed lock:

```typescript
// Postgres advisory lock (prevents concurrent backfill across nodes)
const LOCK_ID = 0xDEAD_BEEF; // arbitrary bigint
await db.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_ID})`);
```

Without this, two nodes running the backfill simultaneously will race on `image_project_membership` upserts.

### Scan Result Backfill Rule

When backfilling existing scan results with `projectId`:

> *"If an image is used by containers in multiple projects, create one scan result row per project."*

Do NOT assign a single ambiguous `projectId`. The scan result for `node:22-alpine` is created once per project that uses it, even if the underlying vulnerability data is identical. Deduplication happens at query time via `DISTINCT ON (image_id, project_id)`.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Orphan containers hidden from users | Low — admin views show all | Dedicated "unmanaged" view |
| Image membership slow on large nodes | Medium — 10k+ images | Cache + async reconciliation |
| Scan config DB query on every container event | Medium | Cache ProjectScanConfig with 60s TTL |
| Breaking existing API clients | High — projectId becomes required | Keep old endpoints as deprecated for 1 major version |
| Labels not set on existing containers | Low — backfill on discovery | Background job + migration script |
