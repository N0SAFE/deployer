# Edge / Ingress architecture — review and implementation

## What was wrong

Two independent faults made the edge unusable beyond a single node.

### 1. N entry points for one stack

```yaml
# traefik-supervisor.service.ts
mode: "global"                      # one task per node
endpointPorts:
  - publishMode: "host"             # published on the task's node only
```

`global` **forces** `host` (a global service cannot publish through the routing
mesh), and `host` means one `:80` per node. On a 3-node cluster that is three
addresses, and nothing aggregates them.

Worse, the config volume is a plain node-local volume
(`createVolume({ Name })`, `local` driver). Each node's Traefik mounts its own,
and the API writes only into its own — so on a multi-node cluster the ingress on
nodes 2+ serves an **empty config directory**.

### 2. Workloads were unreachable

```
Traefik      → deployer-platform-overlay
workloads    → deployer-<projectId>          (and literally "bridge")
```

Nothing joined the two, so a route target like
`http://<containerName>:<port>` resolved nowhere Traefik could see. The route
existed, the service ran, every request 502'd. A swarm task also cannot join the
node-local `bridge` network at all.

## What was implemented

### Per-node connector, one tunnel (the scaling model)

```
Internet → Cloudflare (*.base-domain)
              ↓  ONE tunnel
         cloudflared × N replicas    ← REPLICATED swarm service
              ↓  http://deployer-traefik:80
           Traefik                    ← the ONE stable target
              ↓
        apps (no Cloudflare change per app)
```

Cloudflare allows up to **25 connectors on one tunnel** and balances across
them, so availability comes from replicas — not from extra tunnels. The
Cloudflare side stays fixed as the fleet grows: adding a node adds a connector,
never a tunnel.

`replicated` (not `global`) is deliberate. Traefik is `global` because each node
must route for its own tasks and its port is node-local. The connector has **no
ports** — it dials out — so "one per node" buys nothing and multiplies the
connections Cloudflare tracks. `maxReplicasPerNode = 1` keeps two from landing
on the same node and being lost together.

### The wildcard rule

```
ingress:
  - hostname: "*.base-domain"
    service: http://deployer-traefik:80
  - service: http_status:404
```

One rule covers every app and preview. Onboarding a deployment never touches
Cloudflare, because Traefik decides which service a `Host` header belongs to.

### Pluggable edge

Traefik is the Swarm edge in every mode; only the hop in front changes.

| Mode | Path | Requires |
|---|---|---|
| `tunnel` | cloudflared → Traefik | tunnel provider + token |
| `direct` | DNS → node IP → Traefik :80/:443 | public IP, inbound ports |

`direct` is the default: a fresh install works with DNS alone, and the operator
opts into a tunnel.

#### The edge is a property of the STACK, not a node

Both the mode and the tunnel are stack-scoped, and there is exactly one tunnel.

The tunnel used to live on `node_network_config`, which made it a property of a
NODE: a 3-node platform created three Cloudflare tunnels, each needing its own
hostname rule, with three connectors competing to answer for the same hostname.
Its columns are gone (migration `0036`), replaced by five keys in the local
`platform_settings` table (`edge.mode`, `edge.tunnel_token`, `edge.tunnel_id`,
`edge.tunnel_provider_id`, `edge.tunnel_wildcard`) — local because the connector
supervisor must answer "is an edge configured?" during boot, before Postgres.

The API provisions the tunnel and stores its token; the supervisor only reads it.
That split matters: `CloudflareTunnelService` needs the provider credentials in
`dns_providers` (global DB), which are not available on the boot path.

`node_network_config` keeps `public_address`, and that is not vestigial — in
`direct` mode DNS resolves each app hostname to THAT node's address.

#### The entry port follows the edge mode, not NODE_ENV

| `DEPLOYER_EDGE_MODE` | Entry port | Why |
|---|---|---|
| `direct` | published (`host` mode, 80/443) | DNS points at the node IP; nothing is bound, nothing is reachable |
| `tunnel` | **none** | the connector dials out; an inbound port is pure attack surface |

This used to key off `NODE_ENV`: production ran headless "behind the operator's
proxy". That silently made `direct` impossible in production — the caller was
supposed to point DNS at a port the stack refused to bind. The decision now
belongs to the mode the operator actually chose, and `direct` + `production` is
covered by a regression test.

### TLS that actually works

Enabling TLS used to add the `:443` entrypoint and stop — every HTTPS request was
answered with Traefik's **self-signed** certificate. Now a real ACME resolver is
declared in the ingress args, with `acme.json` on a persistent volume (a missing
file re-orders on every restart, which Let's Encrypt rate-limits).

## Files

| Concern | File |
|---|---|
| Connector supervisor (new) | `apps/api/src/core/modules/supervisors/platform/cloudflared-supervisor.service.ts` |
| Stack edge store (mode + tunnel) | `apps/api/src/core/modules/platform-ingress/services/platform-ingress-settings.service.ts` |
| Stack edge endpoints | `apps/api/src/modules/reachability/controllers/reachability.controller.ts` |
| Edge UI | `apps/web/src/app/dashboard/admin/edge/page.tsx` |
| Edge-mode env (seed value) | `packages/utils/env/src/index.ts` |
| ACME resolver + volume | `apps/api/.../traefik-supervisor.service.ts` |
| Workload reachability | `apps/api/src/modules/runners/swarm/swarm-runtime-runner.service.ts` |
| Wildcard tunnel rule | `apps/api/src/modules/reachability/controllers/reachability.controller.ts` |
| Migration (drop node tunnel cols) | `apps/api/src/config/drizzle/global/migrations/0036_gifted_reptil.sql` |

## Verification

| Check | Result |
|---|---|
| Type-check | api, web, setup — 0 errors |
| Supervisors + runners | 81/81 |
| Reachability + platform-ingress | 16/16 |
| Web unit tests | 76/76 |
| Traefik supervisor (edge-mode ports) | 22/22 |
| DI graph (`app.graph`) | passes — new injections resolve |

The 4 remaining failures are `EACCES: mkdir '/app/data'` (a container-only path)
and `AppModule import exceeded 45000ms` (a load timeout), both of which also
occur — more often — without these changes.

## Known gaps

- **Route53 / Google-DNS UI forms always throw**; only Cloudflare has an adapter.
- **`autoProvisionRecords` / `wildcardSubdomains`** on `projects.network` are
  write-only — no reader.
- **`constraint: node.labels.deployer.ingress == true`** is declared in the
  topology table but never enforced; every supervisor passes
  `placementConstraints: []`, and `ClusterService` can already set that label.
- **Workload volumes are node-local**, so a rescheduled task loses its data.

The per-node tunnel is no longer in this list: it was the bridge that made
`tunnel` mode unreachable, and it has been removed rather than kept alongside
the stack tunnel.
