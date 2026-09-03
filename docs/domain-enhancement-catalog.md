# Domain System — Enhancement Catalog

> Companion to `docs/domain-system-deep-analysis.md`. Every opportunity to enhance the
> domain system and add features around it, discovered by a full-app survey on 2026-08-02.
> Each entry: **current state** (evidence) → **enhancement** → **value** → **effort**.
> Legend: 🔴 high-value gap · 🟡 medium · ⚪ polish.

## Implementation status (2026-08-02)

Tier 1 (A1, A2, B1/B2, G1) is **IMPLEMENTED** — see §9 below. Per explicit user direction,
the per-environment domain config goals (G2/G3) are **removed from scope** and **no domain
value anywhere is sourced from environment variables** (all derived from domain mappings /
provider zones / node network config in the DB).

**Tier 2 (H1, H2, B3) IMPLEMENTED**: service overview "Reachable at" card
(`services/[serviceId]/_components/service-reachable-urls-card.tsx`), deployment URL
columns on both the service deployments table and the global deployments dashboard
(`dashboard/deployments`), and the preview lifecycle UI backed by a new
`listServicePreviews` ORPC contract (reads `preview_environments`: Active/Expired badge,
Webhook badge, expiry countdown, branch/visits metadata, openable links). C1 (SSL toggle)
and D7 (inline subdomain availability) were **already present** in `ServiceDomainConfig`.

**Tier 3 (A3, A4, B4, F2, C2) IMPLEMENTED (2026-08-03)**:
- **A3** — every deployment now snapshots its full `reachableUrls` list (plus
  `deployedDomainUrl`) into its own `metadata` — previous deployments keep their own URLs
  ("current vs previous").
- **A4** — after a successful deploy, a best-effort external probe hits
  `<domainUrl>/health` and records `externalReachability` (status, latency) in the
  deployment metadata + a log line (never blocks deploy).
- **B4** — `PreviewTtlCleanupService` runs every 10 min, finds expired `preview_environments`
  rows and cleans them up (route deactivation + DNS record removal + row inactive) via
  `PreviewProvisioningService.expirePreview`.
- **F2** — `reachability.getConfig`/`updateConfig` are now data-driven (tunnel hostname →
  `https://…`, else public IP → `http://…`, from the node network config — **no env vars**)
  and run a real `/health` probe (`lastStatus` is a rich string; `publicUrl` nullable).
- **C2** — `ServiceDomainConfig` entry rows now show the SSL provider label
  ("Let's Encrypt" / "Custom cert" / "No SSL") alongside the SSL shield.

**Batch 4 (2026-08-03) — A5, B5, error handling, DI fix**:
- **A5** — `DomainRoutingService.provisionTlsCertificate()` is the real TLS executor:
  registers an SSL certificate record (LetsEncrypt default, `custom` supported, idempotent)
  for the primary mapped domain via `TraefikService.addSSLCertificate`; wired into the
  deployment workflow after route sync with a log line.
- **B5** — preview → stable promotion: `DomainRoutingService.promotePreviewToStable()`
  creates a permanent `service_domain_mappings` row (subdomain = preview name on the
  primary project domain), re-syncs routes, marks the preview row inactive. Exposed via
  `promoteServicePreview` ORPC contract + controller + `usePromoteServicePreview` hook +
  "Promote to stable" button on the previews page (invalidation refetches previews).
- **Cloudflare error handling** — all zone/record/check handlers now catch Cloudflare SDK
  errors (network vs auth vs rate-limit via `toCloudflareErrorMessage`) and return
  `{ zones: [], error: "…" }` instead of a 500; create throws a friendly message. Zone
  Explorer + domains-page zone picker render the error state. This is what the runtime
  `APIConnectionError` logs were showing.
