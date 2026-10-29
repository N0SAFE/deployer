# Vulnerability Scanning — Per-Project Architecture

## Design Goals

1. **Scanning is opt-in per project** — disabled by default, enabled explicitly
2. **Per-service filters** — which services get scanned (include/exclude patterns)
3. **Scoped results** — scan results are linked to project + service + image
4. **Per-node configuration** — the global `DISABLE_AUTO_SCAN` env var is replaced by `ProjectScanConfig`
5. **Multiple scanner profiles** — each project can choose which scanners to run

## Architecture Overview

```
ProjectScanConfig (Postgres)
  ├── projectId
  ├── autoScanEnabled: false (default)
  ├── scanners: ["trivy"]
  ├── serviceFilters: []
  └── schedule: "on_deploy"
         │
         ▼
DockerImageAutoScanListenerService
  ┌─────────────────────────────────────┐
  │ Receives Docker runtime events       │
  │ For each image event:                │
  │   1. Resolve projectId from container│
  │   2. Read ProjectScanConfig          │
  │   3. Check service filters           │
  │   4. If eligible → queue scan       │
  └──────────┬──────────────────────────┘
             │
             ▼
DockerImageSecurityScanService
  ┌─────────────────────────────────────┐
  │ Runs scanners (trivy/grype/dive)    │
  │ Persists results with projectId     │
  │ + serviceId + imageId                │
  │ Streams events per project          │
  └──────────┬──────────────────────────┘
             │
             ▼
ScannerContainerManagerService
  ┌─────────────────────────────────────┐
  │ Shared scanner containers (unchanged)│
  │ trivy, grype, dive daemons          │
  └─────────────────────────────────────┘
```

## Data Flow

### Step 1: Project Config Created

When a project is created, a default `ProjectScanConfig` row is created:

```json
{
  "projectId": "...",
  "autoScanEnabled": false,
  "scanners": ["trivy"],
  "serviceFilters": [],
  "schedule": "on_deploy",
  "maxCacheAgeHours": 6
}
```

### Step 2: User Enables Scanning

Via `/dashboard/projects/:id/security` UI:

1. Toggle `autoScanEnabled: true`
2. Optionally add service filters:
   - Include only services matching pattern
   - Exclude certain services
3. Select scanners (trivy, grype, dive)
4. Set schedule (on_push, on_deploy, daily, manual)
5. Configure notifications

### Step 3: Scan Triggered

Scan triggers:

| Trigger | Condition | Action |
|---------|-----------|--------|
| **Auto-scan on deploy** | `schedule: "on_deploy"` + `autoScanEnabled: true` | After deployment creates image, scan it |
| **Auto-scan on push** | `schedule: "on_push"` + `autoScanEnabled: true` | After image push, scan |
| **Auto-scan on start** | `autoScanEnabled: true` + existing eligibility check | On container start, scan if not cached |
| **Daily scan** | `schedule: "daily"` | Cron job scans all project images |
| **Manual scan** | User clicks "Scan now" | Immediate scan regardless of config |
| **Schedule scan** | Any schedule | Via cron-like scheduler |

### Step 4: Scan Execution

```
1. Resolve scan config for image's project
2. Check service filters:
   - If image belongs to excluded service → skip
   - If image belongs to included service → scan
   - If no filters → scan all (if autoScanEnabled)
3. Check cache:
   - If scanned within maxCacheAgeHours → return cached
   - If forceScan → bypass cache
4. Run scanners (trivy first, then grype, then dive)
5. Merge results
6. Persist to DB with projectId + serviceId
7. Emit scan events to project SSE stream
8. If notifyOnFindings + critical/high findings → send notification
```

### Step 5: Results Storage

```sql
CREATE TABLE image_security_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  service_id UUID REFERENCES services(id),
  image_id TEXT NOT NULL,               -- Docker image ID
  image_tag TEXT,
  scanner_profile TEXT NOT NULL,        -- "trivy", "trivy+grype", etc.
  triggered_by TEXT NOT NULL,           -- "auto", "manual", "schedule"
  total_findings INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  high_count INTEGER NOT NULL DEFAULT 0,
  medium_count INTEGER NOT NULL DEFAULT 0,
  low_count INTEGER NOT NULL DEFAULT 0,
  scan_duration_ms INTEGER,
  scanner_results JSONB,               -- per-scanner status
  vulnerabilities JSONB,                -- the actual CVE entries
  cached BOOLEAN NOT NULL DEFAULT false,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scans_project ON image_security_scans(project_id);
CREATE INDEX idx_scans_image ON image_security_scans(image_id);
CREATE INDEX idx_scans_service ON image_security_scans(service_id);
```

## Service Filters

Service filters allow fine-grained control over which services get scanned:

```typescript
type ServiceFilter = 
  | { type: "include_all" }                              // scan all services
  | { type: "include"; serviceIds: string[] }            // only these services
  | { type: "exclude"; serviceIds: string[] }            // all except these
  | { type: "pattern"; include: string[]; exclude: string[] }  // glob patterns

// Example: scan only payment-service and auth-service
{
  "serviceFilters": [{ "type": "include", "serviceIds": ["<payment-id>", "<auth-id>"] }]
}

// Example: scan everything except preview environments  
{
  "serviceFilters": [{ "type": "exclude", "environments": ["preview"] }]
}
```

