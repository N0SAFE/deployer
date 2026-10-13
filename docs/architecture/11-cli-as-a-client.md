# 11 — CLI as a Client

> **Status:** canonical
> **Answers:** the full command surface, and how the CLI authenticates to the
> running platform to do more than boot it.

## 11.1 Two modes, one binary

`deployer` does two different kinds of work, and they must not be confused:

| Mode | Needs the platform running? | Talks to | Examples |
|---|---|---|---|
| **Local** | no | the local engine + `node_config` (SQLite) | `status`, `start`, `stop`, `doctor`, `join` |
| **Client** | yes | the platform's BFF (typed oRPC) | `configure`, `project *`, `logs`, `config *`, `users *` |

```text
deployer <command>
      │
      ├── local command ──▶ engine + node_config      (always answers)
      │
      └── client command ──▶ BFF ──▶ services          (needs the platform)
```

This split is deliberate: the commands that **must** work when the platform is
broken are local. Everything else is a thin, typed client over the same API the
web app uses — the CLI is not a second implementation of the platform.

## 11.2 Client authentication

The CLI is a normal API client, but it has no browser to hold a cookie. Today
`CliAuthService` already implements a three-step fallback
(`master-token` → `default-admin-credentials` → `temp-seed-user`). That machinery
is kept and simplified into a single credential the CLI acquires once:

```text
deployer login                    # prompts, or reads DEPLOYER_TOKEN
      │
      ▼
POST /auth/cli/token  { method }         (BFF)
      │
      ▼
{ token, expiresAt, actor: { userId, role } }
      │
      ▼
stored at ~/.config/deployer/credentials.json   (mode 0600)
```

| Property | Value |
|---|---|
| credential | a scoped token, **not** the admin password |
| scope | the CLI's actor role (usually `admin`) |
| lifetime | short, with refresh |
| storage | `0600`, never logged, never in a command line |
| revoke | `deployer logout`, and it expires on its own |

Every client command sends `Authorization: Bearer <token>`; the BFF resolves it to
an `Actor` exactly as it does for a browser session. **No service ever sees the
token** — only the forwarded actor claim ([04](./04-services-and-bff.md) §4.6).

## 11.3 Command reference

### Local (never need a server)

| Command | Does | Never |
|---|---|---|
| `deployer status [--json]` | derived node + platform state ([10](./10-developer-journeys.md) §10.7) | — |
| `deployer start` | boot, or run the configurator on a fresh node | — |
| `deployer stop [--purge]` | stop; `--purge` also deletes config (prompts) | — |
| `deployer join <url>` | join a cluster (configurator + swarm join) | — |
| `deployer upgrade` | migrate a node to a new CLI version | — |
| `deployer doctor` | diagnose engine / DB / ports / swarm locally | — |
| `deployer version` | CLI + protocol + configurator versions | — |

### Client (need the platform; go through the BFF)