- **DI fix** — `CoreReachabilityModule` now explicitly imports `GlobalDatabaseModule`
  (it only relied on `@Global()` visibility, which broke the API boot: "Nest can't resolve
  dependencies of the ReachabilityService"). E3 (Cloudflare ZoneExplorer) was already
  present and wired — verified complete.

**Cloudflare error handling — PROVEN (2026-08-03)**: `apps/api/scripts/cloudflare-zone-error-proof.ts`
(pass, `bun --bun run scripts/cloudflare-zone-error-proof.ts`) exercises the exact handler
path at runtime and confirms: (1) the real Cloudflare SDK is reachable (invalid token →
real 400 auth error, so the original `APIConnectionError` was transient); (2) the exact
`APIConnectionError("Connection error.")` from the original logs maps to
"Unable to reach Cloudflare — check this server's internet connection (or tunnel/proxy).";
(3) auth errors map to "Cloudflare rejected the API token — ..."; (4) the controller
catch-path returns `{ zones: [], error }` without throwing — no 500 possible. Live check:
`GET /dns/cloudflare/:providerId/zones` returns 401 (auth-gated, route registered), not
500/503. Note: a controller unit spec was authored but cannot run because the whole API
vitest suite fails on a pre-existing `zod/v4` resolution bug (all controller specs,
including `organization-domain.controller.spec.ts`, fail identically); the runtime proof
is the operative verification.

**app_config missing-table fix (2026-08-03)**: `POST /reachability/node-network` returned
500 with `DrizzleQueryError` on `insert into "app_config"`. Root cause: the `app_config`
table existed in the Drizzle schema but had **no migration and was absent from the dev
database** (the only schema table missing — all 87 other tables present). Reads silently
fell back (try/catch → defaults) while writes threw. Fix: created the table in the dev DB
matching the schema exactly and verified the exact upsert works; generated durable
migration `apps/api/src/config/drizzle/global/migrations/0013_rainy_imperial_guard.sql`
(contains only `CREATE TABLE app_config` + index, registered in `meta/_journal.json`) so
fresh/prod DBs get it via `db:migrate`. The `db:migrate` CLI cannot bootstrap from the
host shell (pre-existing Nest DI/env constraint — must run in the proper container/CI
context); the dev DB fix is already applied.

**Hostname support + verification (2026-08-03)**:
- **Invalidation fix** — `keys.getNodeNetworkConfig is not a function` was caused by
  `reachabilityEndpointOperations` only containing `updateNodeNetworkConfig` (the
  invalidation `keys` are built from that operations record). Added the query endpoints
  (`getNodeNetworkConfig`, `checkDomainGate`, `getPublicIp`) to the operations record so
  their keys exist.
- **Hostname accepted for the global public address** — the System → node-config field is
  now "Public IP or Hostname" (labels updated across system page, domains page, cloudflare
  page, and the server gate reason). Preview DNS records detect IP vs hostname with
  `node:net isIP` → A/AAAA for IPs, CNAME for hostnames. `checkDomainReachability` now
  resolves a hostname `expectedIp` and compares by IP intersection (so reachability checks
  are correct when the global address is a hostname).
- **Server-side verification gate** — `ReachabilityService.verifyPublicAddress(address)`
  probes the address on the node's `/mesh/ping` and `/health` endpoints (https then http)
  and `updateNodeNetworkConfig` **rejects a non-empty public address that is not reachable**
  (`BadRequestException` with a helpful reason about DNS propagation / NAT). Clearing the
  address is always allowed. UI shows "Verifying reachability…" while saving and surfaces
  the reason on failure. Proven by `apps/api/scripts/public-address-verify-proof.ts`
  (ALL PROOFS PASSED: node's own address → valid 200/5ms; bogus host → invalid with reason;
  empty → invalid without probing).

**Create-service provider selection (2026-08-03)**: the Source step now supports real
providers starting with GitHub — (1) pick the provider type, (2) pick the configured
**GitHub App** (`useGitHubApps`), (3) pick a **repository** (`useGitHubRepos`) which
auto-fills the URL/branch and **auto-detects the runner builder** (`useDetectRunner` →
`defaultRunnerForBuilder` pre-fills the runner config). When no app exists for the selected
type: destructive warning + **"Create GitHub App"** button linking to
`/dashboard/admin/providers/code/github`; when apps exist: a ghost **"Add another app"**
button to the same page. The create payload now sends the real `providerId` +
`providerConfig` (incl. new `providerAppId` added to the canonical entity schema
`githubProviderConfigSchema`) + the real `builderId` + `builderConfig` (base fields — the
entity runner schemas are `.strict()` base-only). Note: zod v4's `z.infer` collapses
discriminated unions whose members are `.extend()`ed objects, so `RunnerFormData` is
hand-written from the plain object schemas.

**GitHub provider 404s fixed + env-free URLs (2026-08-03)**:
- The contract declared 12 endpoints but the server only implemented 4 (list/create/update/
  delete) → `manifest/init`, `manifest/callback`, `self-check`, `apps/pat`, `oauth/init`,
  `oauth/callback`, `repos`, `repos/:owner/:repo/detect` all returned 404. All 8 are now
  implemented in `github-apps.controller.ts` (wired to the core `GitHubService` for repos/
  self-check/manifest/pat) and mapped (verified: all return 401 auth-gated, not 404).
- **No env-var URLs**: OAuth/manifest/self-check/Cloudflare-OAuth redirect URLs now come
  exclusively from `ReachabilityService.getNodePublicUrl()` (node-config: tunnel hostname
  or verified public IP/hostname). `requireNodePublicUrl(what)` throws and BLOCKS the
  flow when no public address is configured.
- **Full base-path preservation**: `getNodePublicUrl` and `verifyPublicAddress` no longer
  trim the path — a configured `laptop.sebille.net/3005` (or `https://example.com/base`)
  is used whole: OAuth redirects become `${base}/github/oauth/callback`,
  `${base}/api/dns/cloudflare/oauth/callback`, etc., and probes hit
  `${base}/mesh/ping` + `${base}/health`. Proven by
  `apps/api/scripts/public-url-path-proof.ts` (ALL PROOFS PASSED: `laptop.sebille.net/3005`
  preserved, `https://example.com/base` not trimmed, bare IP → http, real
  `verifyPublicAddress` probes full origin → valid).

**Public Access Point — first-class core feature via the global event system (2026-08-04)**:
- The node's public access point (IP / hostname / DNS-provider tunnel + live
  availability) is now a **first-class core service** broadcast over the **core event
  system** (`@repo/nest-events`, the same pooled event infra every domain uses), not a
  bespoke relay.
