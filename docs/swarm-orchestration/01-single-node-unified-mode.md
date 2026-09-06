# Swarm Orchestration — 01 · Single-Node Unified Mode

> **Status:** Design finalized, implementation pending
> **Relates:** `README.md` §6 (modes matrix), `02-master-election-algorithm.md` (size-1 election), `05-swarm-execution-backend.md`

---

## 1. Requirement

> "Swarm should also be used for single node where master and worker are on the same node that permits a **unique development of the API**."

Meaning:

1. A fleet of **one node** is a real Swarm cluster: `docker swarm init` on that node, which becomes the only manager **and** the only worker (Swarm default: managers schedule tasks).
2. The API must have **one code path** for every mode — single-node dev, single-node prod, multi-node prod. No `isSingleNode()` branches that hide swarm bugs until the fleet grows.

## 2. Why single-node Swarm is the right default

| Concern | Compose+supervisor today | Single-node Swarm |
|---|---|---|
| One API code path for all fleet sizes | ❌ dev/prod differ; multi-node logic untested locally | ✅ identical swarm + election + runner code |
| Rollout/health/restart correctness | Custom reconciliation | Native, exercised in every dev run |
| Traefik discovery mode | File/provider per-node config | Same swarm provider everywhere |
| Node role model | n/a | Manager==worker, `node.role=both` |
| Upgrade path | Compose upgrade only | `docker stack deploy` — same as multi-node |
| Cost | none | one daemon mode flag (`swarm init`), works on Docker Desktop |

## 3. Target: unified bootstrap

The first-boot flow (`setup` module + `mesh-orchestration-startup-model.md`) evolves to **always** converge to a Swarm membership state, even for one node:

```text
boot
 ├─ Phase 0  setup gate (auth, admin, DB, mesh identity)          [existing]
 ├─ Phase 1  swarm ensure (NEW: ClusterService) — dockerode SDK, no CLI
 │      └─ destination == "no cluster" (first node, nodeCount==1)
 │             └─ DockerService.swarmInit({ AdvertiseAddr: <overlay-ip> })
 │                    ├─ role: manager (Leader) + worker (both)
 │                    ├─ persist join tokens → swarm secrets volume
 │                    └─ persist cluster.master = self (term=1)
 │      └─ destination == "existing cluster"
 │             └─ DockerService.swarmJoin({ JoinToken, RemoteAddrs })
 │                    ├─ role decided by mesh election eligibility
 │                    └─ never downgrade below manager if quorum hot-standby
 ├─ Phase 2  platform services ensure (single-node: stack or supervisor)
 ├─ Phase 3  mesh join + peer sync                                       [existing]
 └─ Phase 4  deployment engine ready (swarm runner)                      [new]
```

Invariants:

- **Idempotent, SDK-only:** `ClusterService.ensureCluster()` reads `LocalNodeState` via dockerode (`DockerService.getSystemInfo()` → `Swarm.LocalNodeState`); `active` → no-op; `inactive` → `DockerService.swarmInit(...)`; `pending` → wait. No `exec`/`spawn` of the CLI anywhere.
- The one node is recorded in `cluster.nodes` with `role=both`, `isManager=true`, `isMaster=true`.
- Join tokens never live in `.env` — they are stored once by the master and distributed via the mesh secret-sharing path (same mechanism as `AUTH_SECRET`/`MESH_NODE_ID` today, see `docker/compose/deployer/docker-compose.deployer.yml`).
- dockerode ships TS types for the full Swarm API (`SwarmServiceSpec`, `SwarmNodeSpec`, `SwarmTask`, …); the platform wraps them behind the Zod contract layer (`entities/swarm/`) so business code never touches loose dockerode shapes directly (§2 of `05-swarm-execution-backend.md`).

## 4. Unique development path (dev parity)

`bun run dev` on a single host must exercise the swarm path:

- **Option A (recommended — API-driven)**: the API itself initializes swarm on the host (or in the dev container with a sibling socket) through `SwarmBootstrapService` (`SWARM_ENABLED`, idempotent), then deploys the platform stack (Traefik ingress via the swarm provider + overlay) through `PlatformStackService` (`SWARM_PLATFORM_STACK`) — zero CLI, zero `docker stack deploy`, one code path for dev and prod. `MESH_*` env still seeds from the mesh-6 pattern (`docker/compose/docker-compose.mesh-6.dev.yml`).
- **Option B: supervisor fallback** — keep `docker-compose.dev.yml` + `MANAGED_*_ENABLED` for pure frontend work where a daemon mode change is undesirable; the API still detects swarm and uses the swarm runner for user deployments.

Desired dev properties:

1. `docker info` shows Swarm `active` — parity with prod daemon state.
2. User deployments run via the **swarm runner** (not the direct-container runner) so `docker service` code paths are covered by every local test.
3. Election service runs with a candidate set of 1 (trivial) — no special-case code; the algorithm must already handle `N=1` (see `02-master-election-algorithm.md` §6).
4. Failover tests are **simulated** locally (kill the container → restart → re-election of the same node, term increments) — same code path as a real failover.

## 5. Single-node production

- `docker swarm init` + `docker stack deploy` of the platform stack (api, web, traefik) — or the unsupervised supervisor for the most constrained hosts.
- Health: swarm healthchecks + `update-config --order start-first` for zero-downtime restarts.
- State: shared PG (or local SQLite if truly standalone), persisted under swarm volumes.
- Ingress: Traefik swarm provider; the single node carries `deployer.ingress=true`.
- Master election with `N=1` is immediate and stable (no quorum loss possible).

## 6. What this enables later

- A second node joining is a pure **addition**: `swarm join --token manager`, mesh sync, election expands to 2 candidates, quorum settled to 3rd node or 2-node interim (see `02` §5 for even-count handling).
- No "single-node product" fork in the UI/API/deployment engine.

## 7. Files affected (see `IMPLEMENTATION_TODO.md` P1)

- `apps/api/src/core/modules/swarm/` (new): `swarm.module.ts`, `cluster.service.ts`, `cluster-state.entity.ts`, `cluster.repository.ts`
- `apps/api/src/config/env/` — swarm env group (`SWARM_ENABLED`, `SWARM_ADVERTISE_ADDR`, `SWARM_QUORUM_MIN`)
- `docker-stack.deploy.yml` (reference stack spec), `SWARM_ENABLED` / `SWARM_PLATFORM_STACK` env knobs; no `swarm:*` CLI scripts (API-driven).
- `apps/api/src/modules/setup/` — Phase 1 hook