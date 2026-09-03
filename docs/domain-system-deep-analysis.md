# Domain System Deep Analysis & Reviewed Design

> **Scope**: Cloudflare Tunnel flag, provider-scoped domain/subdomain management, the
> "domain = accessible node endpoint" reframe, and domain integration alongside
> projects & services. Analysis of current state (evidence-backed) + reviewed design.
> **Date**: 2026-07-31 · **Branch**: rewrite-v3

> **Evidence path base** (used throughout): API schemas live under
> `apps/api/src/config/drizzle/global/schema/`, contracts under
> `packages/contracts/api/modules/<module>/`, API code under `apps/api/src/`, web under
> `apps/web/src/`. Short paths below are relative to these bases.

---

## 1. Executive Summary

The current domain stack is **five disconnected concepts** that the user's intuition is
correct to call into question:

1. **Node network config** (`NODE_PUBLIC_IP` / `NODE_TUNNEL_MODE` in `app_config`) — the only
   thing that gates domain creation today. The tunnel flag is a **self-referential boolean**
   (`tunnelConfigured := tunnelMode`) with **zero awareness of any provider token**.
2. **DNS providers** — Cloudflare API tokens stored by **abusing the `github_apps` table**
   (`organizationId: "dns-providers"`, token in `clientSecret`, dozens of `as unknown as` casts).
   Zone/record enumeration contracts exist but are **empty stubs**.
3. **Organization domains** — a correct 3-tier hierarchy (`organization_domains` →
   `project_domains` → `service_domain_mappings`) with a rich, documented core module — but
   `organization_domains` has **no provider FK** and domains are free-text, so the provider's
   zone list is never consulted.
4. **Per-service routing** — a `traefikConfig` column on `services` (JSON RoutersConfig) is the
   **actual routing source of truth**, and it is **completely disconnected** from
   `service_domain_mappings`. Domain bindings today declare intent but nothing routes to them.
5. **Per-env domain config** (`environments.domainConfig` jsonb) and **legacy `domain_configs`
   / `route_configs` (traefik) tables** — written (or schema-only) with **zero consumers**.