- **Event contracts** (`core/modules/reachability/events/public-access-point-event.contracts.ts`):
  a **Zod discriminated union on `kind`** (`ip | hostname | tunnel | null`) — one perfectly
  structured schema for the whole flow, exactly as requested.
- **`PublicAccessPointEventService`** extends `BasePooledEventService` (namespace
  `public-access-point`, input scoped to `node`): `emitAccessPointUpdated(state)` +
  `watchAccessPoint$()`.
- **`PublicAccessPointService`** (the first-class facade): `getAccessPoint()` = request ⇒
  live re-check (`ReachabilityService.resolveAccessPointState()` probes the node's own
  endpoints) ⇒ **emit onto the global relay** ⇒ return; `watchAccessPoint()` = subscribe to
  the relay. Injectable anywhere (`CoreReachabilityModule` is `@Global`).
- **Consumers routed through it**: preview DNS target (tunnel→CNAME / IP→A / hostname→CNAME),
  GitHub self-check + manifest init + OAuth init (require configured AND reachable),
  Cloudflare OAuth init + callback. All **block** cleanly when no reachable access point is
  configured — never env vars.
- **API**: `GET /reachability/public-access-point` (get) + `GET .../watch` (SSE observable)
  contracts + handlers; web `usePublicAccessPoint` + `useWatchPublicAccessPoint` hooks;
  invalidation includes the access point. Verified: routes mapped, 401 auth-gated, no boot
  errors, API healthy.

**SSE-first reachability UI (2026-08-04)**: every UI surface that shows the node's
reachability now uses the **SSE watch stream** so the last data is always on screen:
- New **`usePublicAccessPointLive()`** hook: opens `watchPublicAccessPoint`
  (`experimental_liveObservableOptions`) as the source of truth (every server emission
  re-renders) and falls back to the one-shot `getPublicAccessPoint` (which triggers a
  fresh server re-check + relay emit) until the stream produces.
- **System → Node Network & Reachability**: live "Public access point" card (kind/IP-vs-
  hostname/tunnel, Reachable·ms / Unreachable / Checking badges, error text).
- **Admin Domains**: expected IP for reachability checks prefers the LIVE IP-kind address;
  live status stays on screen.
- **Cloudflare page**: the tunnel card now shows a live **Reachable/Unreachable** badge
  when the access point is tunnel-kind.
- Also fixed a latent corruption from an earlier edit: `github-apps.controller.ts` had
  `GlobalinputbaseService`/`inputbase` (mangled import) that made the API crash-loop on
  boot — repaired to `GlobalDatabaseService`, and the `create` handler now inserts
  `organizationId`/`installationId` (was missing required columns → insert type error).
  API healthy (200) after the fix; access-point routes 401 auth-gated; no boot errors.

---

## A. Make routing REAL (the biggest gap)

