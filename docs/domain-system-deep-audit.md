# Deep-Dive Audit — Misplaced Features, Duplicates & UI Wrongness (2026-08-04)

> Focused audit of "what feature does not belong where it is", duplicated
> implementations, and UI inconsistencies across the provider / domain /
> reachability surface. Each item: **finding → why it's wrong → fix (status)**.

---

## A. Fixed: GitHub manifest flow — the create-app page was BLANK

**Finding**: `manifestInit` returned `https://github.com/settings/apps/new?state=…&redirect_uri=…`
and the UI did `window.open(url)`. GitHub's manifest flow requires **POSTing the manifest
definition** to `/settings/apps/new` so the form is **pre-filled** — without it, GitHub
shows the blank manual "create a GitHub App" page (exactly what the user hit).

**Fix (applied)**:
- `manifestInit` now builds a real **manifest definition** (name, `url`, `hook_attributes`
  webhook URL → `${base}/api/github/webhook`, `redirect_url`, `callback_urls`, `public:false`,
  default events `push/pull_request/…`, default permissions `contents/metadata/pull_requests/
  checks/statuses/webhooks`) and returns `{ target, manifest }` (JSON-encoded).
- The web page now **POSTs the manifest** via a hidden auto-submitting form into a new tab
  (`form.action = target; input.name='manifest'; input.value = manifest`) — GitHub opens the
  create-app page **pre-filled**.
- Contract output extended with `target` + `manifest`.

---

## B. Duplicated / overlapping implementations (findings)

| # | Duplication | Evidence | Verdict / fix |
|---|---|---|---|
| B1 | **DNS providers stored in `github_apps`** (`organizationId: "dns-providers"`, token in `clientSecret`) | `dns-providers.controller.ts` + `dns-providers.service.ts` read/write `githubApps` | **P0 cleanup** — real `dns_providers` table (no FK abuse). Planned, not yet done. |
| B2 | **Two domain systems** — `core/modules/domain` (services/repos/errors/docs) vs `modules/domain` (controllers + thin orchestration) | `app.module.ts` wires `DomainModule` which imports `CoreDomainModule` | **Healthy layering, not a real duplicate** (core = infra, feature = orchestration). Keep. |
| B3 | **Three "domain" data concepts** — `service_domain_mappings` (live), `environments.domainConfig` jsonb (write-only), `traefik.domain_configs`/`route_configs` (dead) | grep: `domainConfig` only in `project.repository/service`; `domain_configs` zero consumers | `environments.domainConfig` + `domain_configs`/`route_configs` = **dead weight** → drop or wire (P6). |
| B4 | **Routing duplication** — per-service `traefikConfig` column vs `traefik_service_configs` + `traefik_domain_routes` tables | `service.repository.ts` writes `traefikConfig`; `TraefikRepository`/`TraefikSyncService` write tables; `DomainRoutingService` (A1) syncs tables from mappings | **Two routing sources of truth** — the domain system now derives routes into the tables (A1), but `service.traefikConfig` remains a separate hand-editable JSON. **Converge**: the tables should be the source; `traefikConfig` should be generated from them (or removed). |
| B5 | **Preview state split** — `preview_environments` table (now populated by provisioning) vs `github_preview_deployments` | `github_preview_deployments` exists in schema; previews page reads `preview_environments` via `listServicePreviews` | `github_preview_deployments` is **legacy/unused** for the UI path → audit + drop or migrate (P6). |
| B6 | **Reachability config endpoints** (`getConfig`/`updateConfig`) vs the new **PublicAccessPoint** (event-based) | both in `reachability/contracts.ts`; getConfig probes health, access point probes + relays | **Redundant** — access point supersedes config endpoints. `getConfig`/`updateConfig` are legacy; migrate UI to the access point + watch (already done for the live UI) and deprecate/remove. |
| B7 | **`getPublicIp`** (one-shot) vs access-point `address` (live) | both return the node IP | Redundant; access-point `kind:'ip'` is the live superset. Keep `getPublicIp` only if a non-reachability consumer needs it (domains page already prefers the live one). |

---

## C. UI wrongness / inconsistencies (findings)

| # | UI issue | Evidence | Fix |
|---|---|---|---|
| C1 | **GitLab page is FAKE** — "Add GitLab Account" writes to local `useState`, nothing persists | `providers/code/gitlab/page.tsx` `setItems([...prev, newItem])`, no API call | **Real backend**: GitLab provider-app CRUD contract + persistence, or remove the fake page. **Planned (E1 multi-provider).** |
| C2 | **Docker-Hub page is FAKE** — same local `useState` pattern | `providers/code/docker-hub/page.tsx` | Same as C1. |
| C3 | **GitHub page is real** (DB-backed, manifest + PAT flows) | `providers/code/github/page.tsx` + `github-apps` domain | ✅ Correct — the pattern the others should follow. |
| C4 | **Create-service wizard** — GitHub picker (real: apps → repos → runner-detect) vs GitLab/Bitbucket/container-registry (bare URL input) | `CreateServiceWizard.tsx` `GitHubProviderPicker` only for github | Extend the same picker pattern to the other providers (E1). |
| C5 | **Tunnel toggle duplicated** across 2 pages (system node-config + cloudflare page) | `NodeNetworkConfig.tsx` + `cloudflare/page.tsx` both toggle `tunnel` | Acceptable (two views of one config), but both now show live SSE status — consistent. |
| C6 | **Provider code landing** lists github/gitlab/docker-hub cards; github goes to real page, gitlab/docker-hub to fake pages | `providers/code/page.tsx` | Fix at C1/C2. |

---

## D. What's actually correct (verified, keep)

- **Domain module layering** (core infra + feature orchestration) — healthy, not a duplicate.
- **Public Access Point** — first-class, event-based (discriminated union), SSE watch — the single SSOT for node reachability.
- **Preview provisioning → `preview_environments`** — live path via `listServicePreviews`.
- **Cloudflare zone/record endpoints** — real SDK calls, graceful errors.
- **Hostname support + server-side address verification** — correct.

---

## E. Recommended order

1. **P0** — real `dns_providers` table (removes the `github_apps` abuse; gives domains a provider FK).
2. **B4** — converge routing: `traefik_service_configs`/`traefik_domain_routes` as the source; generate/remove `service.traefikConfig`.
3. **P6** — drop dead `domain_configs`/`route_configs`/`github_preview_deployments`; wire-or-drop `environments.domainConfig`.
4. **B6/B7** — deprecate `getConfig`/`updateConfig`/`getPublicIp` in favor of the access point.
5. **C1/C2/E1** — real GitLab/Docker-Hub provider apps (matching GitHub), + extend the wizard picker.
6. **B1** — done as part of P0.
