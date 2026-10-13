# 10 — Developer Journeys

> **Status:** canonical
> **Answers:** what a developer actually does, day to day, in each dev profile —
> with real commands and real expectations.

Three dev profiles exist. They differ in **who owns the platform processes**,
which is the only thing that matters for the developer's mental model.

| Profile | Command | Who owns platform services | Use when |
|---|---|---|---|
| **plain dev** | `bun --bun run dev` | **compose** | every day; fastest loop |
| **dev-supervised** | `docker build -f infra/docker/compose/docker-compose.dev-supervised.yml` | **the platform** (swarm) | exercising the production flow locally |
| **local** | `bun --bun run dev:local` | **turbo, on your machine** | debugging a service in a real debugger |

---

## 10.1 Journey A — plain dev (`bun --bun run dev`)

**The everyday loop.** Compose owns everything; every app publishes a host port;
no swarm, no CLI flow, no tunnel ([06](./06-networking-and-dns.md) §6.2).

### First time on the branch

```console
$ bun install
$ bun --bun run dev
```

```console
→ dependency-builder     building internal packages ...
→ redis                  healthy
→ traefik                healthy
→ global-db              healthy
→ setup-runner           migrations applied, admin ensured
→ svc-identity           healthy   http://localhost:3006
→ svc-project            healthy   http://localhost:3007
→ svc-runtime            healthy   http://localhost:3008
→ svc-fleet              healthy   http://localhost:3009
→ bff                    healthy   http://localhost:3005
→ web                    healthy   http://localhost:3000

Open http://localhost:3000
```

If the database has no schema yet, the **web app** routes you to the
configurator, which in dev is served by the CLI on `http://127.0.0.1:3010` — no
tunnel is needed, because the browser and the CLI are on the same machine. Same
protocol, different transport ([03](./03-configurator-protocol.md) §3.1).

### The loop

```text
edit a file
   ↓
compose --watch rebuilds THAT app only
   ↓
hot reload (nestjs watch for the api apps, next dev for web)
   ↓
refresh / re-run the request
```

Per-app scripts when you want to narrow it:

```console
$ bun --bun run dev:api        # only the bff (+ its deps)
$ bun --bun run dev:web        # only web
$ bun --bun run dev:api:logs   # tail
$ bun --bun run dev:api:run    # shell inside the container
```

### Adding a service

1. Add the row to `service-catalog.ts` (name + port offset).
2. Scaffold `apps/api/services/<name>/` ([05](./05-service-anatomy.md)).
3. Compose picks it up from the catalog-generated entry.

Nothing else: the BFF finds it by name, ports come from the offset.

### Failure modes a developer actually hits

| Symptom | Cause | Fix |
|---|---|---|
| `bff` cannot reach `svc-project` | the service crashed on boot | `bun --bun run dev:api:logs`; usually a DI error |
| web shows the configurator on every load | `node_config.setupState` is not `setup_done` | run the form once, or seed the row |
| two apps load twice / provider unresolvable | a module imported as both `@/core/x` and `./x` | use the alias form only ([apps/api/ARCHITECTURE.md](../../apps/api/ARCHITECTURE.md)) |
| changes never appear | the watcher did not rebuild that app | `bun --bun run dev:api:build` |

### Reset

```console
$ bun --bun run dev:down              # stop
$ bun --bun run dev:down:volumes      # stop + delete the database (fresh install)
```

---

## 10.2 Journey B — dev-supervised (production flow, local images)

**What it is:** compose's only jobs are (1) **build the images** and (2) **run
the CLI's start flow**. Compose manages *no* platform services — no global-db, no
redis, no traefik, no api container. Once the flow runs, **the platform supervises
itself**, exactly as in production. The only difference from prod is `APP_DEPS_MODE`
and the image tags.

```console
$ docker compose -f infra/docker/compose/docker-compose.dev-supervised.yml up --build
```

