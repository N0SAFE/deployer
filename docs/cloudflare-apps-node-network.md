# Cloudflare Apps & Per-Node Network Config

> **Scope**: the reworked Cloudflare DNS provider ("app" model), runtime state
> checking, per-node IP/domain system config in the global DB, automatic tunnel
> provisioning and live tunnel health.
> **Date**: 2026-08-05 · **Branch**: rewrite-v3

---

## 1. Concept

A **Cloudflare app** is one `dns_providers` row (a single Cloudflare account
connection backed by an API token). Apps are feature-gated: other modules only
see a feature when **at least one app has it enabled AND its live runtime state
is healthy**.

The **per-node network config** (`node_network_config`) is the "main IP/domain
of System" — now scoped per mesh node, stored in the global DB keyed by the
node UUID (the same id as `cluster_nodes.nodeId` / local `node_config.nodeId`).

## 2. Data model (global DB)

### `dns_providers`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | provider app id |
| `provider_type` | text | `"cloudflare"` (extensible) |
| `name` | text | display name |
| `is_active` | bool | feature gate (inactive apps are unusable) |
| `credentials` | encryptedText | JSON `{ apiToken, accountEmail? }` |
| `config` | jsonb | `{ accountId }` resolved at runtime |
| `features` | jsonb | `{ dnsManagement, tunnelManagement }` |
| `state` | jsonb | **display cache only** — live-checked at runtime |

### `node_network_config`

| Column | Type | Notes |
|--------|------|-------|
| `node_id` | uuid pk | mesh node (same id as `cluster_nodes.nodeId`) |
| `public_address` | text | IP / hostname / origin (null when tunneled) |
| `address_kind` | text | `"ip" \| "hostname" \| null` (derived) |
| `tunnel_enabled` | bool | tunnel takes over the public address |
| `tunnel_provider_id` | uuid | → `dns_providers.id` |
| `tunnel_id` | text | Cloudflare tunnel created automatically |
| `tunnel_hostname` | text | public hostname the tunnel exposes |

## 3. Runtime state (never "once in the DB")

`CloudflareAppService.getLiveState()` re-checks every app at request time:

- `user.tokens.verify()` → token status
- account id resolution (`accounts.list` → `zones.list` fallback → persisted in
  `config.accountId`)
- 15s in-memory TTL cache so dashboards don't hammer the Cloudflare API

The `state` jsonb column is only a last-known cache for initial paint. The
domain gate (`ReachabilityService.checkDomainGate`) requires: tunnel enabled +
`tunnelId` provisioned + provider row active with `tunnelManagement`.

## 4. Feature gating ("the feature only appears when set up")

- `dnsManagement` — enables zones/records browsing + preview DNS provisioning
  (`PreviewProvisioningService.findFirstActiveProvider()` filters on it).
- `tunnelManagement` — enables the Tunnel option in
  System → Node Network **and** the tunnel tabs in the Cloudflare app detail
  page.

The UI hides the Tunnel option entirely until at least one app is
`tunnelManagement` + healthy.

## 5. Automatic tunnel provisioning

When a node enables tunnel mode (`updateNodeNetworkConfig` with
`tunnel: { enabled: true, providerId }`) and no tunnel exists yet, the product
layer (`ReachabilityController.provisionTunnelIfNeeded`) calls
`CloudflareTunnelService.createTunnel`:

1. `zeroTrust.tunnels.cloudflared.create({ account_id, name })`
2. `token.get(...)` → the `cloudflared` run token
3. optional CNAME `hostname → <tunnel-id>.cfargotunnel.com` when the hostname
   is covered by a zone on the account

The resulting `tunnelId` + `hostname` are persisted back to
`node_network_config`.

Tunnel **health** is live: `CloudflareTunnelService.getTunnelHealth` reads the
tunnel status (healthy/degraded/down/inactive) + active connector count, and is
attached to every node-config read (never stored as truth).

### 5.1 Ingress (routing) — required to resolve error 1033

`createTunnel` provisions the tunnel + optional CNAME but **not** the routing
rule. Since 2026-08-28, `ReachabilityController` also calls
`CloudflareTunnelService.configureIngress` (idempotent):

- on first provisioning (`provisionTunnelIfNeeded`), and
- on every tunnel-enabled update (self-heals existing tunnels that were created
  before ingress support).

The ingress maps the tunnel hostname → the deployer web entry:

```text
deployer.sebille.net  →  http://deployer:3000   (web, which rewrites /api → API)
```

The service URL is `CLOUDFLARE_TUNNEL_SERVICE_URL` (default
`http://deployer:3000`, the web container on the compose network). With the DNS
CNAME present **but no connector running** (or no ingress), Cloudflare answers
**error 1033 "Cloudflare is currently unable to resolve it"**.

### 5.2 Running the connector (`cloudflared`)

The app never runs `cloudflared` itself — a connector must be running with the
tunnel's run token. Self-hosted ops deployments get a ready-made sidecar:

`docker/compose/deployer/docker-compose.deployer.yml` → `cloudflared` service:

```yaml
cloudflared:
  image: cloudflare/cloudflared:latest
  command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN:?set ...}
  networks: [deployer_network]
```

Set `CLOUDFLARE_TUNNEL_TOKEN` in the environment (copy it from the Cloudflare
app detail page → tunnel card → **Run token**). Or, on a host with
`cloudflared` installed:

```bash
cloudflared tunnel --no-autoupdate run --token "<token>"
```

Once the connector connects, `deployer.sebille.net` resolves through the
tunnel to the web app, which serves the UI and proxies `/api/*` to the API
(Next.js rewrites). 1033 clears when the tunnel shows `Healthy · ≥1 conn` in
the app detail page.

## 6. Cloudflare app detail page

`dashboard/admin/providers/dns/cloudflare/[providerId]`:

- **DNS Records tab** — zone select + type filter + name search + pagination
  (URL state via `useSafeQueryParamStatesFromZod`).
- **Tunnels tab** — tunnel cards with status, connectors (colo, reconnect),
  "Run token" dialog, delete. A tunnel bound to a node in System → Node Network
  is tagged **"Used by node \<name\>"**.

## 7. Key files

| Layer | File |
|-------|------|
| Schema | `apps/api/src/config/drizzle/global/schema/dns-providers.ts`, `node-network-config.ts` |
| App service | `apps/api/src/modules/providers/dns/cloudflare/cloudflare-app.service.ts` |
| Tunnel service | `apps/api/src/modules/providers/dns/cloudflare/cloudflare-tunnel.service.ts` |
| DNS records | `apps/api/src/modules/providers/dns/cloudflare/cloudflare-dns-provider.service.ts` |
| HTTP | `apps/api/src/modules/providers/controllers/dns-providers.controller.ts` |
| Core per-node config | `apps/api/src/core/modules/reachability/services/reachability.service.ts` |
| Provisioning + health | `apps/api/src/modules/reachability/controllers/reachability.controller.ts` |
| Contracts | `packages/contracts/api/modules/{dns-providers,reachability}/contracts.ts` |
| Web apps page | `apps/web/src/app/dashboard/admin/providers/dns/cloudflare/page.tsx` |
| Web app detail | `apps/web/src/app/dashboard/admin/providers/dns/cloudflare/[providerId]/page.tsx` |
| Web system config | `apps/web/src/components/dashboard/system/NodeNetworkConfig.tsx` |

## 8. Migration

`apps/api/src/config/drizzle/global/migrations/0014_brown_shriek.sql` adds the
two tables. Applied by the standard `db:migrate` flow (container) on next boot.
