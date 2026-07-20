# Container Lifecycle — Scoped

## Creation Flow (Deployment-Driven)

```
User deploys service A1 to environment "prod"
         ↓
DeploymentService.create()
         ↓
Creates container via Docker API
  → Sets labels on container:
    - deployer.projectId = project.id
    - deployer.serviceId = service.id  
    - deployer.deploymentId = deployment.id
    - deployer.environment = "production"
  → Sets managedBy = "deployment_service"
  → Sets managedProjectId, managedServiceId, managedDeploymentId
         ↓
Container starts
         ↓
Docker runtime event "start" received
         ↓
DockerRuntimeActivityProjectorService
  → Reads labels from container inspect
  → Resolves projectId, serviceId, deploymentId
  → Stores resolved scope in container entity cache
  → Emits scoped entity event:
    { kind: "container", action: "start", 
      projectId, serviceId, deploymentId, environment }
         ↓
Entity stream delivers to project subscribers ONLY
```

## Container Label Convention

Every container created or adopted by the platform MUST have these Docker labels:

| Label | Value | Required | Description |
|-------|-------|----------|-------------|
| `deployer.projectId` | UUID | ✅ | Owning project |
| `deployer.serviceId` | UUID | ✅ | Owning service |
| `deployer.deploymentId` | UUID | For managed | Creating deployment |
| `deployer.environment` | string | ✅ | prod/staging/preview/dev |
| `deployer.managedBy` | "deployment_service" | ✅ | Who created it |
| `deployer.version` | semver | Optional | Deployer version |

## Container Discovery (Existing → Scope Resolution)

When the API starts, it discovers containers already running on Docker:

```
Phase 1: List all containers from Docker daemon
Phase 2: For each container:
  a. Read labels → if deployer.projectId exists, use it
  b. If no labels → try to match container.name against 
     deployment.containerName in Postgres
  c. If match found → RECORD mapping in Postgres container_adoption table
     (NOTE: Docker labels CANNOT be backfilled — they're immutable after creation.
      The adoption table acts as an external scope source for legacy containers.
      Docker inspect is NOT called; the mapping comes from deployment records.)
  d. If no match → projectId = "__unmanaged__"
Phase 3: Index into local cache by (projectId, serviceId)  
Phase 4: Emit initial snapshot per project
```

### Container Adoption Table

For containers created before this feature, use an external mapping table instead of Docker labels:

```sql
CREATE TABLE container_scope_mapping (
  container_id TEXT PRIMARY KEY,       -- Docker container ID (sha256)
  project_id UUID NOT NULL REFERENCES projects(id),
  service_id UUID REFERENCES services(id),
  deployment_id UUID REFERENCES deployments(id),
  adopted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  adopted_by UUID REFERENCES users(id),
  UNIQUE(container_id)
);
```

This table is checked BEFORE the `__unmanaged__` fallback but AFTER Docker labels. Legacy containers are "adopted" once and tracked permanently without modifying the immutable container.

### Mesh Routing Index

A distributed registry maps `(projectId) → [nodeId, ...]` so mesh queries only fan out to relevant nodes:

```typescript
interface ProjectNodeIndex {
  projectId: string;
  nodes: Array<{
    nodeId: string;
    lastHeartbeat: string;
    containerCount: number;
  }>;
}
```

- Updated on container start/stop events (via the entity stream)
- Queried BEFORE mesh fanout — only relevant nodes are contacted
- Fallback: full mesh fanout if index is unavailable
- TTL: 60s without heartbeat removes node from index

## Container List API (Scoped)

```typescript
// BOTH list endpoints require projectId

// GET /docker/projects/:projectId/containers
dockerProjectContainerListContract = dockerContainerListOps
  .list()
  .path("/projects/:projectId/containers")
  .input((b) => b
    .params(z.object({ projectId: z.uuid() }))
    .query(dockerContainerListInputSchema.omit({ projectId: true }))
  )
  .output((b) => b.body(dockerContainerListSchema))
  .build()

// GET /docker/projects/:projectId/services/:serviceId/containers  
dockerServiceContainerListContract = dockerContainerListOps
  .list()
  .path("/projects/:projectId/services/:serviceId/containers")
  .input((b) => b
    .params(z.object({ projectId: z.uuid(), serviceId: z.uuid() }))
    .query(dockerContainerListInputSchema.omit({ projectId: true, serviceId: true }))
  )
  .output((b) => b.body(dockerContainerListSchema))
  .build()
```

## Cross-Node Container Querying

When listing containers across mesh nodes:

```
1. Client calls list(projectId) on local node
2. Local node queries its own Docker daemon (scoped)
3. Local node fans out to mesh peers with projectId in payload
4. Each peer returns ONLY containers matching projectId
5. Merge results, deduplicate by container hash
6. Return unified list to client
```

The mesh contract for container queries now carries `projectId`:

```typescript
const meshContainerListContract = meshOps
  .create()
  .path("/mesh/docker/containers/list")
  .input((b) => b.body(z.object({
    projectId: z.uuid(),
    filters: dockerContainerListInputSchema.optional(),
  })))
  .output((b) => b.body(z.array(dockerContainerSchema)))
  .build()
```

## Environment as Scope

Environments are NOT a first-class Docker concept — they're a deployment concept. However, containers carry an `environment` label so the UI can filter:

- Container `environment = "production"` → shown in production views
- Container `environment = "staging"` → shown in staging views
- `environment = null` → likely orphan, shown in admin view

The deployment system ensures environment is always set when creating containers.
