# 08 — Boot Sequences (worked examples)

> **Status:** canonical
> **Answers:** what actually happens, in order, with real output, for each way a
> node comes up.

Every sequence below is a **worked example**: real command, real output, and the
mechanism behind each line.

---

## 8.1 Fresh node, first ever `deployer start`

```console
$ deployer status
Deployer 34.2.7 (protocol 4)
Node    (unprovisioned)

State   INACTIVE
        This node has never been configured.

Engine  docker 27.3.1   swarm: inactive
Data    /var/lib/deployer/local.db   (absent)
```

```console
$ deployer start
No configuration found on this node.

→ Determining configurator version ... 34-1 (protocol 4)
→ Configurator UI ...................  http://127.0.0.1:3010 (served by the CLI)
→ Opening a secure session ..........  ABC123
→ Tunnel connected ..................  wss (outbound, no inbound port)

  Continue in your browser:

    https://v34-1.config.example.com/s/ABC123#pair=7H4K-92PD

  Waiting for configuration...       (Ctrl-C to cancel)
```

```text
  [operator opens the URL and fills the form]

  browser → relay : configuration.update   revision 1
  relay   → CLI   : configuration.update   revision 1
  CLI             : validating…
  CLI     → relay : configuration.validation revision 1  ✓ no issues
  browser → relay : implementation.start   revision 1
  CLI     → relay : implementation.started  revision 1  step "resolving cluster"
  CLI     → relay : implementation.progress revision 1  30% "creating swarm"
  CLI     → relay : implementation.log      revision 1  "docker swarm init --advertise-addr 10.42.0.7"
  CLI     → relay : implementation.progress revision 1  65% "provisioning database"
  CLI     → relay : implementation.progress revision 1  90% "running migrations"
  CLI     → relay : implementation.completed revision 1
```

```console
→ Configuration applied.

→ Converging swarm ................ active (manager)
→ Database .......................  healthy
→ Redis ..........................  healthy
→ Ingress (traefik) ..............  healthy
→ Services
    svc-identity .................  healthy
    svc-project ..................  healthy
    svc-runtime ..................  healthy
    svc-fleet ....................  healthy
    configurator .................  healthy
→ BFF ............................  healthy
→ Web ............................  healthy

Deployer is running.

  Dashboard   https://app.example.com

Platform converged in 41.6s.
```

**Mechanisms**

| Line | Mechanism |
|---|---|
| "Determining configurator version" | local CLI version → required UI + protocol version |
| "Tunnel connected" | an **outbound** WSS; the node accepts no inbound connection ([03](./03-configurator-protocol.md)) |
| "resolving cluster" | the CLI asked the operator "create or join"; it persists `node_config.swarmConfig` |
| "creating swarm" | `SwarmParticipationService.converge()` → `docker swarm init` ([07](./07-swarm-runtime.md)) |
| "provisioning database" | the BFF's bootstrap module runs migrations + admin (it owns the Drizzle schema) |
| "Services / BFF / Web" | the CLI creates swarm services from the shared spec builder |
| "converged in 41.6s" | time until every service healthcheck went green |

`node_config.setupState` goes `not_started` → `setup_in_progress` → `setup_done`.

---

## 8.2 Restart of an already-configured node

```console
$ deployer status
State   STOPPED
        Platform is not running. Configuration preserved (2026-10-07).

$ deployer start
→ Converging swarm ................ active (manager)
→ Database .......................  healthy
→ Redis ..........................  healthy
→ Ingress (traefik) ..............  healthy
→ Services
    svc-identity .................  healthy
    svc-project ..................  healthy
    svc-runtime ..................  healthy
    svc-fleet ....................  healthy
    configurator .................  healthy
→ BFF ............................  healthy
→ Web ............................  healthy

Deployer is running.  Dashboard https://app.example.com
Platform converged in 12.4s.
```

**The wizard is never shown.** `setupState = setup_done`, so `start` takes the
boot-existing path ([02](./02-cli-onboarding.md) §2.3). Faster (12.4s vs 41.6s)
because migrations and admin creation are already done — the difference is the
whole cost of a first run.

---

## 8.3 Joining an existing cluster (second node)