```console
→ build-api          image built  deployer-api:dev
→ build-web          image built  deployer-web:dev
→ build-mesh-agent   image built  deployer-mesh-agent:dev
→ build-doc          image built  deployer-doc:dev

→ platform           running the production start flow (SETUP_MODE=prod)

  → swarm            founded on this machine
  → node registered
  → global-db        scheduled   (swarm service)
  → redis            scheduled
  → traefik          scheduled
  → migrations       applied
  → svc-* / bff      scheduled   (swarm services)
  → web              scheduled

  Platform is up.

  Reach it on        http://localhost:8080            (the entry port)
  Status             deployer status
```

### What the developer learns here

- **boot ordering** — the swarm converges, then services are scheduled in
  dependency order; a wrong order shows up here as a failed task, not a silent
  hang;
- **task rescheduling** — kill a task, watch the swarm move it and Traefik
  re-resolve by service name with no config change ([07](./07-swarm-runtime.md));
- **healthchecks** — a service with a bad healthcheck is replaced, which is
  visible here and invisible in plain dev;
- **the real ingress** — routes are served by the BFF over HTTP
  ([06](./06-networking-and-dns.md) §6.4), so a route bug reproduces locally.

### Rebuilding one app

```console
$ docker compose -f infra/docker/compose/docker-compose.dev-supervised.yml build build-api
$ docker service update --force deployer-api
```

### When to use it

- before opening a PR that touches boot order, supervisors, swarm specs, or ingress;
- when reproducing a bug that only appears under the swarm;
- when validating a migration against a real scheduled environment.

**Not** for the inner loop — it is slower by design.

---

## 10.3 Journey C — local (`bun --bun run dev:local`)

Plain turbo, on the host, no containers. Used when you need a **real debugger**.

```console
$ bun --bun run dev:local          # = turbo run dev
```

```console
$ # in VS Code: attach to the bff, set a breakpoint in a service method
$ bun --bun run dev --filter=api-bff
```

Trade-off: the fastest restarts and a real debugger, but you must run the backing
services yourself (`docker compose up redis global-db traefik`), and the ports are
the same offsets, so a running plain-dev stack will collide.

---

## 10.4 Which profile do I want?

```text
I want the fastest edit→see loop ................ plain dev
I need a debugger ............................... local
I am touching boot/supervisors/ingress .......... dev-supervised
I am reproducing a prod-only bug ................ dev-supervised
```

---

## 10.5 Journey D — the operator, first time on a production node

No compose. The node has Docker and the CLI. This is
[02](./02-cli-onboarding.md) §2.4 from the operator's seat, with what each side
sees.

### Step 1 — look before you leap

```console
$ deployer status
Deployer 34.2.7 (protocol 4)
Node    (unprovisioned)

State   INACTIVE
        This node has never been configured.
        Run `deployer start` to begin.

Engine  docker 27.3.1   swarm: inactive
Data    /var/lib/deployer/local.db   (absent)
```

Nothing is running. **`status` answered anyway** — it reads a local file.

### Step 2 — start

```console
$ deployer start
No configuration found on this node.

→ Determining configurator version ... 34-1 (protocol 4)
→ Configurator UI ...................  http://127.0.0.1:3010 (served by the CLI)
→ Opening a secure session ..........  ABC123
→ Tunnel connected ..................  outbound WSS (no inbound port)

  Continue in your browser:

    https://v34-1.config.example.com/s/ABC123#pair=7H4K-92PD

  Waiting for configuration...
```

### Step 3 — in the browser

```text
Configuration                                    Protocol 4 · CLI 34.2.7

Domain            [ app.example.com                      ]
Admin email       [ ops@example.com                      ]
Admin password    [ ••••••••••••                         ]
Database          ( ) Provision one for me   ( ) I have one
Cluster           (•) Create a new cluster   ( ) Join an existing one
Edge              [ cloudflare-tunnel ▾                  ]

✓ Configuration accepted

[ Apply ]
```

