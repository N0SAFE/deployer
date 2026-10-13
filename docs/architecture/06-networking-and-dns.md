# 06 — Networking & DNS

> **Status:** canonical
> **Answers:** how to reach the platform in dev and prod now that
> `*.deployer.localhost` is gone, and how Traefik resolves its backends.

## 6.1 The problem with `*.deployer.localhost`

The old scheme gave each app a loopback hostname:

```text
api.deployer.localhost      → 127.0.0.1   (RFC 6761)
web.deployer.localhost      → 127.0.0.1
setup.deployer.localhost    → 127.0.0.1
acme.api.deployer.localhost → 127.0.0.1   (prefix support)
```

It worked without DNS, which was the appeal. The costs were:

1. **Two naming systems.** Every URL existed twice — a `*.localhost` name for
   local/loopback and a real service name for containers (`api-dev:3005`). Code
   had to decide which it was in, forever.
2. **It leaked into product decisions.** Routes, CORS origins, cookie domains,
   Better Auth `trustedOrigins`, passkey origins, and the lane model all had to
   know about a hostname that only exists on one machine.
3. **It could never be true in prod.** So "dev" and "prod" diverged in a way
   that hid real bugs (a route that worked because loopback always resolves).
4. **166 references** across ~30 files, in contracts, schemas and UI code.

It is removed. Dev uses **ports**. Prod uses **real networking**.

## 6.2 Dev: ports, nothing else

In dev, every app publishes a host port. There is no hostname, no Traefik, no
DNS.

```text
http://localhost:3000      web
http://localhost:3005      bff            (the public API surface)
http://localhost:3006      svc-identity
http://localhost:3007      svc-project
http://localhost:3008      svc-runtime
http://localhost:3009      svc-fleet
http://localhost:3010      configurator
http://localhost:8080      traefik dashboard (optional)
```

The web app calls the BFF at `NEXT_PUBLIC_API_URL=http://localhost:3005`. Inside
compose, containers call each other by **compose service name** on the shared
network:

```text
http://bff:3005
http://svc-identity:3006
```

That is the same mechanism prod uses (service-name DNS), so dev and prod differ
only in *which* network owns the names — not in how they are resolved.

### Port allocation (deterministic)

A single offset table, so adding a service never requires negotiating a port:

| Offset | App |
|---|---|
| `+0` | web |
| `+5` | bff |
| `+6 … +19` | services, in the order registered in `service-catalog.ts` |
| `+20` | configurator |

`DEPLOYER_PORT_BASE` (default `3000`) is the only env var; each app derives its
own port. No app hardcodes an absolute port.

## 6.3 Prod: internal DNS + one public domain

Three planes, each with exactly one mechanism.

```text
┌─ PUBLIC plane ────────────────────────────────────────────────┐
│ The operator's domain, terminated at the edge provider.       │
│   https://app.example.com        → Traefik → web              │
│   https://api.example.com        → Traefik → bff              │
│   https://v34-1.config.example.com → static configurator UI   │
│ Mechanism: DNS record + ACME/TLS at the edge. Nothing         │
│ inside the cluster is publicly addressable.                   │
└───────────────────────────────────────────────────────────────┘

┌─ PRIVATE plane (the mesh) ────────────────────────────────────┐
│ Node-to-node over WireGuard.                                  │
│   http://<node-mesh-ip>:8080                                  │
│ Mechanism: the mesh overlay address per node. Used by the     │
│ mesh, supervisors, and the CLI when joining.                  │
└───────────────────────────────────────────────────────────────┘

┌─ INTERNAL plane (within a cluster) ───────────────────────────┐
│ Container-to-container, name-based.                           │
│   http://bff:3005   http://svc-identity:3006   http://db:5432 │
│ Mechanism: Docker/Swarm service-name DNS on the platform      │
│ network. Automatic, no configuration, survives rescheduling.  │
└───────────────────────────────────────────────────────────────┘
```

**Only the internal plane is used for service-to-service calls.** The BFF reaches
`svc-fleet` by name; a service reaches the database by name; nothing reaches
anything by IP or loopback.

## 6.4 How Traefik learns its backends and its routes

Two separate questions, two separate answers.

### Backends — internal DNS (no configuration)

Every Traefik router points at a **service name**, not a host:

```yaml
http:
  services:
    platform-bff:
      loadBalancer:
        servers:
          - url: http://bff:3005
    platform-web:
      loadBalancer:
        servers:
          - url: http://web:3000
```

The platform network's DNS resolves `bff` and `web` to whichever containers the
swarm scheduled. A rescheduled task therefore re-resolves with **no Traefik
change** — which is exactly why naming by service beats naming by IP.

### Routes — served over HTTP by the BFF

`TraefikIngressConfigService` (in `shared/src/core/modules/traefik`) is the single
source of Traefik's dynamic configuration, and it **serves it over HTTP** rather
than writing files:

```yaml
# traefik static config
providers:
  http:
    endpoint: http://bff:3005/ingress/config   # polled, cluster-wide
```

Why HTTP and not files: a named volume is **node-local**. On a multi-node cluster
every other node mounted an empty copy and routed nothing. Serving the config over
HTTP gives every node the identical answer, requires no Docker socket in Traefik,
no shared volume, and a node that loses the BFF keeps routing on its last fetched
config.

`buildLaneTraefikConfig` attaches each route to the lanes its visibility allows
(`private` → private; `public` → private + public) — the lane model is unchanged
by this design; only the *local* lane's hostname is redefined.

### What replaces the `local` lane

The old `local` lane existed so that `*.deployer.localhost` worked on the machine
itself. Its replacement differs by environment:

| Environment | "Reach the platform from this machine" means |
|---|---|
| dev | `localhost:<port>` — direct, no ingress |
| prod (single node) | the operator's public domain, or `http://<node-address>:<entryPort>` if reachable on the LAN |

So the lane remains a concept (a route's visibility), but it no longer requires a
special hostname. `DEFAULT_PRIVATE_DOMAIN` (`deployer.internal`) is kept for the
private lane, because `.internal` is ICANN-reserved for private use and can never
collide with a real public name.

## 6.5 TLS

| Plane | TLS |
|---|---|
| public | terminated at the edge (ACME or the edge provider's own certs) |
| private | the mesh's WireGuard encryption; no extra TLS inside the tunnel |
| internal | none inside a cluster network — the network is the trust boundary |

Adding TLS to the internal plane would add certificates with no threat model
behind them: the callers are containers on the same network.

## 6.6 Configuration

One variable decides the public surface, because there is only one:

```dotenv
# dev
DEPLOYER_PORT_BASE=3000
# no domain, no TLS, no Traefik

# prod
DEPLOYER_PUBLIC_DOMAIN=app.example.com
DEPLOYER_ENTRY_PORT=443
DEPLOYER_TRAEFIK_TLS_ENABLED=true
```

Removed env vars (and every reader of them): `DEPLOYER_PREFIX`,
`AUTH_BASE_DOMAIN`, `PASSKEY_RPID`, `PASSKEY_ORIGIN`, `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_API_URL` (in prod), `SETUP_API_URL`, `TRUSTED_ORIGINS` (in prod —
origins are derived from the one domain).

## 6.7 Postgres connection budget

Every process opens its **own** pool against the same Postgres, so the fleet-wide
connection ceiling is:

```
peak connections = GLOBAL_DB_POOL_MAX × <number of processes with a pool>
```

Postgres 16 defaults to `max_connections = 100`, and ~20 of those must stay free
for admin work (migrations, `psql`, the supervisor's own probe). The budget is
therefore:

```
GLOBAL_DB_POOL_MAX × 8 pools ≤ 100 − 20 = 80      ⇒      GLOBAL_DB_POOL_MAX ≤ 10
```

The 8 pools are the BFF, the five domain services (`identity`, `project`,
`runtime`, `fleet`, `health`), the legacy `api` and `setup`. The defaults are set
to that ceiling exactly, so the full stack fits with 20 connections of headroom.

| var | default | why |
|---|---|---|
| `GLOBAL_DB_POOL_MAX` | `10` | the only value that multiplies across the fleet |
| `GLOBAL_DB_POOL_MIN` | `0` | most processes idle most of the time; a non-zero floor is held open per process |
| `GLOBAL_DB_POOL_IDLE_TIMEOUT_MS` | `30000` | idle clients release after 30s, so the *observed* count tracks real load |
| `GLOBAL_DB_POOL_CONNECTION_TIMEOUT_MS` | `10000` | fail a saturated pool in 10s rather than hanging a request |

On a small host, lower `GLOBAL_DB_POOL_MAX` (services can run at 5). `min` is
clamped to `max` at startup — a floor above the ceiling would otherwise make the
pool permanently unsatisfiable.

## 6.8 Migration checklist

- [ ] Delete `HostnameService` and every `*.deployer.localhost` construction (166 refs / ~30 files)
- [ ] Replace hostname-based URLs with `serviceUrl(name)` (internal DNS) in code
- [ ] Replace `localhost:PORT` with `DEPLOYER_PORT_BASE + offset` in dev config
- [ ] Derive CORS/auth/passkey origins from `DEPLOYER_PUBLIC_DOMAIN`
- [ ] Point every Traefik backend at a **service name**
- [ ] Drop the `local` lane's hostname; keep the lane for visibility semantics
- [ ] Remove the drift-prone dev/prod port duplication (one base + offsets)
- [ ] Update `lanes.schema.ts`, `platform.contract.ts`, auth config, and the web env
