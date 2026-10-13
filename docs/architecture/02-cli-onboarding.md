# 02 — CLI Onboarding

> **Status:** canonical
> **Answers:** what `deployer status` and `deployer start` do, and how a first-run
> install works **without a setup API server**.

## 2.1 Principle

> **The CLI is the only thing that must exist for a node to come up.**

No server is special-cased for onboarding. The CLI reads local state, decides,
and either boots the platform (already configured) or runs the configurator flow
(not configured). The configurator is **not** a platform service — a fresh node
has nothing to host it. The CLI either serves the UI itself on localhost or
opens the tunnel to the remote relay ([03](./03-configurator-protocol.md) §3.1).

## 2.2 `deployer status`

Reads the local `node_config` row and probes the local engine. **Never requires a
running server**, so it always answers.

```console
$ deployer status
Deployer 34.2.7 (protocol 4)
Node    a3f1c9e2-...  (this machine)

State   INACTIVE
        This node has never been configured.
        Run `deployer start` to begin.

Engine  docker 27.3.1   swarm: inactive
Data    /var/lib/deployer/local.db
```

When the platform is up:

```console
$ deployer status
Deployer 34.2.7 (protocol 4)
Node    a3f1c9e2-...  (this machine)

State   HEALTHY
        Platform converged 2 days ago (2026-10-07T09:14:02Z).

Services
  bff              healthy   http://deployer-bff:3005
  svc-identity     healthy
  svc-project      healthy
  svc-runtime      healthy
  svc-fleet        healthy

Ingress   public: https://app.example.com        (edge: cloudflare-tunnel)
          private: http://10.42.0.7:8080          (mesh)
Engine    docker 27.3.1   swarm: active (1 manager, 3 nodes)
```

`deployer status --json` emits the same data machine-readably.

### Status is derived, not announced

| Reported state | Derivation |
|---|---|
| `INACTIVE` | `setupState` ∈ {missing, `not_started`} |
| `PROVISIONING` | `setupState = setup_in_progress`, or services starting |
| `HEALTHY` | `setupState = setup_done` **and** every service healthcheck green |
| `DEGRADED` | `setupState = setup_done` **and** ≥1 service unhealthy |
| `STOPPED` | `setupState = setup_done` **and** no platform containers running |
| `FAILED` | `setupState` ∈ {`upgrade_failed`} or corrupt (empty `databaseUrl`) |

Because the state is *derived from facts* rather than *announced by a process*,
there is no phase machine that can get stuck, and `status` is correct even when
the platform is completely down.

## 2.3 `deployer start`

Two paths, selected by `setupState`.

```text
deployer start
      │
      ▼
┌─────────────────────────┐
│ setupState == done ?    │
└────┬────────────────┬───┘
    no               yes
     │                │
     ▼                ▼
 CONFIGURATOR     BOOT EXISTING
 FLOW (§2.4)      (swarm up, services up)
```

### Boot-existing path (the common case)

1. Converge the swarm (`SwarmBootstrapService` — found or rejoin).
2. Ensure platform services in dependency order: database → redis → traefik →
   domain services → BFF → web.
3. Wait for each service's healthcheck (swarm reports it).
4. Print the operator-facing URL, derived from configuration — **not** a loopback
   hostname. See [06](./06-networking-and-dns.md).
5. Exit `0`. The swarm keeps it up.

```console
$ deployer start
Deployer 34.2.7

→ Converging swarm ................ active (manager)
→ Database ....................... healthy
→ Redis .......................... healthy
→ Ingress (traefik) .............. healthy
→ Services
    svc-identity ................. healthy
    svc-project .................. healthy
    svc-runtime .................. healthy
    svc-fleet .................... healthy
→ BFF ............................ healthy
→ Web ............................ healthy

Deployer is running.

  Dashboard   https://app.example.com
  Status      deployer status
  Logs        deployer logs bff

Platform converged in 14.2s.
```

### First-run path

