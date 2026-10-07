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

Traefik is the Swarm edge in every provider; only the hop in front changes.

| Provider | Path | Requires |
|---|---|---|
| `local` **(default)** | loopback → Traefik | nothing |
| `wireguard` | mesh peer → overlay address → Traefik | overlay IP + peers |
| `tunnel` | cloudflared → Traefik | tunnel provider + token |
| `direct` | DNS → node IP → Traefik :80/:443 | public IP, inbound ports |

`local` is the default: a port listens on loopback only, so a fresh install is
reachable from nowhere until the operator opts into something wider.

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

#### The ingress provider decides what is bound, not NODE_ENV

Four providers, ordered least → most exposed. The canonical list (with what each
one requires, as data) lives in
`packages/contracts/entities/src/entities/ingress/provider.schema.ts`; the
binding each one produces is resolved by
`apps/api/src/core/modules/platform-ingress/services/ingress-binding.ts`.

| `DEPLOYER_EDGE_MODE` | What is bound | Requires |
|---|---|---|
| `local` **(default)** | `127.0.0.1:80` — loopback only | nothing |
| `wireguard` | this node's mesh overlay address, `:80` | an overlay IP + peers |
| `tunnel` | **nothing** | Cloudflare account + tunnel-capable DNS provider |
| `direct` | `:80/:443` on **every** interface | public IP + open inbound ports |

**The default was inverted.** It used to be `direct`, which publishes `:80/:443`
on every node — so a machine was on the public internet before the operator had
made any decision at all. `local` is now the default: a port listens, but only on
loopback, so a fresh install is reachable from nowhere until someone opts in.
`direct` is fully supported and is now opted INTO.

`local` and `wireguard` both **bind a port** but are **not publicly reachable** —
which is the distinction the old two-value model (`direct` | `tunnel`) could not
express. Anything user-facing reasons about `edge.exposure`, derived server-side,
rather than comparing the provider to a literal.

**Swarm cannot express a single-address bind.** Its port spec is
`{ TargetPort, PublishedPort, Protocol, PublishMode }` — there is no host-IP
field, so a swarm publish always binds `0.0.0.0`. `local` and `wireguard`
therefore cannot be a swarm publish; they are realized by
`LocalIngressForwarderService`, a plain container whose `HostConfig.PortBindings`
DOES carry `HostIp`. The swarm ingress stays headless in those providers (it
still routes for the whole cluster) and the forwarder is the address-scoped door
in front of it. It removes itself when the provider stops being address-scoped,
so a mode change never leaves a stale listener behind.

This used to key off `NODE_ENV`: production ran headless "behind the operator's
proxy". That silently made `direct` impossible in production — the caller was
supposed to point DNS at a port the stack refused to bind. The decision now
belongs to the provider the operator actually chose.

#### `wireguard` — what works, and what does not yet

`wireguard` resolves to "bind the node's overlay address". That resolution is
implemented and tested, but there is a NAMESPACE problem worth stating plainly
rather than implying it is finished:

The overlay IP (`MANAGED_WIREGUARD_IP`, e.g. `10.0.0.7`) belongs to the WireGuard
**sidecar container's** network namespace, not the host's. The forwarder asks
Docker to bind that address, and Docker binds on the HOST — where the address
does not exist. So on a node where the mesh lives entirely inside the sidecar,
the bind fails.

Reaching a working `wireguard` ingress needs one of:

1. **Host-network sidecar** (`NetworkMode: "host"` on the WireGuard service), so
   the overlay address IS a host address and the forwarder's bind lands. This is
   the smallest change but needs the swarm spec to express a network mode it
   currently cannot.
2. **Sidecar publishes the ingress port** on the overlay address itself (the
   sidecar already binds host UDP `51820`, so it can bind TCP too), turning the
   sidecar into the address-scoped door and removing the forwarder from this
   path entirely.
3. **Route through the overlay from a mesh peer** — the peer proxies to
   `deployer-traefik` by name, and no host bind is needed on the server at all.

Until one of those lands, `wireguard` is a fully modelled, fully validated
provider that cannot complete its bind on a sidecar-isolated node. The honest
failure is deliberate: `resolveIngressBinding` returns
`overlay-address-missing` when no address is configured, and the supervisor logs
that it bound nothing rather than falling back to `0.0.0.0` — the fallback that
would have turned "private mesh only" into "public".

#### TLS that actually works

Enabling TLS used to add the `:443` entrypoint and stop — every HTTPS request was
answered with Traefik's **self-signed** certificate. Now a real ACME resolver is
declared in the ingress args, with `acme.json` on a persistent volume (a missing
file re-orders on every restart, which Let's Encrypt rate-limits).

## Files

| Concern | File |
|---|---|
| Provider vocabulary + traits | `packages/contracts/entities/src/entities/ingress/provider.schema.ts` |
| Binding resolution (pure, tested) | `apps/api/src/core/modules/platform-ingress/services/ingress-binding.ts` |
| Address-scoped lane (`local` / `wireguard`) | `apps/api/src/core/modules/platform-ingress/services/local-ingress-forwarder.service.ts` |
| Connector supervisor | `apps/api/src/core/modules/supervisors/platform/cloudflared-supervisor.service.ts` |
| Stack edge store (provider + tunnel) | `apps/api/src/core/modules/platform-ingress/services/platform-ingress-settings.service.ts` |
| Stack edge endpoints | `apps/api/src/modules/reachability/controllers/reachability.controller.ts` |
| Edge UI | `apps/web/src/app/dashboard/admin/edge/page.tsx` |
| Edge-mode env (seed value) | `packages/config/env/src/index.ts` |
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