**Verdict on the reframe (user #3)**: *mixed — adopt partially.* "Domain" is doing two
genuinely different jobs that must be split, not merged:
- **Where the node is reachable** (public IP / tunnel / URL) belongs in **node network config**
  (system/node_config) — this is a *node* concept. The documented-but-unbuilt `public_reachable_url`
  and the mesh stack's `nodeServerUrl`/`APP_URL` already point here.
- **What domains the platform may manage DNS for** (provider zones + registered/verified
  domains + subdomains) belongs in the **domain module** — this is an *account/provider* concept.

The two meet at `checkDomainGate` (node must be reachable before you can create a domain), which
is exactly where the tunnel flag must learn about the provider token.

---

## 2. Current State (evidence)

### 2.1 Node network config & tunnel — the disconnected flag

`apps/api/src/core/modules/reachability/services/reachability.service.ts` is the **only** owner
of `NODE_PUBLIC_IP` / `NODE_TUNNEL_MODE` (grep across seeds/config/CLI = zero other hits):

| Concern | Location | Evidence |
|---|---|---|
| Key constants | `reachability.service.ts:8-9` | `KEY_PUBLIC_IP`, `KEY_TUNNEL_MODE` |
| Read public IP | `:20-35` | `select value from app_config where key='NODE_PUBLIC_IP'` |
| Read tunnel mode | `:37-51` | `row[0]?.value === 'true'` (exact string compare) |
| Write both | `:64-77` | upsert into `app_config` (text k/v, **no FK**, no provider ref) |
| `tunnelConfigured := tunnelMode` | `:53-61` | self-referential — "configured" always equals "enabled" |
| `checkDomainGate()` | `:83-99` | gates **only** on `publicIp`/`tunnelMode`; "Cloudflare" appears only in the reason string |
| Schema | `packages/contracts/api/modules/reachability/contracts.ts:53-62` | `nodeNetworkConfigSchema` + update schema (no provider field) |

**Consumers of the gate**: `DomainOrganizationService.addOrganizationDomain`
(`modules/domain/services/domain-organization.service.ts:31-36`, the only production
enforcement, throws `DomainGateBlockedError`), the ORPC endpoint, and the web
(`useCheckDomainGate` → domains page banner + `NodeNetworkConfig.tsx` badge).

**Detection asymmetry**: `getPublicIp()` (`:104-121`) prefers the configured IP then falls back
to external detection — but the gate uses **only the configured IP**. Auto-detected IP is
display-only in the UI; the gate never sees it.

### 2.2 DNS providers — token storage abuse + zone stubs

`apps/api/src/modules/dns-providers/controllers/dns-providers.controller.ts`:

- **Storage**: every provider row is a `github_apps` row with `organizationId: "dns-providers"`,
  `appId: "cf-token-<ts>"`, `clientId: name`, `clientSecret: <apiToken>`, and
  `privateKey`/`webhookSecret` forced to `""` via `as unknown as string` casts
  (create at `:62-87`; OAuth init rows at `:142-178`/`:238-…`).
- **Verification**: `create()` validates the token by calling `client.user.tokens.verify()` and
  rejects non-`active` status (`:50-60`).
- **OAuth**: `cloudflareConnectInit` (server env creds), `cloudflareOauthInit` (user creds),
  `cloudflareOauthCallback` (exchanges code → `access_token` into `clientSecret`, `isActive=true`).
  **No refresh-token handling.**
- **Zone/record contracts are STUBS**: `cloudflareListZones`/`cloudflareListRecords`/
  `cloudflareCheckRecord` return empty arrays (`:257-289`). **No zone enumeration exists**
  anywhere. **No Cloudflare Tunnel API usage** anywhere.
- Contract surface (S9): `list`/`create`/`delete` + 3 OAuth + 3 stubs, all `@Implement`-ed,
  all exported; only `list`/`create`/`delete` are consumed by the web app.

### 2.3 The domain module — healthy layering, not a full duplicate

The planner's "two implementations" concern **resolves to one healthy split**:

- `apps/api/src/core/modules/domain` (`CoreDomainModule`, `@Global`) = **infrastructure**:
  3 repositories, `DomainVerificationService`, `DomainConflictService`,
  `OrganizationDomainService`, `ServiceDomainMappingService`, adapter, errors, interfaces,
  and 9 design docs (ARCHITECTURE, DOMAIN-HIERARCHY, SERVICE-MAPPING, SUMMARY, …).
- `apps/api/src/modules/domain` (`DomainModule`, wired at `app.module.ts:142`) = **feature
  layer**: 3 controllers + 3 thin orchestration services (`DomainOrganizationService`,
  `DomainProjectService`, `DomainServiceService`) that **delegate to core repos/services** and
  add `ProjectAccessService` checks + the reachability gate.

**Real bug found (SC-7)**: role-union drift — `domain-project.service.ts:29` and
`domain-service.service.ts:33` pass `"admin"` to `assertProjectAccess`, but
`ProjectAccessService` only accepts `"deployer" | "maintainer" | "owner" | "viewer"`.
These are the module's only *verified remaining* type-check errors (an earlier
`project.controller.ts:121` domainConfig error is already gone). A related wart remains in
the write path: `project.service.ts:322` casts `domainConfig` through `as Parameters<…>`.

**Core service graph is live**: `OrganizationDomainService`(core) ← `domain-verification.service`;
`ServiceDomainMappingService`(core) ← `domain-conflict.service`;
`DomainVerificationService`(core) ← `modules/domain/domain-organization.service`.

### 2.4 Data model — three overlapping concepts, one live

