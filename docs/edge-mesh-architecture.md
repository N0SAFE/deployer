# Edge & Mesh architecture — mesh first, lanes in front, no inbound port

> Supersedes `docs/edge-ingress-architecture.md` (the single `edge.mode` model).
> Decisions and the answers behind them: `docs/qa/edge-mesh/`.

## The invariant

```
A DEPLOYER NODE
  public IP required ......... no
  inbound firewall rule ...... no
  port forwarding ............ no
  listening socket on a
  public interface ........... no   (one exception: the operator opts into `direct`)
```

Everything a node needs from the outside world it gets by **dialling out**. Two
facts make that possible, and both are physical rather than design choices:

1. Two machines that both refuse inbound connections cannot find each other
   without a third party. In this design that third party is **any other member
   of the mesh** that already has a path to both — never a dedicated server.
2. A public client can only reach a node through something public. That
   something is either a tunnel provider the node dials out to (Cloudflare), or a
   member the operator deliberately exposed (`direct`).

## Four planes, each with one job

```
                 ┌────────────────────────────────────────────┐
  DNS plane      │ where does a hostname resolve?             │  EdgeDnsService
                 └────────────────────────────────────────────┘
                 ┌────────────────────────────────────────────┐
  Ingress plane  │ how does a packet reach Traefik?           │  lanes + doors
                 │   local · private · public(edge provider)  │  edge providers are
                 └────────────────────────────────────────────┘  plugins (§3b)
                 ┌────────────────────────────────────────────┐
  Cluster plane  │ Docker Swarm — scheduling, overlays        │  advertises the
                 │                                            │  MESH address
                 └────────────────────────────────────────────┘
                 ┌────────────────────────────────────────────┐
  Mesh plane     │ peer-equal WireGuard mesh                  │  deployer-mesh-agent
                 │ identity · roster · links · node doors     │  (one per node)
                 └────────────────────────────────────────────┘
```

The order is the dependency order: the mesh exists before Swarm (Swarm rides on
it), Swarm exists before Traefik (Traefik is a swarm service), and DNS only ever
points at something the ingress plane already serves.

---

## 1. Mesh plane — peer-equal, no source of truth

### Why not Headscale / NetBird / Tailscale

All three have a control server every node depends on. The operator asked for
the opposite: *"everything mesh first instead of one source of truth and the
others connect to it."* So there is no controller, no lighthouse, no
coordinator — every member can do everything another member can.

### The agent

`apps/mesh-agent` runs on **every** node as a plain container (not a swarm
service — it must exist before Swarm does):

| Property | Value | Why |
|---|---|---|
| network | `host` | the mesh interface must be a HOST interface, so Swarm can advertise it and Docker can bind a door to it |
| caps | `NET_ADMIN` | creating and configuring a WireGuard interface |
| restart | `unless-stopped` | the Docker daemon is its supervisor; it does not depend on the API |
| volumes | `deployer-mesh-state` (identity + roster, 0600), `deployer-mesh-run` (control socket) | |
| docker socket | yes | it owns the node's **doors** (see §3) |

It is started by whichever of setup or the API reaches the node first, and the
API supervises the one on its own node. Its job, per node:

1. **Identity** — on first boot it generates an ed25519 signing key and an
   x25519 WireGuard key. Private keys never leave the node. The member id is
   derived from the signing key.
2. **Address** — the mesh address is **derived from the WireGuard public key**
   inside the cluster CIDR (default `100.88.0.0/16`). No allocator, so no one
   has to be online to hand out addresses. A collision (rare) is resolved
   deterministically: the later-admitted member re-derives with the next salt.
3. **Roster** — a signed, replicated CRDT (see below), merged on every gossip.
4. **Links** — plans and applies WireGuard peers (`wg syncconf`).
5. **Doors** — converges the node-local listeners in front of Traefik (§3).
6. **Control socket** — `/run/deployer-mesh/agent.sock` (HTTP over a unix
   socket) for the API and setup on the same node. Filesystem permission is the
   authority: only a process that can mount the volume can talk to it.

### The roster (replicated state, no owner)

```
RosterState
├── genesis      { clusterId, memberId, signingKey, cidr }   signed by the founder
├── admissions   memberId → signed by an existing member      (union)
├── members      memberId → self-signed entry, versioned       (last-writer-wins)
├── revocations  memberId → signed by any member               (union, permanent)
└── settings     key      → signed by any member, versioned    (last-writer-wins)
```

`merge(a, b)` is commutative, associative and idempotent, so any subset of
members converges on the same state in any order, and the cluster has no member
whose loss loses data. Every record is verified on merge — a record that does
not chain back to the genesis through valid admissions is dropped, so a peer can
only ever relay what members actually signed.