**Finding**: `TraefikService` (`apps/api/src/core/modules/traefik/services/traefik.service.ts`)
has a complete CRUD surface — `createServiceConfiguration`, `addDomainRoute(configId,
routeConfig)`, `addSSLCertificate`, `createMiddleware`, `syncServiceConfiguration(serviceId)`.
It is consumed **only** by the docker runtime runner (deploy-time `applyRouteAndVerify` →
`syncServiceConfiguration`, `docker-runtime-runner.service.ts:372-386`) and e2e. The **domain
module never calls it** — `service_domain_mappings` still never produce routes.

| # | Enhancement | Current → After | Value | Effort |
|---|---|---|---|---|
| A1 | **DomainRoutingService**: translate `service_domain_mappings` → `TraefikService.addDomainRoute` (host `Host(sub.domain)` + `PathPrefix(basePath)` + TLS) | Mappings are declarative only → mappings actually route traffic | 🔴 Core of the whole feature | M-L |
| A2 | **Populate `deployments.domainUrl` + `healthCheckUrl`** at deploy time from resolved mappings | Columns exist (`schema/deployment.ts:194-195`), docker facade reads them, **nothing ever writes them** (`domainUrl` grep = schema + read only) → "pending-domain" in `domainRouteUpdated` event (`deployment.service.ts:2112`) | 🔴 Deployment URLs become real & linkable | M |
| A3 | **Previous-deployment reachability**: snapshot per-deployment URLs (new `urlsSnapshot` column or reuse `domainUrl` + history) | No "previous deployment" concept → UI can show current vs previous URLs per service | 🔴 User ask #4 | S-M |
| A4 | Health-check step uses `healthCheckUrl` | Health check path exists (`schema/deployment.ts:98-101`) but full URL never built → real HTTP health probe on the deployed domain | 🟡 Observability | S |
| A5 | Wire `route_provision`/`tls_provision` state-machine nodes to real executors | Nodes declared (`deployment.service.ts:1111-1134`) with labels "Provision preview route and DNS" / "Provision TLS certificate for preview domain", **no executor** → routes + TLS actually provision | 🔴 Preview plumbing | M |

> **A1 ✅ / A2 ✅ / G1 ✅ implemented 2026-08-02**: `DomainRoutingService`
> (`apps/api/src/core/modules/domain/services/domain-routing.service.ts`) resolves a
> service's URLs purely from its mappings, upserts the traefik service config + domain
> routes (no `localhost` fallback), resolves `~##domain##~` variables, and the deployment
> workflow writes the real `domainUrl` from the primary mapping. **A3/A4/A5 remain**.

---

## B. Preview environments — declared but not implemented

**Finding**: `previewEnvironments` table (`schema/deployment.ts:236-...`) is rich — `subdomain`,
`fullDomain`, `sslEnabled`, `sslCertificatePath`, `expiresAt`, `isActive`, `webhookTriggered`,
`environmentVariables`, `metadata {pullRequestUrl, branchName, lastAccessedAt, accessCount}` —
and has **ZERO code consumers**. `previewCreated/Updated/Cleaned` events are **emitted by
`github-webhook-dispatch.service.ts:90-146` but never subscribed**. Default preview URL pattern
is `"preview-pr-{{pr_number}}.preview.local"` (`:75`) — a `.local` TLD, not a real domain.

| # | Enhancement | Current → After | Value | Effort |
|---|---|---|---|---|
| B1 | **Consume preview lifecycle events**: subscribe `previewCreated/Updated/Cleaned` → create `previewEnvironments` row, create DNS record via provider (`cloudflareCreateRecord`), add traefik route, issue SSL | Events emitted into void → real preview provisioning | 🔴 | M |
| B2 | **Real preview base domain**: replace `.local` default with a provider zone (e.g. `*.preview.example.com` where `example.com` is a provider-owned zone) | `.local` placeholder → real subdomain of a configured provider zone | 🔴 User ask #4 | M |
| B3 | **Preview lifecycle UI**: active/expired status, openable link, webhook-triggered badge, access count, expiry countdown | Table has fields, no UI → fluent preview management | 🟡 | M |
| B4 | **Preview cleanup**: use `expiresAt` + existing `PreviewCleanupPolicyService` to auto-delete previews (DNS record + route + container) | Cleanup policy service exists (`core/modules/deployment/services/preview-cleanup-policy.service.ts`), not wired to expiry → auto cleanup | 🟡 | S-M |
| B5 | **Promote preview → stable**: button on a preview to promote its commit/URL into a stable domain mapping | No promotion path → one-click preview promotion | 🟡 | S |

