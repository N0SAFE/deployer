# 07 — Swarm Runtime

> **Status:** canonical
> **Answers:** how a cluster is founded and joined, how platform services are
> placed and rescheduled, and how "is it healthy?" is answered.

## 7.1 The one rule

> **The operator decides whether a cluster exists. The platform never invents
> one.**

`docker swarm init` cannot be undone without destroying the node's Raft state, and
a node that is about to *join* a fleet must never first create a cluster of its
own. So the engine is untouched until configuration records the decision, and
everything downstream converges *from that persisted decision*.

Historically that decision was written by the setup wizard. It is now written by
the **CLI** during the first-run flow ([02](./02-cli-onboarding.md)), or by the
**cluster UI** when an operator changes participation — same column, same
convergence.

## 7.2 `swarmConfig` — the persisted decision

`node_config.swarmConfig` is written **always**, by the flow that collects it:

| Value | Meaning | CLI path |
|---|---|---|
| `local` | this node **creates** the cluster (becomes its first manager) | `deployer start` on a fresh node, answering "create a new cluster" |
| `remote` | this node **joins** an existing cluster | `deployer join <url>`, or answering "join an existing cluster" |

`SwarmParticipationService.converge()` is **idempotent** and re-reads the
persisted config, so it is safe to call at boot *and* again after an operator
changes the value in the UI. Calls to `docker swarm init`/`join` are guarded so a
converged node is a no-op.

```ts
// packages/nest/swarm/src/services/swarm-bootstrap.service.ts
async onModuleInit(): Promise<void> {
  if (!this.convergeOnBoot) return;   // CLI-driven flows converge explicitly
  await this.participation.converge();
}
```

`convergeOnBoot` is injected per app: the BFF converges on boot (so its
supervisors have a cluster to schedule onto); a CLI-driven first run converges at
the moment the operator's choice is persisted.

## 7.3 What runs on the swarm

Two categories, distinguished by **who owns the process**.

| Category | Examples | Owner |
|---|---|---|
| **Platform infra** | global Postgres, Redis, Traefik, the edge connector, the mesh agent | the platform (supervisors) |
| **Deployer's own apps** | `bff`, `web`, `svc-*` | the CLI's `start` |
| **User workloads** | the operator's deployed containers | the runners backend |

All three are swarm services, so all three get the same properties for free:
restart policy, rescheduling onto a healthy node, and a healthcheck the engine
reports.

## 7.4 Scope → placement

A supervisor declares a `scope`, and `resolveSupervisorRuntime` maps it to a swarm
mode. The mapping is the whole placement policy:

| Scope | Runtime | Examples |
|---|---|---|
| `node-local` | `swarm-global` (one task per node) | Traefik ingress, the mesh agent |
| `mesh-wide` | `swarm-replicated` (one shared service) | global Postgres, Redis, database-service instances, managed web, edge connector |
| **`app`** (new) | `swarm-replicated` | `bff`, `web`, `svc-*`, `configurator` |
| — | `managed` | `MANAGED_*_ENABLED=true` → the operator/compose owns it; wire only, never spawn |
| — | `unavailable` | not an active swarm member → **degrade, never fall back to a container** |

**Never fall back to a plain container.** That fallback is what produced the
"some DI works, some silently injects undefined" class of bug and left orphan
containers behind. If the swarm is unavailable, the correct answer is a reported
`unavailable`, not a second, unmanaged copy of the process.

### Why the CLI starts services instead of compose

In dev, compose starts them (so a developer gets one command). In prod, the
**CLI's `start`** creates the swarm services, because:

- the operator's first action is `deployer start`, and it must produce a running
  platform;
- the CLI already knows the configuration (it wrote it);
- it removes the old "compose starts setup, setup opens a gate, compose then
  starts the API" chain, which was the source of the design's circular gate.

The service **specs are the same** in both cases — one builder, two callers, so
they cannot drift into two different platforms.

## 7.5 Service specs (what a service needs)

Beyond the obvious fields, three things matter and getting them wrong breaks
node-local services:

| Field | Why |
|---|---|
| **network `aliases`** | consumers resolve by stable alias (`bff`, `global-db`, `redis`, `traefik`), which a prefixed deployment's service name does not match |
| **`publishMode: host`** | a *global* service cannot publish through the routing mesh, and per-node bind conflicts must stay visible rather than be load-balanced away |
| **`capabilitiesAdd`** | WireGuard needs `NET_ADMIN` |

Platform services are addressed **by alias**, which is what makes
[06](./06-networking-and-dns.md)'s internal-DNS rule work: `http://bff:3005`
resolves because the service declares `bff` as an alias.

## 7.6 Supervision — who answers "is it healthy?"

There are three answers, and they must not be confused:

| Question | Answered by | Mechanism |
|---|---|---|
| Is this container alive? | **swarm** | the service's `healthcheck`; the engine restarts a failing task |
| Is the platform usable? | **BFF** | health roll-up over the services' own endpoints, exposed for `deployer status` |
| May traffic be routed here? | **Traefik** | the ingress config the BFF serves; a node without it keeps the last config it fetched |

**No supervisor app.** An earlier draft added one. It was rejected: a process
whose job is to report whether the platform is up has a failure mode
indistinguishable from the failure it reports, and the swarm already owns
restart and rescheduling. The BFF only **aggregates** for humans; it never
restarts anything.

### Deferral is not failure

A supervisor with a precondition that does not yet exist (a swarm-only service
before the cluster exists) reports **`pending`**, not `degraded`. That distinction
is kept: it is what stops a normal, in-progress boot from looking broken.

## 7.7 Mesh (node-to-node) — unchanged

The mesh is orthogonal to the app split and is not redefined here:

- the mesh agent is a **plain host-network container** (not a supervised service);
  it must exist before the swarm binds its mesh address, and it runs its own
  "doors";
- `SwarmBootstrapService` converges the engine at boot, so the swarm runtime is
  always available to supervisors;
- cluster-wide state goes through `ClusterSettingsService` (replicated by the
  mesh), never a node-local store.

See `docs/edge-mesh-architecture.md` and `docs/mesh/*` for the full model.

## 7.8 Failure behaviour

| Failure | Behaviour |
|---|---|
| a service task dies | swarm restarts it; `deployer status` shows `DEGRADED` during the gap |
| a node dies | swarm reschedules its `swarm-replicated` tasks onto a healthy node; nothing reconfigures |
| the whole cluster goes down | `deployer status` reports `STOPPED` (config preserved); `deployer start` re-converges |
| swarm is unavailable | supervisors report `unavailable` (never spawn a container copy); the CLI's `doctor` reports the engine state |
| an operator changes participation | the cluster UI writes `swarmConfig`; `converge()` re-runs; no restart needed |
| a rescheduled BFF changes node | Traefik re-resolves `bff` by DNS — **no route change** |