The CLI validates as you type — issues appear **because the CLI produced them**,
not because the form guessed ([03](./03-configurator-protocol.md) §3.6).

### Step 4 — apply, with live implementation feedback

```text
Implementation                       (revision 1)
✓ Resolving cluster
✓ Creating swarm
✓ Provisioning database
✓ Running migrations
◌ Creating admin
◌ Starting services
◌ Publishing ingress

CLI output
09:32 docker swarm init --advertise-addr 10.42.0.7
09:32 database container scheduled
09:33 migrations 3/3 applied
09:33 waiting for health check...
```

Both panes come from the CLI. The browser is a view over the node, not a second
source of truth.

### Step 5 — the CLI takes over

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

The configurator session is destroyed; the configurator **service** stays (it is
part of the platform, and it is what a future `deployer configure` or a
node-joining flow will use).

### Step 6 — reality check

```console
$ deployer status
State   HEALTHY
        Platform converged 41.6s ago.

Services      (as listed above)
Ingress   public https://app.example.com  (cloudflare-tunnel)
          private http://10.42.0.7:8080   (mesh)
Engine    docker 27.3.1   swarm: active (1 manager)
```

---

## 10.6 Journey E — the operator, every day after

```console
$ deployer status                # the one command that answers "is it fine?"
```

Six states, one command ([01](./01-lifecycle-and-ownership.md) §1.2):

```text
$ deployer status
State   STOPPED      → `deployer start` resumes; configuration preserved
State   HEALTHY      → nothing to do
State   DEGRADED     → one service unhealthy; swarm is already restarting it
State   PROVISIONING → a start is in progress
State   FAILED       → an upgrade or provisioning failed; run `deployer doctor`
State   INACTIVE     → never configured; `deployer start` runs the configurator
```

Common operator actions:

```console
$ deployer logs svc-runtime --follow     # watch one service
$ deployer restart svc-runtime           # restart one service
$ deployer configure                     # open the configurator AGAIN (change config)
$ deployer join https://app.example.com  # add this node to a cluster
$ deployer upgrade                       # apply a new CLI version
$ deployer doctor                        # diagnose a broken node
```

**`deployer configure` reuses the exact same flow as first-run** — same protocol,
same validation, same live implementation feedback ([03](./03-configurator-protocol.md)).
The only difference is that the session starts from an existing configuration
instead of an empty one. That is the payoff of not special-casing onboarding.

---

## 10.7 Status: how it is shown, and why it can always be shown

```text
deployer status
      │
      ├── read local node_config (SQLite)          ← no server needed
      ├── probe local engine (docker info)         ← no server needed
      └── if the platform is running:
            ask the BFF  GET /health/platform      ← composition, not a passthrough
```

```jsonc
// GET /health/platform  (BFF; composes the services' own endpoints)
{
  "state": "degraded",
  "convergedAt": "2026-10-09T14:02:11Z",
  "services": [
    { "name": "svc-identity",  "healthy": true,  "url": "http://svc-identity:3006" },
    { "name": "svc-runtime",   "healthy": false, "reason": "exit 137 (OOM), restarting", "attempt": 3 },
    { "name": "bff",           "healthy": true,  "url": "http://bff:3005" }
  ],
  "ingress": {
    "public":  { "url": "https://app.example.com", "edge": "cloudflare-tunnel" },
    "private": { "url": "http://10.42.0.7:8080" }
  },
  "engine": { "docker": "27.3.1", "swarm": "active", "managers": 1, "nodes": 1 }
}
```

**The roll-up is a BFF composition, not a forward.** The BFF asks each service for
its health, joins in the engine/ingress facts from `svc-fleet`, and returns the
one object above. This is the BFF doing its job ([04](./04-services-and-bff.md)
§4.2) rather than proxying.

Crucially: the CLI **also answers when the BFF does not** — the first question
("is this node configured?") is a local file read. So `status` is useful in
exactly the situation you need it most: a node that will not come up.