> **B1 ✅ / B2 ✅ implemented 2026-08-02**: `PreviewProvisioningService`
> (`apps/api/src/modules/github/services/preview-provisioning.service.ts`) is called from
> the GitHub webhook dispatch after create/update/cleanup — derives the preview host from
> the service's PRIMARY domain mapping (no `.local`, no env vars), creates the DNS record
> via the provider (CNAME → tunnel hostname / A → public IP), adds a temporary traefik
> route, records the `preview_environments` row when a matching deployment exists, and
> cleans up (route deactivation + DNS record removal) on PR close/merge. **B3/B4/B5 remain**.

---

## C. SSL / certificates — surface exists, UI doesn't

**Finding**: `sslProvider`/`sslEnabled` on `service_domain_mappings` + `previewEnvironments` +
traefik SSL fields; `TraefikService.addSSLCertificate` exists (`traefik.service.ts:167-179`);
feature inventory marks SSL cert status UI 🔴. **No cert UI anywhere** (grep of service detail
pages = zero SSL references).

| # | Enhancement | Current → After | Value | Effort |
|---|---|---|---|---|
| C1 | **SSL toggle per domain entry** in `ServiceDomainConfig` (`sslEnabled`/`sslProvider` — letsencrypt/custom/none) | Fields exist on the mapping, not exposed → per-entry SSL control | 🔴 | S |
| C2 | **Cert status + expiry + renew** on service domains / admin domains | No cert surface → badge (valid/expiring/expired) + days countdown + renew button (inventory 🔴) | 🟡 | M |
| C3 | **Auto-renewal toggle** (LetsEncrypt) + cert provisioning via `TraefikService.addSSLCertificate` | No automation → auto cert lifecycle | 🟡 | M |

---

## D. Domain lifecycle & management