## Per-Node Configuration

Each node can override project scan config via the local `node_config.post_setup_flags`:

```json
{
  "scanning:project:<projectId>": {
    "enabled": true,
    "scanners": ["trivy"],
    "maxConcurrentScans": 2,
    "idleTimeoutMinutes": 10
  }
}
```

This lets nodes in different environments (e.g., edge vs core) have different scanning behavior.

## Scan Config Merge Strategy (Layered Override)

The scan configuration has THREE layers. Lower layers are overridden by higher layers:

```
Layer 1: ProjectScanConfig (Postgres)
  ── default, set by project admin
Layer 2: NodeConfig.post_setup_flags["scanning:project:<id>"] (SQLite)
  ── per-node override, managed by node operator
Layer 3: DISABLE_AUTO_SCAN env var (emergency)
  ── global kill switch, overrides everything
```

### Merge Rules

| Setting | Merge Behavior |
|---------|---------------|
| `autoScanEnabled` | **Layer 2 wins** — node can disable scanning even if project enables it |
| `scanners` | **APPEND** — node scanners are added to project scanners (no dedup) |
| `serviceFilters` | **Layer 2 overrides Layer 1** — node operator decides which services to scan locally |
| `maxConcurrentScans` | **Layer 2 wins** — node controls its own parallelism |
| `schedule` | **Layer 1 only** — schedule is a project-level concern |
| `notifyOnFindings` | **Layer 1 only** — notifications are project-level |

**Edge nodes without scanner daemon**: If `ScannerContainerManagerService.ensureContainerRunning()` fails because the scanner-runner image is not available, the scan MUST return a 501 "Scanner not available" error, NOT silently skip the image.

### Runtime budget and database cache (measured 2026-10-27)

The `deployer-scanner-runner:latest` image is built by `bun run docker:build:scanner-runner`
and is not part of the compose stack, so a fresh dev host runs the **ephemeral
per-scanner fallback** for every scan. Two facts make that path work:

- **Grype downloads its vulnerability DB before matching.** Measured on the dev
  host for a 1.2 GB image: **3m08s cold**, **53s warm**. The previous
  `VULNERABILITY_SCAN_TIMEOUT_MS = 120_000` expired before a cold run could ever
  finish, so every scan of a non-trivial image reported "Timed out waiting for
  scanner container" and the UI stayed at 1 %.
- **The DBs live in a named volume**, `deployer-scanner-cache`, mounted at
  `/root/.cache` with `TRIVY_CACHE_DIR` / `GRYPE_DB_CACHE_DIR` pointing inside it.
  Ephemeral containers are removed after every run (`v: true` removes only
  ANONYMOUS volumes), so without the volume every scan re-downloaded ~700 MB.

The timeout is now 10 minutes, which covers a cold download; warm scans finish
well inside it.

### Scanner concurrency is computed per scan (2026-10-28)

`APP_DOCKER_IMAGE_SCAN_PARALLELISM` is a **ceiling** (1..3, default 3), not the
answer. `apps/api/services/runtime/src/modules/docker/services/scan-concurrency.ts`
decides the actual number from three live inputs:

| Signal | Effect |
|---|---|
| a deployment or image build is in flight | 1 (`build-or-deploy-in-flight`) |
| `MemAvailable < 12 %` | 1 (`critical-memory`) |
| swap used `> 50 %` | 1 (`swap-pressure`) |
| load per core `> 1` | 1 |
| `MemAvailable < 25 %` | at most 2 |
| one scan already running | one slot spent (`ceiling - scans`) |

Producers report themselves through `beginHeavyWork("scan" | "build" | "deploy")`
(`apps/api/shared/src/core/utils/heavy-work.registry.ts`): the scanner container
runner, `DeploymentQueueWorkerService.processQueueJob`, and
`DeploymentArtifactBuilderService` (the image build). This is what makes a scan
started during a deployment serial instead of stacking three analysers on top of
a build — the combination that took the 14 GB dev host into 25 GB of swap until
`docker ps` stopped answering.

Measured on that host while writing this: `swapUsedRatio 0.77` → the planner
returns `1 (swap-pressure)` even with an idle scan queue.

**The stream endpoint starts a scan only with `forceScan: true`.** Without it,
`streamImageSecurityScan` observes a running scan or replays a cached result, and
completes with ZERO events when neither exists — the create-container modal must
therefore request `forceScan: true`, and a client that receives an event-less
stream must surface that as an error rather than waiting.


### ServiceFilter (Single Canonical Definition)

```typescript
type ServiceFilter = 
  | { type: "include_all" }                                  // scan all services
  | { type: "include"; serviceIds: string[] }                 // only these services
  | { type: "exclude"; serviceIds: string[] }                 // all except these
  | { type: "pattern"; include: string[]; exclude: string[] } // glob patterns
```

This is the **only** valid type — used consistently across schemas, API docs, and UI.