| Concept | Table(s) | Status | Evidence |
|---|---|---|---|
| **Live domain system** | `organization_domains` → `project_domains` → `service_domain_mappings` | **Live**, no provider FK | `schema/domain.ts`; org domain has `domain`, verification fields, `metadata` jsonb |
| Per-env domain config | `environments.domainConfig` jsonb `{baseDomain,subdomain,customDomain,sslEnabled,sslCertPath}` | Written, **zero web consumers** | `schema/environment.ts:93`; written by `modules/project/services/project.service.ts:322,395` |
| Legacy traefik config | `domain_configs` + `route_configs` | **Dead** (schema + migration 0005 only) | `schema/traefik/index.ts`; zero code consumers |

Key gaps: `organization_domains` has **no `providerId`/`zoneId`** — a domain cannot be tied to
the Cloudflare account that can edit its DNS. `allowedSubdomains` on `project_domains` (array,
`"*"` = any) is the natural place subdomain constraint would flow.

### 2.5 Routing is disconnected from the domain system (the big one)

- **Routing source of truth** = per-service `traefikConfig` JSON column
  (`schema/deployment.ts:124`, built via `TraefikConfigBuilder.load(...)` in
  `modules/service/repositories/service.repository.ts:104-154`). Host rules are typed there
  (`Host(\`api.example.com\`)`, `HostRegexp(...)`).
- `service_domain_mappings` is **only** read by its own repository/adapter/interfaces and the
  `context/types` domain-mapping type. **No router, proxy, or traefik builder consumes it.**
- The `context` module's `domainMappings`/`fullUrl` is a **type definition only**; the traefik
  config-builder grep for `domainMapping|fullUrl|projectDomain` returns **nothing**.
- **Consequence**: the domain module's service binding is **aspirational** — it records intent
  ("service X is at api.example.com/v1") but nothing routes to it. The user's request #4
  ("service can use an existing provider + its domain to explain it can be reached there") is
  currently **impossible end-to-end**: providers don't enumerate zones, domains aren't tied to
  providers, and service bindings don't feed routing.

### 2.6 Docs vs code

- `docs/reachability-domain-architecture.md` documents an intended `public_reachable_url`
  (`app_config`) + `domain_verification_config` table + `GET /reachability/self-check` —
  **matching the user's reframe** and **never implemented** (the code instead grew
  `NODE_PUBLIC_IP`/`NODE_TUNNEL_MODE` and a node-network config API).
- `apps/doc/content/docs/architecture/complete-feature-inventory.mdx`:
  - `:312` "Cloudflare DNS provider (platform-managed wildcard)" — **🔴 not implemented**.
  - `:1475` "Pluggable DNS provider `IDnsProvider` interface" — **🔴**.
  - `:309-311` org registration / DNS verification / project assignment / service mapping — ✅.
  - `:314` preview subdomain auto-generation — 🟡 (name generated, **DNS record creation not wired**).
  - `:105-106` per-env domainConfig / preview settings — 🟡 "not in v3 schema".
- `PreviewNamingService` (`core/modules/deployment/services/preview-naming.service.ts`)
  builds names from `{{preview_name}}`-style URL patterns (strategies pr/branch/branch_hash/
  custom) and is used by `github-webhook-dispatch` — but never creates DNS records.

### 2.7 Web UI (current)

- **Admin domains** (`apps/web/src/app/dashboard/admin/domains/page.tsx`): gate banner
  (disabled Add Domain when `checkDomainGate.allowed === false`), "Via DNS Provider" tab with
  a `DNS_PROVIDER_CONFIG_FIELDS` registry (`:31` — the current provider-config form, itself the
  stand-in for zone enumeration: it collects zoneId/recordType/autoDns per provider type) +
  "Manual" tab, per-domain reachability checks (prefers `nodeNetwork.publicIp`), verify/list/
  delete with invalidation.
- **Cloudflare provider** (`providers/dns/cloudflare/page.tsx`): API-token form (server
  validated) + token table + a **disconnected tunnel toggle** (`useNodeNetworkConfig` →
  `{ tunnelMode: boolean }`) + install instructions.
- **System → node-config** (`components/dashboard/system/NodeNetworkConfig.tsx`): public IP
  input + tunnel toggle + gate badge.
