# Swarm Orchestration — 05 · Swarm Execution Backend

> **Status:** Design finalized, implementation pending
> **Scope:** `apps/api/src/modules/deployment/runners/swarm/**`, Traefik wiring, state reconciliation
> **Companion:** `04-node-sharing-and-placement.md` (placement), `03-master-takeover-failover.md` (execution ownership)

---

## 1. Goal

Run **user deployments** on the swarm cluster behind the existing `DeploymentRuntimeRunner` abstraction, so the platform gains scheduling, health checks, rolling updates, rollback, and auto-reschedule with **zero changes to the deployment business logic** (queue, policies, environments, approval gates).

## 2. Runner registration — additive, not a rewrite

**SDK-first, zero CLI:** every operation in this doc is a dockerode call against the Docker Engine API (the same API the `docker` CLI speaks). `dockerode ^5` is already the engine client (`apps/api/package.json`, wrapped by `DockerService` at `apps/api/src/core/modules/docker/services/docker.service.ts`) and natively covers the full Swarm surface: `swarm init/join/leave/inspect`, services, tasks, nodes, secrets, configs, overlay networks, cluster volumes. The API layer never shells out to a CLI binary.

The runner registry (`runtime-runner.interface.ts`, `runners.module.ts`) gains a new member:

```ts
// runtime-runner.interface.ts — new union member
export type DeploymentRuntimeRunnerType =
  | "docker"      // existing: direct container on local engine
  | "docker-compose" // existing
  | "swarm";        // NEW: docker service / docker stack on cluster

export interface RuntimeExecutionResult {
  // existing fields…
  serviceId: string | null;     // NEW: docker service id (swarm)
  serviceName: string | null;   // NEW: docker service name (swarm)
  taskIds: string[];            // NEW: resolved task ids after converge
}
```

`SwarmRuntimeRunnerService` implements the same `executeRuntime(input)` contract as `DockerRuntimeRunnerService` (`apps/api/src/modules/runners/docker/docker-runtime-runner.service.ts`), reusing:

- the `TraefikService` + label logic → **swarm provider** labels instead of manual config sync,
- the storage binding materialization (binds/mounts get an optional swarm named-volume translation),
- `sanitizeExecutorLabels` / `sanitizeStartupCommand` / `sanitizeEnvironmentVariables` helpers.

## 3. Execution mapping (deployment → swarm spec)

