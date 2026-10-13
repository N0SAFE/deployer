# 01 — Lifecycle & Ownership

> **Status:** canonical
> **Answers:** what states a node can be in, who transitions them, and what each
> actor is allowed to own.

## 1.1 The actors

There are exactly **four** actors in the new architecture. Every behaviour below
is assigned to one of them, and no behaviour is assigned to two.

| Actor | IS | OWNS | NEVER does |
|---|---|---|---|
| **CLI** (`deployer`) | the operator's entrypoint binary | status reporting, first-run onboarding, `start`/`stop`, cluster init/join decisions, the configurator UI (served locally) or its tunnel client, **sole writer of `node_config`**, invoking migrate/seed jobs | business logic, serving the product to browsers |
| **Configurator relay** (+ the versioned static UI) | **remote infrastructure** | configurator sessions, the pass-through tunnel, protocol version negotiation, serving the browser UI | understanding what the configuration *means*; being a platform service |
| **BFF** | the public HTTP edge | auth/session, SSR, front-facing aggregation, authorising, contract composition | domain rules, owning a business entity |
| **Domain services** | N processes | entities, their tables, CRUD, domain invariants, cross-entity rules | serving browsers, parsing cookies, knowing about "screens" |
| **Swarm** | the container engine | restart, rescheduling, task health | application semantics |

**Node supervision is owned by the swarm** (`SwarmBootstrapService` converges the
engine at boot; services are swarm services with restart policies). There is no
supervisor app.

**The configurator is not a platform service.** It cannot be: on a fresh node
there is no swarm and no platform, so nothing could host it. It is either remote
infrastructure (the tunnel case) or served directly by the CLI on localhost (the
local-browser case) — same protocol, two transports
([03](./03-configurator-protocol.md) §3.1).

## 1.2 Node states

A node is in exactly one state. The states are derived from **two independent
facts**: whether the local `node_config` row says setup is done, and whether the
platform process group is running.

```text
                    node_config.setupState        platform running?
                    ─────────────────────         ────────────────
  INACTIVE          not_started / missing         no
  PROVISIONING      setup_in_progress             yes (partially)
  HEALTHY           setup_done                    yes (all green)
  DEGRADED          setup_done                    yes (some unhealthy)
  STOPPED           setup_done                    no
  FAILED            upgrade_failed / corrupt      no
```

`deployer status` reports exactly this. See [02](./02-cli-onboarding.md).

### Why `INACTIVE` ≠ `STOPPED`

They have different *remedies*:

- `INACTIVE` → `deployer start` runs the **configurator flow** (no configuration
  exists yet; there is nothing to boot).
- `STOPPED` → `deployer start` boots the **existing** configuration (the wizard is
  never shown; the choices are already in `node_config`).

Conflating them is what produced the old design's "the API must know whether it is
pre-setup" problem. Making them distinct states removes the need for a pre-setup
mode entirely.

## 1.3 The single source of truth

One row in the node's **local SQLite** database (`node_config`) remains the
authority for setup state. The CLI reads it directly (it is a local file), which
is why the CLI can answer `deployer status` **without any server running**.

| Column | Meaning |
|---|---|
| `nodeId` | random UUID, generated on first provisioning |
| `strategy` | `local` (this node owns/points at a database) vs `remote` (joined a mesh) |
| `setupState` | `not_started` \| `setup_in_progress` \| `setup_done` \| `upgrade_*` |
| `databaseUrl` | mandatory; `setup_done` + empty URL is treated as corrupt |
| `databaseProvisioning` | `local` (we run it) vs `external` (operator-supplied) |
| `configuredAt` | when setup completed |
| `deployerVersion` | version at setup time (drives upgrade gating) |

**Invariant:** there is no "no-database" boot. A `setup_done` row with an empty
`databaseUrl` is always reset to `not_started`.

## 1.4 Ownership table (who does what, exhaustively)

| Step | Owner | Notes |
|---|---|---|
| Read `node_config`, report status | **CLI** | local file read; no server needed |
| Open the configurator session + tunnel | **CLI** | outbound only |
| Serve the browser UI | **Configurator service** | versioned static UI |
| Validate configuration *shape* | **Configurator service** | protocol-level, not domain |
| Validate configuration *meaning* | **CLI** | the CLI is the source of truth for "is this deployable here" |
| Apply configuration (write `node_config`) | **CLI** | local write |
| Found / join the swarm | **CLI** | triggers; `SwarmBootstrapService` converges |
| Provision the database | **BFF** (bootstrap module) | needs Drizzle schema + migrations |
| Run migrations, seed, create admin | **BFF** (bootstrap module) | same reason |
| Start the services | **swarm** (via the CLI's `start`) | service specs, restart policy |
| Place / reschedule service tasks | **swarm** | `scope` + `resolveSupervisorRuntime` |
| Health of each service | **swarm** (healthcheck) + **BFF** (roll-up) | BFF aggregates for the operator |
| Ingress routes (Traefik) | **BFF** | `TraefikIngressConfigService` serves the dynamic config |
| Auth / sessions | **BFF** | the only process that parses cookies |
| Front-facing aggregation | **BFF** | see [04](./04-services-and-bff.md) |
| Domain rules, tables, CRUD | **services** | see [05](./05-service-anatomy.md) |

## 1.5 Deleted from the old design

| Removed | Why |
|---|---|
| `apps/setup` (the whole app) | its job is split between the CLI (onboarding) and the swarm (supervision) |
| `SetupGateService` / `/setup/health` gate | the thing the gate protected against — "the API can start before setup" — no longer exists; the CLI starts the API *after* configuration |
| `SetupExitService` | nothing exits |
| `SetupPhaseService` (`awaiting`…`handover`…`ready`) | replaced by node states (§1.2), which are derived rather than announced |
| the orchestrator app | rejected: a component whose failure looks like the failure it reports |
| `api|web|setup.deployer.localhost` | see [06](./06-networking-and-dns.md) |

## 1.6 Grading the previous design (why this is better)

| Property | Old (setup app + orchestrator) | New (CLI + services + BFF) |
|---|---|---|
| Ways a fresh node can fail before it has a DB | compose ordering, gate, phase machine, orchestrator pipeline | one: the CLI flow did not finish |
| Components that must exist before the platform exists | setup app, its DB config, its wizard, a gate | the CLI (already exists) + the configurator (CLI-served or remote) |
| Owners of "is it healthy?" | setup app **and** swarm **and** API readiness | swarm (truth) + BFF (roll-up for humans) |
| Pre-setup special case in the API | yes (`/setup/*` executor, placeholder DB pool) | none — the API never runs pre-setup |
| Local DNS | a loopback hostname per app | none |