```console
$ deployer join https://app.example.com
Joining the cluster at app.example.com.

→ Gathering join details ..........  done
→ Starting configurator ...........  listening on :3010
→ Opening a secure session ........  XYZ789

  Continue in your browser:  https://v34-1.config.example.com/s/XYZ789#pair=...
  [operator confirms the join and the local node options]

→ docker swarm join --token ... 10.42.0.7:2377 ...  done
→ Mesh address ....................  10.42.0.9 (WireGuard up)
→ Node registered .................  visible to the manager
→ Services ........................  scheduled by the cluster

This node joined the cluster.  No local database was created
(strategy: remote — the cluster's database is used).
```

**Mechanisms:** `swarmConfig = remote`; the node's mesh address is what the swarm
advertises; `strategy: remote` means no local Postgres ([01](./01-lifecycle-and-ownership.md)
§1.3) — the cluster's database is reached over the mesh.

---

## 8.4 Compose-managed dev stack

```console
$ bun --bun run dev
```

Dev has **no CLI flow and no swarm**: compose owns the processes, and each app
publishes a port ([06](./06-networking-and-dns.md) §6.2).

```console
→ dependency-builder   building internal packages...
→ svc-identity         healthy  http://localhost:3006
→ svc-project          healthy  http://localhost:3007
→ svc-runtime          healthy  http://localhost:3008
→ svc-fleet            healthy  http://localhost:3009
→ bff                  healthy  http://localhost:3005
→ web                  healthy  http://localhost:3000

Open http://localhost:3000
```

If the local database is empty, the **web app** (not a setup server) routes to the
configurator, which in dev is served directly on `:3010` — no tunnel is needed,
because the browser and the CLI are on the same machine. Same protocol, different
transport.

---

## 8.5 Degraded platform

```console
$ deployer status
State   DEGRADED
        1 service unhealthy.

Services
  svc-identity  healthy
  svc-project   healthy
  svc-runtime   UNHEALTHY   exit 137 (OOM), restarting (attempt 3)
  svc-fleet     healthy
  bff           healthy
```

```console
$ deployer logs svc-runtime --tail 20
… Container killed: OOMKilled
… Restarting (3/10)…
```

`DEGRADED` is derived (`setup_done` + ≥1 unhealthy), never announced
([01](./01-lifecycle-and-ownership.md) §1.2). The swarm is already restarting it;
the operator only needs to know.

---

## 8.6 Broken node

```console
$ deployer doctor
Deployer 34.2.7

✓ Configuration present          setup_done since 2026-10-07
✓ Docker engine reachable        27.3.1
✗ Swarm state                    engine reports "inactive" but config says
                                 message: run `deployer start` to re-converge
✗ Database reachable             tcp://db:5432 connection refused
✗ BFF responding                 http://bff:3005/health timed out

Suggested actions
  1. deployer start            (re-converge swarm + services)
  2. if the database stays down, check the volume and the global-db logs
  3. if the engine is unreachable, restart the docker service
```

`doctor` is local, so it answers even when nothing is running — the property the
old "setup serves a diagnostic page" idea could not have, because that page
required the thing it was diagnosing.

---

## 8.7 Upgrade

```console
$ deployer status
State   HEALTHY
        Deployer 34.2.7.  Configuration was created by 34.1.2.

$ deployer upgrade
→ Checking migration path .........  34.1.2 → 34.2.7
→ Migrations required .............  3
→ Draining ........................  services stopped
→ Migrating .......................  ██████████  3/3
→ Restarting ......................  done

Upgraded to 34.2.7.
```

`node_config.deployerVersion` drives the gate
([01](./01-lifecycle-and-ownership.md) §1.3). A failed upgrade sets
`setupState = upgrade_failed`, which `status` reports as `FAILED`.

---

## 8.8 Stop

```console
$ deployer stop
→ Stopping web / bff / services ....  done
→ Stopping platform services .......  done
→ Leaving swarm ....................  done (this node created the cluster)

Platform stopped.  Configuration preserved.
```

A node that **joined** someone else's cluster does not leave it on stop (it is not
the owner). `deployer stop --purge` additionally deletes the local database and
configuration, and prompts first.

---

## 8.9 Sequence summary

```text
INACTIVE ──start──► [configurator flow] ──┐
                                          ├──► PROVISIONING ──► HEALTHY
STOPPED  ──start──────────────────────────┘                      │
                                                                 │
                                             service dies ───────┤──► DEGRADED
                                                                 │
                                             stop ───────────────┴──► STOPPED
```

Every arrow is one command or one engine event. There is no phase machine, no
gate, and no process whose only job is to announce that another process exists.