A deployment compiles to a **typed `SwarmServiceSpec`** (dockerode's native service-spec type) via a pure mapper — never a CLI command:

| Deployment concept | SDK mapping (dockerode) |
|---|---|
| Build artifact (`containerImage`) | `DockerService.createService({ TaskTemplate: { ContainerSpec: { Image } } })` / idempotent update |
| name | `Spec.Name = deployer-<serviceId>-<deploymentId>` (reuse `fallbackName` pattern) |
| replicas | `Spec.Mode.Replicated.Replicas` from deployment policy (`EnvironmentPolicy.Replicas`) |
| env vars | `TaskTemplate.ContainerSpec.Env` |
| cpu/mem (`cpuShares`/`memoryLimitBytes`) | `TaskTemplate.Resources.Limits` / `Reservations` (`NanoCPUs`, `MemoryBytes`) |
| mounts / storage binding | `TaskTemplate.ContainerSpec.Mounts` (named volumes) or `Binds` with a `local` constraint only when unavoidable |
| health gate (`healthCheckUrl`/`healthGateConfig`) | `TaskTemplate.ContainerSpec.Healthcheck` + `TaskTemplate.RestartPolicy` + `UpdateConfig.FailureAction = "rollback"` |
| startup command | `TaskTemplate.ContainerSpec.Command` / `Args` |
| attached network | overlay network `deployer-<projectId>` (create once via `DockerService.createNetwork({ Driver: "overlay" })`, then `TaskTemplate.Networks` — skip `--attachable` unless cross-service attach needed) |
| labels (`deployer.*`) | `Spec.Labels` + `TaskTemplate.ContainerSpec.Labels` — automatically found by existing label readers (`com.docker.swarm.service.name` already read in `docker.repository.ts:1128` and `container-link.service.ts:47`) |
| update strategy | `Spec.UpdateConfig = { Order: "start-first", Parallelism: 1, FailureAction: "rollback" }` |
| rollback | `Spec.RollbackConfig` mirrors + platform `rollbackTo()` ⇒ `DockerService.getService(name).update({ Spec, Rollback: … })` (dockerode supports the `rollback` flag on service update) |
| scale | `DockerService.getService(name).update({ Spec: { Mode: { Replicated: { Replicas } } } })` |

### 3.1 Perfect type safety: the typed spec layer

dockerode ships TS types for the Swarm API (and `DockerService` wraps the instance), but several shapes are permissive (`Record<string, unknown>`-ish, wide unions). Per repo rules (zero `as` assertions, Zod validates all external data, parse don't validate), the swarm boundary is owned by contracts:

1. **Canonical Zod schemas** (NEW `packages/contracts/entities/src/entities/swarm/`, mirroring the existing `entities/docker/` inspect-schema pattern):
   - `service.spec.schema.ts` — the deployable service spec (image, mode, resources, placement, networks, labels, update/rollback, healthcheck, env)
   - `service.inspect.schema.ts` — parse of `serviceInspect()` response (id, version, spec, endpoint, update status) for the reconciliation path
   - `node.schema.ts` — `nodeList()/nodeInspect()` rows (role, availability, status, labels, engine info)
   - `task.schema.ts` — `listServiceTasks()` rows (state, error, slot, nodeId) for convergence/health decisions
   - `secret.schema.ts`, `config.schema.ts`, `network.schema.ts`, `cluster-volume.schema.ts`
2. **Pure, unit-tested mappers** (no side effects, no IO):
   - `toDockerServiceSpec(deployment, placementPolicy): SwarmServiceSpec` — forward map; the **only** place that builds dockerode shapes
   - `fromDockerServiceInspect(raw): SwarmServiceInspect` — `schema.parse(raw)` (parse, don't validate); Zod throws on unexpected shape → typed `AppError` with the failed field for correlation
3. **Boundary rule:** business logic (queue, workflow, reconciliation) imports **only** the Zod types; dockerode types never leak past `DockerService` + the mappers.
4. **No `docker stack deploy`:** stack deploy is a *client-side compose transform*, not an Engine API call — there is no SDK method for it. Compose inputs are parsed to a typed model, validated, then realized via the same `createService/createNetwork/createVolume/createSecret` calls (§6).

## 4. Identity linking (DB ↔ swarm)

Today the code already reconciles swarm-created objects via label candidates: `com.docker.compose.service` and `com.docker.swarm.service.name`. For services we create we **must own** the identity:

- Every swarm service gets `deployer.service_id`, `deployer.deployment_id`, `deployer.project_id`, `deployer.managed=true` (same label set as the direct runner — see `docker-runtime-runner.service.ts`).
- `cluster.service-inventory` (DB table, populated by reconciliation) maps `serviceName ↔ deploymentId ↔ serviceId` so `listContainersByDeployment`-style lookups work against tasks:

```text
deploymentId → service labels → DockerService.listServices(filter) → DockerService.getService(name) → DockerService.listServiceTasks(serviceId) → tasks
```

## 5. Traefik: swarm provider

- Traefik runs as a swarm service (multi-node) or standalone with `providers.docker.swarmMode=true` (single-node/transition).
- Labels are attached **to the swarm service spec** (`Spec.Labels`, set via the same typed mapper) — Traefik reads them from the swarm provider. The YAML below is the declared intent; the runner realizes it as `Spec.Labels`:

```yaml
# Declared (typing: StackSpec) → realized as Spec.Labels by toDockerServiceSpec()
deploy:
  labels:
    - "traefik.enable=true"
    - "traefik.docker.swarmMode=true"
    - "traefik.http.routers.<svc>.rule=Host(`app.example.com`)"
    - "traefik.http.services.<svc>.loadbalancer.server.port=3000"
    - "traefik.http.services.<svc>.loadbalancer.server.scheme=http"
```

- `TraefikService` no longer hand-writes dynamic config for swarm-managed services — it **verifies** label presence and lets the swarm provider converge. Route verification (`routeVerification` in `RuntimeExecutionResult`) becomes a Traefik API check instead of a file check.
- The direct-proxy supervisor remains only as the "traefik is down" fallback (unchanged from `production-deployment.mdx`).

## 6. Compose stacks (user `docker-compose.yml` projects)

**There is no SDK for `docker stack deploy`** — stack deploy is a client-side transformation of a compose model into Engine API calls, exactly what the CLI does before talking HTTP. The platform implements that transformation itself, fully typed:

1. **Parse** the compose file with a typed compose parser → validated `ComposeModel` (services, networks, volumes, secrets, configs).
2. **Validate** against `entities/swarm/` schemas + a compose-to-swarm compatibility report (unsupported keys: `build` with unresolved context, raw `ports` on non-ingress nodes, some `volumes` bind forms) → explicit, actionable errors surfaced in the deployment UI (matches the existing compose gate behavior).
3. **Realize** via dockerode, in dependency order (same calls the CLI would make):
   - `DockerService.createConfig/createSecret` (if any)
   - `DockerService.createNetwork({ Driver: "overlay", ... })` (idempotent — reuse by name)
   - `DockerService.createVolume({ Driver: "local", ... })` for named volumes
   - `DockerService.createService(spec)` per compose service (`toDockerServiceSpec` + compose-specific fields)
4. **Track** the resulting `serviceId`s in `cluster.service-inventory` with the stack name for group lifecycle (`stack:deploy/stop/remove` = create/update/remove over the service set — no compose orchestration).
5. The `docker-compose` runner keeps its file-based path **only** for edge nodes (no swarm) — same compose-parsing step, different executor.

## 7. State reconciliation

Extend the existing reconciliation loop (`deployment-queue-reconciliation.service.ts`):

| Check | Action |
|---|---|
| DB says `running`, `docker service ls` missing/failed | mark failed w/ reason; retry per policy |
| Swarm service exists, DB missing/stale | adopt into `cluster.service-inventory` (labels are the source of identity) |
| Task `Shutdown`/`Rejected` count > threshold | health gate failure → policy-driven rollback/alert |
| `docker node ls` role/label drift | `ClusterService.reconcile()` fixes `cluster.nodes` + placement policy cache |
| `cluster.master` heartbeat stale | trigger watchdog → `03-master-takeover-failover.md` |

## 8. Lifecycle events

| Event | Behavior (dockerode SDK) |
|---|---|
| Deploy | `createService(spec)` (idempotent by name) → wait for `Running` tasks within health-gate budget → verify Traefik |
| Redeploy | `updateService(spec, { version })` (rolling; old tasks drain via `UpdateConfig`) OR compose-model re-realize (§6) |
| Rollback | `getService(name).update({ ..., rollback: true })` (dockerode supports the `rollback` flag) — uses `Spec.RollbackConfig` |
| Stop/Remove | `getService(name).remove()` (drains tasks gracefully) |
| Scale | `getService(name).update({ Spec: { Mode: { Replicated: { Replicas } } } })` |
| Preview cleanup | remove service(s) + remove stack-scoped networks/volumes when `preview-cleanup-policy` fires |

## 9. Error model

- Reuse `AppError` hierarchy: map dockerode/CLI failures to `NotFoundError`/`ConflictError`/`TimeoutError` with operation context (service name, deployment id, request-id).
- `swarm` runner errors must include the resolved `serviceName` + `taskIds` for correlation (log lines → tasks).

## 10. Files affected (see `IMPLEMENTATION_TODO.md` P2/P3)

- `packages/contracts/entities/src/entities/swarm/` (NEW) — Zod schemas: `service.spec`, `service.inspect`, `node`, `task`, `secret`, `config`, `network`, `cluster-volume` (+ `index.ts`, `__tests__/`)
- `apps/api/src/core/modules/docker/services/docker.service.ts` — swarm method group: `swarmInit/Join/Leave/Inspect`, `createService/updateService/listServices/getService`, `listServiceTasks`, `nodeList/nodeInspect/nodeUpdate`, `createConfig/createSecret`, overlay `createNetwork`, cluster `createVolume` (all with typed params/results)
- `apps/api/src/modules/runners/swarm/swarm-spec.mapper.ts` (NEW) — `toDockerServiceSpec` / `fromDockerServiceInspect` pure mappers
- `apps/api/src/modules/runners/swarm/swarm-runtime-runner.service.ts` (NEW)
- `apps/api/src/modules/runners/swarm/swarm-compose-realizer.service.ts` (NEW) — typed compose-model → SDK calls (§6)
- `apps/api/src/modules/runners/swarm/swarm-service-inventory.repository.ts` (NEW)
- `apps/api/src/core/modules/traefik/services/traefik.service.ts` (verify-only mode for swarm services)
- `apps/api/src/modules/deployment/queue/deployment-queue-reconciliation.service.ts` (swarm checks via SDK)