| Command | Does |
|---|---|
| `deployer login` / `logout` | acquire / drop a CLI credential |
| `deployer configure` | **re-open the configurator** with the current config ([11.4](#114-updating-configuration)) |
| `deployer config get <key>` / `set <key> <value>` | read/write a configuration key |
| `deployer config export [--out file]` | dump the effective configuration (secrets redacted) |
| `deployer config diff` | show what differs from the platform's defaults |
| `deployer projects list` / `show <id>` / `logs <id>` | inspect projects |
| `deployer services list` / `redeploy <id>` | inspect + act on services |
| `deployer deployments list [--state running]` / `logs <id>` | inspect deployments |
| `deployer nodes list` | the fleet, with health and mesh addresses |
| `deployer users list` / `invite <email>` | identity operations |
| `deployer health` | the platform roll-up ([10](./10-developer-journeys.md) §10.7) |
| `deployer logs <service> [-f]` | stream a service's logs |
| `deployer restart <service>` | restart one service |
| `deployer events [-f]` | the platform event stream |

Every client command is `deployer <resource> <verb>` and maps to **existing**
contract procedures. The CLI adds no endpoint; if a capability is missing, it is
added to a contract and both the web app and the CLI get it.

## 11.4 Updating configuration

The CLI must not have a separate "edit config" path — that would be a second
implementation of validation and application. It reuses the configurator.

```console
$ deployer configure
→ Reading current configuration ....  setup_done (2026-10-07)
→ Opening a session ................  ABC123
→ Tunnel connected .................  outbound WSS

  Continue in your browser:

    https://v34-1.config.example.com/s/ABC123#pair=...

  [the SAME UI as first-run, pre-filled with the current configuration]
  [changes go through the SAME revisions + implementation pipeline]
```

```console
$ deployer configure --set domain=apps.example.com --yes
→ Diff
    domain   app.example.com → apps.example.com
→ Applying (revision 4)
  ✓ validating
  ✓ updating ingress route
  ✓ re-issuing certificate
  ✓ verifying
→ Done.  https://apps.example.com
```

`--set` is a convenience that builds a revision and applies it; it runs the
**same** validation and the **same** implementation as the UI. If a change needs
interaction (a choice, a warning), the CLI opens the browser rather than guessing.

Non-interactive environments get `--yes --set …` and a non-zero exit on any
validation issue — which makes the CLI usable from a provisioning script.

## 11.5 Checking things from the platform

`deployer doctor` is local; `deployer health` is the platform's view. Both are
needed, and they answer different questions.

```console
$ deployer doctor            # LOCAL: is this machine able to run Deployer?
✓ Docker engine reachable         27.3.1
✓ Ports 80/443 available
✓ Data directory writable         /var/lib/deployer
✗ Swarm state                     inactive, but configuration says active
                                  → run `deployer start` to re-converge
✓ Database reachable              tcp://db:5432
```

```console
$ deployer health            # PLATFORM: is the running platform fine?
Platform  DEGRADED
  svc-identity  healthy
  svc-runtime   UNHEALTHY   exit 137 (OOM), restarting (attempt 3)
  bff           healthy
Ingress   public https://app.example.com  private http://10.42.0.7:8080
Engine    swarm active (1 manager, 3 nodes)
```

```console
$ deployer health --json | jq '.services[] | select(.healthy == false)'
{ "name": "svc-runtime", "healthy": false, "reason": "exit 137 (OOM)", "attempt": 3 }
```

Scripting is a first-class use: every command that reports takes `--json`, and
`--quiet` suppresses everything but the exit code. That is what makes
`deployer doctor` usable in a provisioning or monitoring script.

## 11.6 Exit codes

Machine-readable outcomes, so scripts can branch without parsing:

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | generic failure |
| `2` | invalid usage |
| `3` | configuration required (`INACTIVE`; run `start`) |
| `4` | platform unhealthy (`DEGRADED` / `FAILED`) |
| `5` | engine unavailable (no Docker / no swarm) |
| `6` | authentication required or expired (`login`) |

## 11.7 What the CLI deliberately does NOT do

| Not a CLI job | Because |
|---|---|
| business logic | it calls the same contracts the web does |
| its own config validation | the configurator + CLI share one validator, and the CLI owns "is this deployable **here**" |
| a second API surface | added capabilities go into a **contract**, benefiting web and CLI |
| supervision | the swarm owns restart/reschedule ([07](./07-swarm-runtime.md) §7.6) |
| serving anything to a browser | the configurator does that ([03](./03-configurator-protocol.md)) |

## 11.8 Where each command lives in code

```text
apps/api/cli/                 @deployer/api-cli   (bin: `deployer`)
  src/
    main.ts                   commander wiring; exit-code mapping
    commands/
      local/                  status, start, stop, join, upgrade, doctor, version
      client/                 configure, config, projects, services, deployments,
                              nodes, users, health, logs, restart, events, login
    client/
      token-store.ts          ~/.config/deployer/credentials.json (0600)
      platform-client.ts      typed oRPC client over the BFF
    services/
      engine/                 dockerode: engine + swarm facts
      node-config/            reads/writes node_config (SQLite)
      configurator/           session + tunnel for `start` / `configure`
```

The rule: **`commands/local`** may import the engine and SQLite directly;
**`commands/client`** may only import `client/platform-client.ts`. A client
command that reaches for the database is a bug — it would work on the node and
fail everywhere the CLI is used as a remote tool.