Same, but the CLI must obtain a configuration first (§2.4). The boot steps above
then run unchanged — **the boot path has no knowledge of whether configuration
came from a first run or from a restart.** That is the point.

## 2.4 First-run flow (no setup server)

```text
$ deployer start
Deployer 34.2.7

No configuration found on this node.

→ Determining configurator version ... 34-1 (protocol 4)
→ Configurator UI ...................  serving on http://127.0.0.1:3010
→ Opening a secure session ..........  ABC123

  Continue in your browser:

    https://v34-1.config.example.com/s/ABC123

  Or scan the code: █▀▀▀█ ▄▀ █▀▀▀█
                    █ ███ █▀█ ███ █
                    █▄▄▄█ ██▄ █▄▄▄█

  Waiting for configuration...       (Ctrl-C to cancel)
```

What happens underneath:

| Step | Actor | Detail |
|---|---|---|
| 1 | CLI | reads local version → resolves required configurator version + protocol version |
| 2 | CLI | resolves the configurator UI: serves it itself on localhost, or session-creates against the remote relay |
| 3 | CLI | `POST /session` → gets `sessionId` + browser URL + a CLI tunnel credential |
| 4 | CLI | opens an **outbound** WebSocket to the relay; authenticates with the tunnel credential. **No inbound port.** |
| 5 | operator | opens the URL; the **exact** configurator version loads from static storage |
| 6 | browser | connects to the shared relay, pairs with the session |
| 7 | operator | fills the form; the CLI validates live and returns field-level issues |
| 8 | operator | presses *Apply*; the CLI runs the implementation and streams progress |
| 9 | CLI | writes `node_config` (`setupState = setup_in_progress` → `setup_done`) |
| 10 | CLI | proceeds with **boot-existing** (§2.3) |

The protocol between browser, relay and CLI is specified in
[03](./03-configurator-protocol.md).

### Why the CLI validates, not the UI

The UI can only check shape ("is this a hostname?"). Whether a hostname is
deployable **on this node** depends on the node: existing DNS records, reachable
ports, the local engine, the cluster it belongs to. That knowledge lives in the
CLI, which is why the spec's authoring model has the UI render *issues the CLI
produced* rather than computing them.

## 2.5 `deployer stop`

Stops the platform **without** destroying configuration.

```console
$ deployer stop
→ Stopping web .................... done
→ Stopping bff .................... done
→ Stopping services ............... done
→ Leaving swarm ................... done (swarm was created by this node)

Platform stopped. Configuration preserved.
Run `deployer start` to resume.
```

`deployer stop --purge` additionally deletes the local database and the
configuration (a destructive action; it prompts).

## 2.6 Other commands (surface)

| Command | Purpose |
|---|---|
| `deployer status [--json]` | node + platform state (never needs a server) |
| `deployer start` | boot, or first-run onboarding |
| `deployer stop [--purge]` | stop (optionally destroy config) |
| `deployer logs <service> [-f]` | tail a service's logs |
| `deployer restart <service>` | restart one service |
| `deployer upgrade` | compare `deployerVersion` vs `node_config`, migrate |
| `deployer join <url>` | join an existing cluster (initiates the same configurator flow, remote strategy) |
| `deployer doctor` | diagnose a broken node (engine, DB reachability, ports, swarm) |

`deployer doctor` replaces the old "setup app serves a diagnostic page" idea: the
diagnostics are local, so they belong to the local tool.

## 2.7 What this removes from the codebase

| Deleted | Replaced by |
|---|---|
| `apps/setup/**` (whole app) | CLI commands + the configurator (CLI-served UI or the remote relay) |
| `SetupGateService`, `setupPhaseService`, `/setup/health` gate | node states (§2.2) |
| the `/setup/*` ORPC surface as a *pre-boot* API | configurator protocol (never a platform service) |
| compose `depends_on: setup-dev: service_healthy` | CLI ordering: `start` brings things up in order |
| `/setup/done` handover page | the CLI prints the dashboard URL |
