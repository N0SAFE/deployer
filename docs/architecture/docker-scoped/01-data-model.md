# Data Model — Scoped Docker Entities

## Core Principle: Project is the Root Scope

Every Docker entity (container, image, network, volume) belongs to **exactly one project**. Belonging is determined by:

1. **Explicit assignment** — `managedProjectId` is set when a deployment creates the container
2. **Implicit tagging** — The runtime event projector resolves project/service from container labels at creation time
3. **Orphan bucket** — Unidentifiable containers get a virtual `__unmanaged__` project scope

## Entity Relationship Diagram

```
Project
  ├── id: uuid
  ├── name: string
  │
  ├─── Service
  │     ├── id: uuid
  │     ├── projectId: uuid ──────────────────────┐
  │     ├── name: string                           │
  │     │                                          │
  │     ├─── Deployment                            │
  │     │     ├── id: uuid                         │
  │     │     ├── serviceId: uuid ─────────────────┤
  │     │     ├── environment: enum                │
  │     │     ├── containerName: string            │
  │     │     └── containerImage: string           │
  │     │                                          │
  │     └─── Container (via mesh)                  │
  │           ├── id: docker_id                    │
  │           ├── projectId: string ←──────────────┘
  │           ├── serviceId: string ←──────────────┘
  │           ├── managedDeploymentId: uuid ←──────┘
  │           ├── environment: enum
  │           └── managedBy: "deployment_service"
  │
  ├─── Image (via deployments)
  │     ├── id: docker_image_id
  │     ├── projectId: string
  │     ├── serviceId: string (optional)
  │     └── tags: string[]
  │
  └─── Scan Configuration (NEW)
        ├── id: uuid
        ├── projectId: uuid
        ├── autoScanEnabled: boolean
        ├── scanners: ("trivy" | "grype" | "dive")[]
        ├── serviceFilters: (include | exclude)[]
        │     └── serviceId: uuid
        │     └── pattern: string
        └── schedule: "on_push" | "on_deploy" | "daily" | "manual"
```

## New/Modified Schemas

### `ProjectScanConfig` (NEW — persisted to Postgres)

```typescript
export const projectScanConfigSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  autoScanEnabled: z.boolean().default(false),  // ← OFF by default
  scanners: z.array(z.enum(["trivy", "grype", "dive"])).default(["trivy"]),
  serviceFilters: z.array(z.object({
    type: z.enum(["include", "exclude"]),
    serviceId: z.uuid().optional(),
    pattern: z.string().optional(),  // glob for service name
  })).default([]),
  schedule: z.enum(["on_push", "on_deploy", "daily", "manual"]).default("on_deploy"),
  maxCacheAgeHours: z.number().int().default(6),
  notifyOnFindings: z.boolean().default(false),
  notifyChannels: z.array(z.enum(["email", "webhook"])).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

### `ScopedContainerListInput` (MODIFIED — projectId required)

```typescript
export const scopedContainerListInputSchema = dockerContainerListInputSchema.extend({
  projectId: z.string().min(1),          // ← REQUIRED: containers are always scoped
  serviceId: z.string().optional(),      // Filter within project
  environment: z.enum(["production","staging","preview","development"]).optional(),
  scope: z.enum(["project", "service", "all"]).default("project"),
  // "project" = containers belonging to this project
  // "service" = containers belonging to a specific service within project
  // "all" = UNFILTERED (admin only, returns orphans too)
});
```

### `ScopedImageListInput` (MODIFIED — projectId required)

```typescript
export const scopedImageListInputSchema = dockerImageListInputSchema.extend({
  projectId: z.string().min(1),          // ← REQUIRED
  serviceId: z.string().optional(),      // Filter images used by a service
  includeUnused: z.boolean().default(false), // Show images not linked to any container
});
```

### `ImageProjectMembership` (NEW — tracking table)

```sql
CREATE TABLE image_project_membership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id TEXT NOT NULL,           -- Docker image ID (sha256)
  image_tag TEXT,                   -- Tag at time of association (mutable!)
  project_id UUID NOT NULL REFERENCES projects(id),
  service_id UUID REFERENCES services(id),  -- optional: narrower scope
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seen_count INTEGER NOT NULL DEFAULT 1
);

-- Partial unique indexes to handle nullable service_id correctly
CREATE UNIQUE INDEX idx_membership_project 
  ON image_project_membership(image_id, project_id) 
  WHERE service_id IS NULL;

CREATE UNIQUE INDEX idx_membership_service 
  ON image_project_membership(image_id, project_id, service_id) 
  WHERE service_id IS NOT NULL;

-- Hash index for CVE broadcast queries
CREATE INDEX idx_membership_image_id 
  ON image_project_membership USING hash(image_id);

-- B-tree index for project-scoped queries
CREATE INDEX idx_membership_project_id 
  ON image_project_membership(project_id);
```

### `SecurityScanResult` (MODIFIED — add project/service columns)

```typescript
export const scopedSecurityScanResultSchema = dockerImageSecurityScanSummarySchema.extend({
  projectId: z.uuid(),
  serviceId: z.uuid().optional(),
  imageId: z.string().min(1),
  imageTag: z.string().optional(),
  scanConfig: z.object({
    triggeredBy: z.enum(["auto", "manual", "schedule"]),
    scannerProfile: z.string(),
  }),
});
```

## Container Project Resolution Strategy

When a new container appears on the Docker daemon:

```
1. Docker event "start" received
2. Check container labels:
   - "deployer.projectId" → use as projectId
   - "deployer.serviceId" → use as serviceId  
   - "deployer.deploymentId" → use as managedDeploymentId
3. If NO labels exist:
   - Check if any container name matches deployment.containerName
   - If match → resolve project/service from deployment
   - If no match → tag as project="__unmanaged__"
4. Store resolved scope in container entity cache
5. Emit scoped entity event to project subscribers only
```

## Orphan Container Handling

Orphans are containers that Docker is running but the platform has no record of creating. They get:

- `projectId = "__unmanaged__"` (virtual scope)
- `managedBy = "orphan"`
- Visible ONLY in admin/project-level "unmanaged" views
- Never included in per-project container lists
- Can be "adopted" into a project via a manual action