| # | Enhancement | Current → After | Value | Effort |
|---|---|---|---|---|
| D1 | **Per-org domains section** in admin organization page | Org domains live only in global `admin/domains` → org-scoped view/management | 🟡 | S |
| D2 | **Multi-org collaboration UI**: claim a subdomain of a domain owned by another org (the core module's `DOMAIN-HIERARCHY.md` explicitly supports orgs registering subdomains of shared roots) | Single-org only in practice → multi-org subdomain collaboration | 🟡 | M |
| D3 | **Domain expiry/registrar tracking** — `organization_domains.metadata` already types `{registrar, expiresAt, autoRenew}` | Metadata unused → expiry warnings + registrar info | ⚪ | S |
| D4 | **Re-verify + propagation timer** after auto-DNS create | Verify exists; no re-try/propagation UX → re-verify button + countdown | 🟡 | S |
| D5 | **Delete protection**: block deleting an org domain in use by a project/service | Deletion cascades (`onDelete: cascade`) → safety confirm listing dependents | 🟡 | S |
| D6 | **Primary domain UX**: `isPrimary` exists on mappings — set-primary action + badge | Exists in contract (`set-primary.ts`), thin UI → fluent primary switching | ⚪ | S |
| D7 | **Conflict warnings surfaced** (`DomainConflictService` + `SubdomainConflictError` exist) | Conflicts only surface as errors → proactive "this URL is taken by X" inline | 🟡 | S-M |

---

## E. Providers — extend beyond Cloudflare

| # | Enhancement | Current → After | Value | Effort |
|---|---|---|---|---|
| E1 | **Pluggable `IDnsProvider` interface** (inventory 🔴 `:1475`) — Route53 / Google DNS implementations behind one interface | Only Cloudflare works (Route53/Google pages are scaffolds) → multi-provider | 🟡 | L |
| E2 | **OAuth token refresh** — current callback stores `access_token`, no refresh handling | Tokens expire with no recovery → refresh flow | 🟡 | M |
| E3 | **Zone/records explorer UI** on Cloudflare page (zones → records → status, create TXT) | Zone endpoints now real; no explorer UI → full DNS visibility per account | 🟡 | M |
| E4 | **Provider account health**: `tokens.verify()` status badge + token expiry detection | Provider list shows only Active/Inactive → health + expiry warnings | ⚪ | S |

---

## F. Node reachability & tunnel

| # | Enhancement | Current → After | Value | Effort |
|---|---|---|---|---|
| F1 | **Unify "where is this node"**: `nodeNetworkConfig` (public IP + tunnel) with `public_reachable_url` (docs) + mesh `nodeServerUrl`/`APP_URL` into one answer | Three overlapping sources → one SSOT node endpoint | 🟡 | M |
| F2 | **Reachability self-check**: `getConfig`/`updateConfig` hardcode `publicUrl: NEXT_PUBLIC_API_URL`, `reachable: null` (`reachability.controller.ts:57-74`) → real probe | Stub → live self-check of the node's public URL | 🟡 | S |
| F3 | **Tunnel runtime status**: verify the tunnel is actually running (not just the flag) — probe `tunnelHostname` | Flag only → live tunnel health + "not reachable" warning | 🟡 | S-M |
| F4 | **Per-domain reachability in monitoring** — reuse `checkDomainReachability` on the service's domains | Monitoring shows replica health only → adds domain reachability status | 🟡 | S-M |

---

## G. Per-environment domain config & variables

| # | Enhancement | Current → After | Value | Effort |
|---|---|---|---|---|
| G1 | **Resolve `~##domain##~` at deploy** — `project.service.ts:739` has `// TODO: integrate with variable-resolver module`; traefik variable system exists (`variable-registry`, `variable-resolver`, `rule-builder.host('~##domain##~')`) | Variables unresolved → per-service resolved URLs injected into traefik config at deploy | 🔴 | M |
| G2 | ~~Wire or remove `environments.domainConfig` jsonb~~ (write-only, `project.service.ts:322` `as Parameters<…>` cast) | **REMOVED FROM SCOPE** by user (no per-env domains) — the write-only column itself remains as a pre-existing wart | 🟡 | M |
| G3 | ~~Per-environment URL display~~ in `configuration/environments/[environmentId]` | **REMOVED FROM SCOPE** by user (no env domains) | 🟡 | S |

> **G1 ✅ implemented 2026-08-02**: `DomainRoutingService.buildVariableMap()` resolves the
> full traefik variable context (`domain`, `subdomain`, `fullDomain`, `baseDomain`,
> `pathPrefix`, `healthCheckPath`) from the mapping-derived URL via
> `TraefikVariableResolverService` — real values, no placeholders. **G2/G3 deliberately
> not implemented** (user: "remove the goal of ENV domains, nothing should come from env
> variable").

---

## H. UX fluency across the whole app

| # | Enhancement | Current → After | Value | Effort |
|---|---|---|---|---|
| H1 | **"Reachable at" card on service overview** (`services/[serviceId]/page.tsx`) — openable links to each mapped URL + status | Domains live in network-config tab only → visible on the overview | 🔴 | S |
| H2 | **Deployments list shows the URL** (global `dashboard/deployments` + service deployments) with clickable link + health status | `domainUrl`/`healthCheckUrl` read by UI types but null → real URLs on every deployment row | 🔴 | S-M |
| H3 | **Dashboard domain summary**: verified / pending / in-use / expiring counts | No global domain visibility → admin dashboard widget | ⚪ | S |
| H4 | **Invalidation polish**: after add/verify/delete domain, refresh project-domains + service-domain config lists (partly wired) | Some stale lists after mutations → fully consistent auto-refresh | ⚪ | S |
| H5 | **Empty/loading/error states** for domains everywhere (already partly done) | Gaps remain (service domains, previews) → consistent 3-state UX | ⚪ | S |
| H6 | **`checkSubdomainAvailability` inline UX** in `ServiceDomainConfig` (live "available/taken" hint as you type) | Hook wired, plain error → proactive availability feedback | 🟡 | S |

---

## Priority summary (recommended order)

**Tier 1 — make it real** (the feature currently stops at declarative):
A1 DomainRoutingService → A2 populate `deployment.domainUrl` → B1/B2 preview events + real base domain → G1 resolve `~##domain##~`.

**Tier 2 — complete the verticals**:
A5 route/tls provision executors · B3 preview lifecycle UI · C1 SSL toggle · F2 self-check · H1 "Reachable at" card · H2 deployment URLs.

**Tier 3 — breadth & polish**:
C2/C3 cert status+renew · D1-D7 org/multi-org/expiry/conflicts · E1-E4 multi-provider/OAuth/explorer · F3/F4 tunnel+monitoring · G2/G3 env domains · H3-H6 dashboard/invalidations/states.

> Note: A1, B2, C1, G1, H1, H2 are the direct continuation of the four user asks from the
> deep analysis (tunnel→provider, provider-scoped domains, service domain config, previous
> deployment). The rest are features that make the whole application fluent around domains.