- **Project domains**: `DomainPicker` (simple multi-select of project domains) exists.
- **Service-domain vertical: no UI exists at all.** The hooks `useAddServiceDomain`,
  `useServiceDomains`, `useAvailableDomainsForService` and the OAuth hooks
  (`useCloudflareConnectInit/OAuthInit/OAuthCallback`) are defined in `domains/*/hooks.ts`
  but have **zero call sites** in `apps/web/src`. Likewise `checkSubdomainAvailability` is
  implemented server-side and exposed in `endpoints.ts` but consumed by no hook/component.
- Type-safety warts in the domain UI (violate the repo's zero-assertion rule):
  `[projectId]/domains/page.tsx:49` `as unknown as { data?: unknown[] }`,
  `DomainPicker.tsx` `(domain: any)`, `cloudflare/page.tsx:35` `as { publicIp… }`.

### 2.8 ORPC contract status map (SC-9)

**dns-providers** (`packages/contracts/api/modules/dns-providers/contracts.ts`):

| Contract | @Implement | Web consumer | Invalidation | Status |
|---|---|---|---|---|
| `list` / `create` / `delete` | ✅ `dns-providers.controller.ts` | ✅ (`useDNSProviders`, `useCreateDNSProvider`, `useDeleteDNSProvider`) | ✅ `dnsProviderInvalidations` list/create/delete → `keys.list()` | **LIVE** |
| `cloudflareConnectInit` / `cloudflareOauthInit` / `cloudflareOauthCallback` | ✅ (controller) | ❌ hooks defined, zero call sites | ❌ | **dead UI** |
| `cloudflareListZones` / `cloudflareListRecords` / `cloudflareCheckRecord` | ✅ (stubs returning empty) | ❌ | ❌ | **STUBBED** |

**domain** (`packages/contracts/api/modules/domain/`):

| Contract | @Implement | Web consumer | Invalidation | Status |
|---|---|---|---|---|
| org `add`/`list`/`get`/`verify`/`delete` | ✅ `modules/domain` controllers | ✅ org hooks → admin domains page | ✅ `domainInvalidations` | **LIVE** |
| project `add`/`list`/`remove`/`update`/`get-available`/`get-available-for-service` | ✅ | ✅ `useProjectDomains`/`useAvailableDomains`/`DomainPicker` (+ project domains page) | partial (project/service list invalidation exists) | **LIVE (partial UI)** |
| service `add`/`list`/`remove`/`set-primary`/`update`/`check-subdomain-availability` | ✅ | ❌ hooks defined, zero call sites | service invalidation exists but unused | **dead UI** |

**reachability** (`packages/contracts/api/modules/reachability/contracts.ts`): all 8
(`check`, `getConfig`, `updateConfig`, `checkDomain`, `getPublicIp`, `getNodeNetworkConfig`,
`updateNodeNetworkConfig`, `checkDomainGate`) are @Implement-ed and consumed by web hooks;
`updateNodeNetworkConfig` invalidates `getNodeNetworkConfig` + `checkDomainGate` +
`getPublicIp` — **LIVE**.

### 2.9 What is dead vs live (one table)

| Artifact | Status |
|---|---|
| `organization_domains` / `project_domains` / `service_domain_mappings` | **LIVE** (no provider FK) |
| `environments.domainConfig` jsonb | **write-only** (zero web consumers) |
| `domain_configs` / `route_configs` (traefik) | **DEAD** (schema only) |
| `github_apps` rows as dns-providers | **LIVE but abused** (to be replaced) |
| `cloudflareListZones/ListRecords/CheckRecord` | **STUBBED** |
| service-domain + OAuth + check-subdomain-availability contracts | **dead UI** |
| `service_domain_mappings` → routing | **DISCONNECTED** (routing = per-service `traefikConfig`) |

---

## 3. Reviewed Design

### 3.1 Principle: split "node reachability" from "provider-managed domains"

Two concepts, two modules, one gate between them:

```
Node Network Config (system/node_config)         Domain Module (org → project → service)
──────────────────────────────────────          ──────────────────────────────────────
• public IP                                      • provider accounts (API tokens/OAuth)
• tunnel: { enabled, providerId,                 • provider zones (enumerable via token)
    tunnelHostname }                             • registered/verified domains
• (future) public URL / APP_URL                  • subdomain allocation (allowedSubdomains)
      │                                                  ▲
      └─────────────── checkDomainGate ───────────────────┘
     "node is reachable" (IP set OR tunnel enabled AND     "domain belongs to a provider
      tunnel.provider exists + resolves)                    we can edit DNS for"
```

### 3.2 (User #1) Tunnel flag that uses the existing provider token

**Model change** — replace the self-referential boolean with a provider-scoped reference:

```ts
// packages/contracts/api/modules/reachability/contracts.ts
// NOTE: providerId references dns_providers.id — the real table introduced in P0
// (github_apps abuse is removed in the same migration, see §3.6).
export const nodeTunnelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  providerId: z.string().uuid().nullable(),     // → dns_providers.id
  tunnelHostname: z.string().min(1).nullable(), // e.g. api.example.com (the tunnel public hostname)
}).default({ enabled: false, providerId: null, tunnelHostname: null })

export const nodeNetworkConfigSchema = z.object({
  publicIp: z.string().nullable(),
  tunnel: nodeTunnelConfigSchema,
  // tunnelConfigured: removed — it was a lie (always == tunnelMode)
})
```

**Gate change** — `checkDomainGate()` becomes provider-aware:

```ts
// reachability.service.ts
async checkDomainGate() {
  const { publicIp, tunnel } = await this.getNodeNetworkConfig()
  if (tunnel.enabled && tunnel.providerId) {
    const provider = await this.providerRepo.findById(tunnel.providerId) // dns_providers row
    if (provider?.isActive) return { allowed: true, reason: null, ... }
  }
  if (publicIp) return { allowed: true, reason: null, ... }
  return { allowed: false, reason: 'No public IP configured and no active tunnel provider.', ... }
}
```

**Migration consequence (P3)**: the new gate (`tunnel.enabled && providerId && provider.isActive`)
is stricter than today's (`tunnelMode` alone). Any existing `NODE_TUNNEL_MODE=true`
`app_config` row with no provider would silently flip the gate to blocked. Backfill:
clear stale `NODE_TUNNEL_MODE` rows (or keep a one-release fallback that treats
`tunnelMode=true` without a provider as blocked-with-a-clear-reason). Do not keep the flag
past the migration.

**Boundary compliance (important)**: `ReachabilityService` lives in `core/` and must not import
product modules. Reading provider rows from core crosses the core→product rule. Two
compliant options:
- **(A) shared repository**: extract a `NodeProviderGateway` (or `DnsProviderRepository`) into
  a shared core location both sides use (SSOT, no module import) — keeps `checkDomainGate`
  in core as a single provider-aware seam;
- **(B) gate moves product-side**: keep `checkDomainGate` thin in core (node config only)
  and have the product `DomainOrganizationService` combine it with a provider-active check.

Recommend **(A)** — it keeps one gate and makes the tunnel genuinely provider-bound. This does
not conflict with §3.6's "fold orchestration to the feature layer": the shared repo keeps the
gate in core; the feature-layer fold applies only to access checks + verification
orchestration, not to the gate itself.

**Web**: both toggles (`NodeNetworkConfig.tsx`, cloudflare page) become
"enable tunnel using provider `[select: useDNSProviders]`" + tunnel hostname field, with the
Cloudflare page pre-selecting the Cloudflare provider. Invalidation should also refresh
`dnsProviders.list` when tunnel config changes.

### 3.3 (User #2) Provider-scoped domain/subdomain creation

**Implement the zone stubs** (this is the missing core capability):

```ts
// dns-providers.controller.ts — replace the empty stubs
cloudflareListZones:   new Cloudflare({ apiToken: provider.clientSecret }).zones.list()
cloudflareListRecords: ... .zones.get(zoneId).then(z => ... ) // dns.records.list({ zone_id })
cloudflareCheckRecord: ... // dns.records.list({ name, type }) → exists/content match
```

**Schema change** — link org domains to the provider that can edit them:

```ts
// schema/domain.ts — organization_domains
+ providerId: uuid('provider_id').references(() => dnsProviders.id) // nullable (manual registration)
+ zoneId:     text('zone_id')                                      // provider's zone id (nullable)
+ metadata:   jsonb  // can carry zoneName, accountId, expiresAt
```

**Add-domain flow** becomes provider-aware:
1. Choose a **provider account** (from `useDNSProviders`) → calls `cloudflareListZones`
   (now implemented) → shows the zones that token can edit.
2. Pick a **zone** (or "Manual — no provider") → enter the **domain** (defaults to the zone;
   validated as `*.subdomainOf(zone)` for subdomains) → verification method TXT/CNAME.
3. Server-side: `addOrganizationDomain` validates that the domain is the zone itself or a
   subdomain of a zone the chosen provider actually owns (via the same zone API). A domain
   that is *not* under any provider zone is allowed only in "manual" mode (user manages DNS
   themselves).
4. **Subdomains flow into the hierarchy**: `project_domains.allowedSubdomains` is constrained
   to subdomains of the verified org domain; `service_domain_mappings` picks the concrete
   `subdomain + basePath`. Constraint is enforced through the existing, currently-unconsumed
   `checkSubdomainAvailability` contract (server implementation + `endpoints.ts` entry already
   exist — only a web hook/UI is missing). `DomainConflictService` already handles collisions.

**Contract additions**: `addOrganizationDomain` input gains `providerId?`, `zoneId?`;
the response gains `provider`, `zone`. Web domain page renders the zone picker and shows only
provider-owned zone options.

### 3.4 (User #3) Verdict on the reframe — "domain = accessible domain/IP for this node"

As stated in §1, the verdict is **partial adoption**: split "where the node is reachable"
(node network config) from "what domains the platform may manage DNS for" (domain module),
and join them at `checkDomainGate`. Concretely:

- ✅ **Adopt**: node reachability (public IP, tunnel provider+hostname, future `publicUrl`/`APP_URL`)
  belongs in **system/node_config** as the `NodeNetworkConfig` — it is a *node* property. The
  documented `public_reachable_url` concept and the mesh `nodeServerUrl` (mesh-identity.service
  resolveLocalServerUrl priority: `nodeServerUrl` → `APP_URL` → localhost) should eventually
  unify into one "where is this node" answer.
- ❌ **Reject the collapse**: registered domains / provider zones are **not** a node property —
  they are account-level ("this Cloudflare account can edit example.com"), multi-org by design
  (DOMAIN-HIERARCHY.md), and must stay in the domain module.
- **The seam**: `checkDomainGate` is precisely the join — node reachability *prerequisites*
  domain creation. Keep them separate, gate them together.

### 3.5 (User #4) Domain system alongside projects & services — make it real

The missing link is **routing consumption**. Today `service_domain_mappings` is written but
nothing routes from it (`traefikConfig` on `services` is the real router config and is
independent). The design:

1. **Service binding** stays in `service_domain_mappings` (`serviceId` +
   `projectDomainId` + `subdomain` + `basePath` + ssl) — this *declares* the service's URL.
2. **Derive routing from it**: when a service's domain mapping is set, render the service's
   `traefikConfig` routers from the mapping (host = `<subdomain>.<orgDomain>` or the org domain
   for root; rule = `Host(\`…\`)` + optional `PathPrefix(\`/basePath\`)`; TLS via `sslEnabled`/
   `sslProvider`). The `TraefikConfigBuilder` + `rule-builder`/`http-router-builder`/`tls-builder`
   already exist and are perfect for this — wire a `DomainRoutingService` that translates
   mappings → traefik routers and persists into the service's `traefikConfig` column.
3. **Wildcard / previews** (`*.example.com`): `PreviewNamingService` already computes
   `{{preview_name}}.example.com`. The provider zone step gives it the *base* (`example.com`),
   and the (now implemented) zone/record APIs give it the ability to actually **create the DNS
   record** (the 🟡 gap). So: preview deploy → compute name → upsert DNS record on the
   provider's zone → set the service router → reachable.
4. **"Previous deployment" reachability**: deployments are versioned (`deployment.service.ts`,
   rollback exists). Represent each deployment's URLs in the deployment record (computed from
   the mappings at deploy time) so the UI can show "current: api.example.com/v1 · previous:
   api.example.com/v2". This needs only a new `urlsSnapshot` column on the deployment row
   (a small, additive migration; grounding: `schema/deployment.ts` currently has no URL
   field). Clarify at implementation time which scope "previous" means (per service vs per
   environment — recommend per-service, snapshotting its mappings at each deploy).