The genesis is a **trust root**, not a runtime dependency: once it has admitted
a second member, the founder can be lost forever and every remaining member can
still admit, revoke and change settings.

**Cluster settings live here.** The ingress lanes, the public provider and the
tunnel credential are cluster-wide facts, so they are replicated by the mesh —
not stored in the API's node-local SQLite, where they were lost whenever the API
was rescheduled to another node.

### Gossip

Every 5 s each agent pushes its full roster to up to 3 random members over the
mesh (`POST /v1/gossip` on `<mesh address>:7300`) and merges the reply. Rosters
are small (one entry per node), so full-state push-pull is simpler and more
robust than digests. The gossip listener binds the mesh address **only**:
WireGuard already proves which member a source address belongs to.

### Links — how two members reach each other

For each peer the planner tries, best first:

| Order | Candidate | Inbound port needed |
|---|---|---|
| 1 | same-subnet LAN address | no (same network) |
| 2 | declared address (a `direct` node's public IP) | on THAT node only — its operator opted in |
| 3 | reflexive address (from public STUN) + listen port, both sides keepalive → hole punch | no |
| 4 | other LAN addresses | no |
| 5 | **relay through another member** over its existing session | no |

A fresh handshake (< 180 s) pins the endpoint WireGuard itself observed — roaming
wins over the plan. Each candidate gets a 20 s window before the next is tried.

Step 5 is the **relay-over-session** transport (a member that reaches both sides
forwards WireGuard datagrams over its outbound session). It is modelled in the
planner (`path: "relay"`) and stubbed in this pass — see *Next steps*.

The WireGuard UDP socket is the node's only listener and it is never published or
port-forwarded. WireGuard does not answer a packet that does not carry a valid
key, so to a scanner the port is indistinguishable from closed.

### Joining

```
joiner                         any existing member (through ANY lane it has)
  │  setup wizard: cluster URL + superadmin + one-time token
  │──── POST mesh.consumeJoinGrant { joinRequest: signed entry } ───▶ API
  │                                                    │ authorises the operator
  │                                                    │ local agent: POST /v1/admissions
  │◀─── { admission, roster, swarm grant (manager mesh addresses) } ─┘
  │  local agent: POST /v1/join { admission, roster }
  │  WireGuard handshakes to every member's candidates
  │  docker swarm join --advertise-addr <own mesh address> <manager mesh address>:2377
```

Any member can admit — the one the joiner happened to reach. The admission spreads
by gossip.

### The operator's laptop

`deployer mesh connect` (CLI) will run the same agent on the laptop as a
non-scheduling member (`kind: "operator"`), so the private lane works from
anywhere with no inbound port. The member kind exists in the roster now; the CLI
command is a typed stub in this pass.

---

## 2. Cluster plane — Swarm rides the mesh

| Swarm option | Value |
|---|---|
| `AdvertiseAddr` | `<mesh address>:2377` |
| `ListenAddr` | `<mesh address>:2377` |
| `DataPathAddr` | `<mesh address>` (VXLAN 4789 travels inside WireGuard) |

So 2377/7946/4789 are bound on the mesh interface only, and overlay traffic
between nodes is encrypted by WireGuard without Swarm's own `encrypted` overlay
option. A join grant only ever hands out manager **mesh** addresses.

A single-node swarm founded before the mesh existed (advertising `127.0.0.1`) is
re-anchored onto its mesh address the first time it issues a join grant
(`docker swarm init --force-new-cluster --advertise-addr <mesh address>`), which
keeps its services and is only needed once.

---

## 3. Ingress plane — lanes, entrypoints, doors

Traefik is **permanent infrastructure**: a `global` swarm service on every node,
with **no Docker socket and no config volume**. It polls its routes from the API
over the platform overlay (HTTP provider), so every node has identical routes,
and a node that loses the API keeps serving its last configuration.

Every lane is a separate Traefik entrypoint with its own door:

| Lane | Enabled | Entrypoint | Door | Hostnames |
|---|---|---|---|---|
| `local` | always | `local` :80 | node door bound `127.0.0.1:<entry port>` | `<label>.deployer.localhost` |
| `private` | opt-in | `private` :8001 | node door bound `<mesh address>:<entry port>` (+ the LAN address with "allow same-network join") | `<label>.<private domain>` (default `deployer.internal`) |
| `public` | opt-in, ONE edge provider | `public` :8002 (+ `public-tls` :8443 for ACME edges) | whatever the edge provider needs (§3b) | `<label>.<public domain>` + verified custom domains |

**Why doors are containers owned by the agent.** Swarm's port spec has no host-IP
field: a swarm publish always binds `0.0.0.0`. A loopback-only or mesh-only
listener therefore has to be a plain container with
`HostConfig.PortBindings[].HostIp`, and something on **each node** must create
it. The API is not on every node; the agent is. So the agent converges two
nginx containers per node from the replicated `node.doors` setting (which the
ingress supervisor derives from `ingress.lanes`):

- `deployer-door-local` → `127.0.0.1:<entry port>` → Traefik `local`
- `deployer-door-private` → `<mesh address>:<entry port>` → Traefik `private`

The local door is also the **rescue lane**: when Traefik does not answer, the
platform's own hostnames fall back to the API and web containers directly. That
replaces the old failover proxy, which published `:80/:3000/:3001` on every
interface of every node whenever Traefik degraded.

### Visibility — per route

Every route has a `label` (its subdomain on the generated lanes) and a
`visibility`:

| Visibility | Lanes |
|---|---|
| `private` | local + private |
| `public` | local + private + public |

Services choose (`services.network.visibility`, default `public`); the platform
console has one stack setting (`ingress.lanes.consoleVisibility`, default `public`, so
webhooks and OAuth callbacks keep working once a public lane exists). A public
lane that is not enabled simply contributes no routers.

## 3b. Edge plane — pluggable public edge providers

The public lane is "reach Traefik's `public` entrypoint from the internet". HOW is
an **edge provider**'s business, and providers are plugins. Nothing around them
names a provider:

| Consumer | Asks the provider | Generic code |
|---|---|---|
| Ingress page | `descriptor` (label, kind, options form), `status()` | `IngressEdgeService`, web `PublicEdgePanel` |
| Lane change | `provision(ctx)` (new edge first), `teardown()` (old edge last) | `IngressEdgeService.update` |
| Traefik | `ingress(lane)` → published host ports + who serves HTTPS | `EdgeProviderRegistry.ingressPlan`, `TraefikSupervisorService` |
| Connector | `connector(ctx)` → image, env (credentials), args, replicas | `EdgeConnectorSupervisorService` (one swarm service, any tunnel) |
| DNS | `dnsRecords(ctx)` → record sets with the account to prefer | `EdgeDnsService` |
| Joining | `joinPath(ctx, status)` | `joinEntryPoints` |
| Domain gate | `status().provisioned` | `ReachabilityService.checkDomainGate` |

Built in today:

| Provider | Kind | Inbound ports | Account | HTTPS | Lives in |
|---|---|---|---|---|---|
| `cloudflare-tunnel` | tunnel (dials out) | none | Cloudflare (DNS provider app with tunnel management) | Cloudflare terminates | `modules/providers/edge/cloudflare-tunnel` |
| `direct` | inbound | :80 (+ :443) on every node | none | Let's Encrypt on `public-tls` | `core/modules/edge/providers` |

**Rules the registry enforces for every provider** (`EdgeProviderRegistry`):
the provider exists; the lane's `options` match the descriptor's fields (types,
required, no unknown keys, boolean defaults filled); a provider whose descriptor
says `opensInboundPorts` gets the operator's `acknowledgedInboundPorts: true` —
and Traefik publishes no port that was not acknowledged, even from a hand-edited
setting.

**Switching providers** is new-first, lanes second, old-last: the new edge is
provisioned before the lanes name it (if it cannot exist, nothing changes), and
the previous one is torn down afterwards (best effort — the lane no longer names
it, so it carries nothing even if its provider is unreachable). DNS names the old
edge owned and the new one does not are removed.

**State** — each provider keeps what it created in its own replicated cluster
setting `edge.<provider id>` (`EdgeStateStore`). A credential stored there (a
connector token) reaches every member, because a connector may run on any node,
and never reaches a client: providers report `EdgeStatus` facts and
`resources` (e.g. `{kind: "tunnel", id, accountId}`), not their state.

### Adding an edge provider

1. Implement `EdgeProvider` (`core/modules/edge/edge-provider.ts`) in an
   `@Injectable` and call `registry.register(this)` from its constructor.
2. Add the class to the providers of the module that owns its integration
   (account-backed providers next to their DNS integration in `modules/providers`).
3. Describe its options in the descriptor (`boolean`, `text`, `dns-account`); the
   web renders the form from it — no UI change.

A tunnel-style provider (frp to an operator VPS, a WireGuard relay, another
vendor) returns a `connector()`; an inbound one returns `publishedPorts` from
`ingress()` and sets `opensInboundPorts`.

### `direct`, under this design

`direct` is kept, as an explicit opt-in with an acknowledgement, because it is
the one public path with no third party. Its DNS points at the nodes' declared
public addresses (Network → Ingress & edge → node public addresses). In a
mesh-first cluster it is also useful to the mesh: a `direct` node can declare its
public address as a link candidate, making it a reachable rendezvous for NATed
members. A "gateway" is just a member whose operator chose `direct`.

## 4. DNS plane — separate from ingress

`EdgeDnsService` answers *where does this hostname resolve*, through the DNS
provider registry, and nothing else:

| Lane state | Record |
|---|---|
| public | whatever the edge provider returns from `dnsRecords()` — Cloudflare Tunnel: `*.<domain>` CNAME `<tunnel id>.cfargotunnel.com` (proxied); Direct: `*.<domain>` A → the nodes' declared public IPs |
| private, domain in a managed zone | `*.<private domain>` A → mesh addresses of the nodes |
| local | none — `*.localhost` always resolves to loopback (RFC 6761) |

Provisioning an edge creates no DNS record; the DNS plane reconciles on every
lane change and every 10 minutes, through whichever DNS account owns the zone
(the provider's preferred account first). A zone no account owns is reported
`manual`, with the exact record to create.

## 5. Platform state (next step, not this pass)

The network no longer has a source of truth. Platform **state** still does: one
shared Postgres every node connects to. The recommended target for a
self-hosted, auto-managed deployer:

- **Node-owned facts** stay in each node's local SQLite (they already do).
- **Cluster-wide small facts** (lanes, edge state, doors, membership) live in
  the mesh roster's settings (done in this pass): `ingress.lanes`,
  `edge.<provider id>`, `node.doors`, read through `ClusterSettingsService`.
- **Cluster state** (projects, deployments, users) moves to Postgres with
  streaming replicas **co-located with the swarm managers** and automatic
  promotion driven by the existing master election, so its availability matches
  the cluster's quorum instead of one task on one node.

## Removed in this pass

| Removed | Replaced by |
|---|---|
| `WireGuardSupervisorService`, `MANAGED_WIREGUARD_*` env, UDP 51820 publish | mesh agent |
| `edge.mode` (single stack mode) | lanes (`ingress.lanes` cluster setting) |
| Cloudflare-specific tunnel code in core (`ingress.tunnel`, cloudflared supervisor, tunnel health endpoint) | edge-provider plugins (`edge.<id>` state, generic connector supervisor, `EdgeStatus`) |
| Legacy node-local edge rows (`edge.*` in SQLite) | not migrated — re-enable the public lane once on Network → Ingress & edge |
| `LocalIngressForwarderService` | agent-owned doors |
| `DirectPortProxySupervisorService` (0.0.0.0 failover) | local door rescue lane |
| Traefik docker/swarm providers, socket and config-volume mounts | HTTP provider |
| Dynamic YAML files written by the API | `GET /internal/ingress/traefik-config` |
| API service published on `*:3005`, Postgres on `0.0.0.0:5432` | overlay only; reach them through a lane |

## Web — one Network section

Every plane has one page under **Network** (`apps/web/src/app/dashboard/network`),
sharing one section nav and one `getIngress` snapshot:

| Page | Plane | What it does |
|---|---|---|
| Overview | all | lanes at a glance, exposure, mesh health, DNS status, join paths |
| Ingress & edge | ingress + edge | local/private lanes, the public edge (rendered from the provider catalog), console visibility, node public addresses (inbound edges), this node's doors |
| Mesh | mesh | members as this node sees them (link path, handshake, endpoints), revoke, how a node joins |
| DNS | dns | the lane record sets and their convergence |
| Domains | on top | project custom domains (served on the public lane) |

Changing lanes, the edge, or mesh membership requires a platform admin
(`requirePlatformRole(["superAdmin", "admin"])`).

## Upgrading an existing cluster

A single-node install upgrades by itself: the API starts the mesh agent at boot
and founds a one-member mesh (`MeshAgentBootstrapService`). A node that already
shares a swarm with others is NOT given a mesh of its own — that would split the
cluster. Admitting already-joined nodes is not automated yet: re-run the join
flow on each of them (setup → join an existing cluster) so a member admits it,
then Swarm moves onto the mesh addresses. The public lane must be turned on again
once (legacy edge rows are not migrated).

The dev compose files cannot simulate several meshes on one Docker host: the agent
is a host-network container, one per daemon. `mesh-6` shares one agent.

## Next steps

1. **Relay-over-session** — UDP↔session bridge so two members behind symmetric
   NATs connect through a third (`planRelay` stub in `@repo/mesh-network`).
2. **`deployer mesh connect`** — operator laptop as a mesh member (CLI stub).
3. **Replicated platform state** (§5).
4. **Agent upgrades** pushed through the mesh (today: re-created by setup/API on
   the node they run on).
5. **Admit already-joined swarm nodes** into the mesh from the Mesh page (today:
   re-run the join flow on them).
6. More edge providers as plugins (e.g. a relay on an operator-owned VPS).