### 3.6 Convergence & cleanup (SC-7/SC-8)

1. **Fix the role drift**: `"admin"` → the current roles union in both services (tiny, unblocks
   the module's type-check).
2. **Keep the layering** (core infra + feature orchestration) — it is correct; do not delete
   either module. Fold the two org-domain facades (`OrganizationDomainService` core vs
   `DomainOrganizationService` feature) so orchestration (access checks, verification, provider
   validation) lives in the feature layer only — the provider-aware gate stays in core via the
   shared repo (see §3.2).
3. **Drop dead weight**: `domain_configs` + `route_configs` (no consumers) and either wire or
   remove `environments.domainConfig` (currently write-only). No bridges — delete or complete.
   Also remove the `as Parameters<…>` cast at `project.service.ts:322` in the same change set.
4. **Stop abusing `github_apps`**: add a real `dns_providers` table (id, providerType, name,
   encrypted credentials, isActive, createdAt) and migrate rows; remove the `as unknown as`
   casts. **This is a prerequisite for the provider FK on `organization_domains` and for the
   tunnel `providerId` — all design FKs point at `dns_providers.id`.** Because this phase
   replaces the read/write path, it must include the controller read-side switch
   (`dns-providers.controller.ts` list/create/delete/OAuth reads) in the SAME change set as
   the table — otherwise provider CRUD reads a table whose data was migrated away (violates
   the atomic-change rule).

---

## 4. Dependency-Ordered Implementation Plan

| Phase | Change | Files (primary) | Depends on |
|---|---|---|---|
| P0 | Fix role drift; add `dns_providers` table; **migrate github_apps rows AND switch the controller read/write path** (atomic — no interim broken state) | `domain-project.service.ts`, `domain-service.service.ts`, `schema/` (new table + migration), `dns-providers.controller.ts` | — |
| P1 | Implement Cloudflare zone/record stubs | `dns-providers.controller.ts` | P0 (real table) |
| P2 | Node tunnel → provider ref + provider-aware gate (shared repo option A); backfill stale `NODE_TUNNEL_MODE` | `contracts.ts` (reachability), `reachability.service.ts`, new shared provider repo | P0 |
| P3 | `organization_domains.providerId/zoneId` + provider-scoped add-domain | `schema/domain.ts`, `domain-organization.service.ts`, `organization/add.ts` contract, org domain repo | P1, P2 |
| P4 | Web: zone picker in domains page, tunnel "use provider X" in cloudflare + node-config | `domains/page.tsx`, `cloudflare/page.tsx`, `NodeNetworkConfig.tsx`, `dns-providers/{endpoints,hooks}` | P1-P3 |
| P5 | Routing from mappings: `DomainRoutingService` → traefik routers; preview DNS creation; wire `checkSubdomainAvailability` hook + service-domain UI | new service, `PreviewNamingService`/webhook, deployment `urlsSnapshot` | P1, P3 |
| P6 | Cleanup: drop dead tables or complete `domainConfig`, unify node URL (publicUrl/APP_URL), remove `project.service.ts:322` cast | migrations, `environment.ts`, reachability | P2, P3 |

Each phase is atomic (contracts → API → web → docs in the same change set, per
`copilot-instructions.md`); P0 is explicitly one atomic change because it moves both the
schema and the controller.

### Implementation status (2026-08-02)

Tier 1 of the enhancement catalog is **implemented** (see `docs/domain-enhancement-catalog.md`
§9): `DomainRoutingService` (mappings → traefik routes + `~##domain##~` variable resolution),
deployment `domainUrl`/`healthCheckUrl` written from the primary mapping at deploy time, and
`PreviewProvisioningService` (DNS + route + preview record, host derived from the service's
primary domain — no `.local`, no env vars). Per explicit user direction, the per-environment
domain config (G2/G3) is **out of scope** and **no domain value is sourced from environment
variables anywhere**. Remaining: A3 (previous-deployment URL snapshot), A4/A5 (health-probe +
route/tls provision executors), B3/B4/B5 (preview lifecycle UI/cleanup/promote), and the
P0/P6 cleanup (real `dns_providers` table, drop dead tables).

---

## 5. Evidence Map

| Claim | Evidence |
|---|---|
| Tunnel flag disconnected from provider | `reachability.service.ts:8-9,37-51,53-61,83-99`; `contracts.ts:53-62` |
| `tunnelConfigured` self-referential | `reachability.service.ts:58` |
| Token stored in `github_apps` via casts | `dns-providers.controller.ts:62-87` |
| Zone stubs empty | `dns-providers.controller.ts:257-289` |
| Domain layering (core infra + feature orchestration) | `core/modules/domain/domain.module.ts`, `modules/domain/domain.module.ts`, `app.module.ts:142` |
| Role drift bug | `domain-project.service.ts:29`, `domain-service.service.ts:33` |
| 3-tier live schema, no provider FK | `schema/domain.ts` |
| env `domainConfig` write-only | `schema/environment.ts:93`, `project.service.ts:322,395` (zero web consumers) |
| `domain_configs`/`route_configs` dead | `schema/traefik/index.ts` (zero code consumers) |
| Routing = per-service `traefikConfig`, not mappings | `schema/deployment.ts:124`, `service.repository.ts:104-154`; no traefik consumer of `service_domain_mappings` |
| Documented `public_reachable_url` never implemented | `docs/reachability-domain-architecture.md` |
| 🔴/🟡 inventory gaps | `complete-feature-inventory.mdx:312,1475,314,105-106` |
| Preview naming exists, DNS creation not wired | `preview-naming.service.ts`, `github-webhook-dispatch.service.ts:77` |
| Mesh node URL concept exists | `mesh-identity.service.ts:71-88` |

## 6. Confidence & Gaps

- **Confidence**: High on the disconnected tunnel, github_apps abuse, zone stubs, role drift,
  dead tables, the routing disconnection, and the dead-UI contracts (service-domain, OAuth,
  check-subdomain-availability — zero call sites verified) — all confirmed by direct file
  reads/greps.
- **Medium**: Cloudflare SDK tunnel/zone method availability (SDK typings not exhaustively
  audited — design assumes `zones.list`/`dns.records.list` and tunnel APIs, standard in SDK v7).
- **Unknowns**:
  - OAuth token expiry/refresh behavior (no refresh handling in code).
  - Exact intended scope of the unbuilt `domain_verification_config` table from the docs.
  - Cloudflare Tunnel API server-side capabilities via the SDK (hostname creation/listing)
    beyond the assumptions in §3.2 — verify against `node_modules/cloudflare` typings during P1.
  - Which storage the node URL unify (P6) should target: `app_config` (global DB) vs
    `node_config` (local SQLite) — design keeps today's `app_config` storage and does NOT
    move to `node_config` (that store is the bootstrap/setup store with no reachability
    field); the `nodeServerUrl`/`APP_URL` mesh chain stays authoritative for mesh URLs.
