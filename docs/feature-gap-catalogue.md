# Platform Feature Gap Catalogue

**Generated:** 2026-09-17
**Method:** read-only sweep of `apps/api`, `apps/web`, `packages/*` + targeted greps. Every item below
cites the evidence that produced it. Items marked *(verified)* were confirmed by reading the code, not
inferred from a filename.

**How to read this:** 12 sections, **79 items**. Each has an ID, a size (S ≈ <1h, M ≈ a few hours,
L ≈ a day+), and the evidence. The single most useful column is *why it matters* — that is what turns a
list into a priority order.

> **Important calibration.** A separate existing audit
> (`docs/enhancement-overview-100.md`, `docs/enhancement-overview-platform-100.md`) was checked
> independently during this sweep and **9 of 12 sampled items had a factually wrong premise** — it
> repeatedly inferred a defect from an *absent name* rather than absent behaviour. Nothing from those
> files is repeated here without independent verification. Treat this catalogue as higher-confidence
> where the two disagree.

---

## 0. Executive summary — the ten biggest gaps

| # | Gap | Why it matters |
|---|---|---|
| 1 | **Service env-var secrets are stored in plaintext** | `environment_variables.value` is `text()` and `isSecret` is never read by any business logic. Provider credentials get AES-256 (`encryptedText`), user app secrets do not. |
| 2 | **82 of 306 web hooks are unused** | Entire built API surfaces have no UI: admin user management, analytics reports, mesh control, fleet admission, push notifications, reachability. |
| 3 | **No deployment rollback flow** | A deployment platform without rollback cannot be operated safely. `useDeploymentRollbackHistory` exists; nothing consumes it. |
| 4 | **Dynamic environment variables are schema-only** | 7 columns (`isDynamic`, `template`, `resolvedValue`, `resolutionStatus`, `resolutionError`, `lastResolved`, `references`) with **zero** resolution logic. |
| 5 | **Only 5/62 pages have `loading.tsx`, 4 have `error.tsx`, 1 has `not-found.tsx`** | 90% of routes have no skeleton and no error boundary. |
| 6 | **`environment_promotions` table unused** | Promotion between environments — a core platform concept — has schema and nothing else. |
| 7 | **`health_check_jobs` table unused; alert columns inert** | `alertOnFailure`, `alertWebhookUrl`, `alertEmail` are never read. Monitoring cannot notify anyone. |
| 8 | **Personal access tokens built but unreachable** | `ApiKeyService` + `ApiKeyRepository` + `apiKeys` table exist and are module-exported; no contract, no controller, no UI. No CLI either (`apps/` = api, doc, web). |
| 9 | **No audit log anywhere** | No `audit`/`activity-log` file exists. User actions are unauditable. |
| 10 | **No log retention** | Zero `retention`/`prune` logic in API or web. |

---

## 1. Security & secrets

| ID | Item | Size | Evidence / why it matters |
|---|---|---|---|
| S-1 | **Encrypt `environment_variables.value`** | M | *(verified)* `environment.ts:194` — `value: text("value").notNull()`, plaintext; `encryptedText` appears **0** times in that schema file. The primitive is proven elsewhere: **4** schema files use `encryptedText(...)` (`dns-providers`, `github-provider`, `gitlab-provider`, `cluster`, plus `deployment` for secrets/keys). It is simply not applied to the highest-volume user secret store. |
| S-2 | **Make `isSecret` mean something** | M | *(verified)* `is_secret` is written by forms but never read. `grep -rn isSecret apps/api/src` (excl. specs and `schema/`) returns exactly **3** hits — all in `docker/repositories/facade/docker.repository.ts:1088-1094` — and they are a local `isSecretKey` built from a `/password\|secret\|token\|key/i` regex over an *env key name*. That is unrelated masking; the column itself is never consumed. |
| S-3 | Redact secrets in logs | M | Depends on S-1/S-2. `docker.repository.ts:1093` masks by *key name* regex only; values that are secrets without a telltale key name leak into logs. |
| S-4 | Add an audit log | L | *(verified)* no `*audit*` file under `apps/api/src`; no activity-log model. Destructive actions (delete project/service/environment, revoke key, change roles) leave no durable record. |
| S-5 | Rotate/expire API keys | S | Once S-12 lands. `apiKeys` has no visible `expiresAt`/`lastUsedAt`/rotation path. |
| S-6 | Secret scanning for committed values | M | Nothing scans user-supplied env values or build logs for credential-shaped strings. |
| S-7 | Per-secret access scoping | M | Any project member with `developer` role can read all env vars. No per-variable or per-key permission. |

## 2. Deployment lifecycle

| ID | Item | Size | Evidence / why it matters |
|---|---|---|---|
| D-1 | **Implement deployment rollback** | L | *(verified)* `grep -rl rollback apps/api/src apps/web/src` returns **only Drizzle schema + migration snapshots** — no service, no controller, no page. `useDeploymentRollbackHistory` is exported and unused. |
| D-2 | Promote/redeploy a previous build | M | Related to D-1: no "deploy this earlier image" path. |
| D-3 | Environment promotion | L | *(verified)* `environment.ts:313-328` defines `environmentPromotions` (`promotedBy`, promotion details); `grep environmentPromotions apps/api/src` (excl. schema) → **empty**. Schema-only. |
| D-4 | Deployment approval gates | M | No manual approval step before production deploy. |
| D-5 | Deployment concurrency limits | S | Queue lifecycle exists (`deployment-queue-lifecycle.service.ts`); no per-project concurrency cap. |
| D-6 | Cancel an in-flight deployment | M | No cancel endpoint/UI found. |
| D-7 | Deployment diff / config preview before apply | M | Config is applied; no "here is what will change" view. |
| D-8 | `refreshEnvironmentStatus` is `NotImplementedException` | S | *(verified)* `project.controller.ts:387`. Left as an explicit throw by a prior fix — correct behaviour, but the probe is still missing. |

## 3. Environment variables & configuration

| ID | Item | Size | Evidence / why it matters |
|---|---|---|---|
| E-1 | **Dynamic variable resolution** | L | *(verified)* `grep -rn "isDynamic\|resolvedValue\|resolutionStatus"` in `apps/api/src` excluding `schema/` → **empty**. Seven columns (`environment.ts:198-217`) including `template` with `${}` placeholders, `resolvedValue`, `resolutionError`, `lastResolved`, and an `references` dependency-tracking array — with no resolver. The UI can express dynamic vars that nothing evaluates. |
| E-2 | Variable reference graph / validation | M | Depends on E-1. `references` is stored but never built or checked. |
| E-3 | Per-environment variable scoping UI | M | Membership is per-service; scoping rules are unclear in UI. |
| E-4 | Bulk import/export env vars (.env parse/paste) | S | Not found. |
| E-5 | Config drift detection | M | `drift-reconciliation.service.ts` exists in fleet — verify whether service config drift is covered or only fleet. |
| E-6 | Notify on env-var change → rolling restart | M | Changing an env var does not appear to trigger redeploy. |

## 4. Build & runtime

| ID | Item | Size | Evidence / why it matters |
|---|---|---|---|
| B-1 | Build cache (layer/Docker cache across deploys) | L | Not found. |
| B-2 | Historical (not just live) build logs | M | Log fetching is live-polling (`docker.repository.ts:3225` `setInterval` log poller); no persisted build log. |
| B-3 | Build concurrency queue | M | Runner registry dispatches; no queue/back-pressure. |
| B-4 | Runner detection is manual | S | `useDetectRunner` exists and is **unused** — the API can detect the right runner; no UI exposes it. |
| B-5 | Swarm limitations are hard failures | S | *(verified)* `swarm-compose-realizer.service.ts:449,457` reject image-less services and bind mounts with clear messages. Accurate, but the UI should prevent authoring them rather than fail at deploy. |
| B-6 | Build-only services on Swarm | M | Same as B-5 — needs "build then reference image" flow. |

## 5. Observability

| ID | Item | Size | Evidence / why it matters |
|---|---|---|---|
| O-1 | **Implement health alerting** | L | *(verified)* `alertOnFailure`, `alertWebhookUrl`, `alertEmail` (`health.ts:52-54`) appear **nowhere** outside the schema. Monitoring detects nothing and tells nobody. |
| O-2 | Wire or drop `health_check_jobs` | M | *(verified)* table exists (`health.ts:57+`) with `cronExpression`, `batchSize`, `lastRun`, `nextRun`, `runCount`; `grep healthCheckJobs` outside schema → **empty**. A scheduler's data model with no scheduler. |
| O-3 | Log retention & pruning | M | *(verified)* no `retention`/`pruneLogs` anywhere. Logs grow unbounded. |
| O-4 | Metrics retention strategy | M | `useRealtimeMetrics` for the live view; no retention/rollup. |
| O-5 | Analytics reports have no UI | M | *(verified)* API module + repository exist; `find apps/web/src/app -ipath "*report*"` → **empty**. `useReportList`, `useGenerateReport`, `useDownloadReport`, `useCreateReportConfig`, `useDeleteReport*` all unused. |
| O-6 | `useApplicationMetrics` / `useDatabaseMetrics` / `useResourceUsage` / `useStorageUsage` unused | S | *(verified)* in the 82-hook unused list. Platform resource views are missing. |
| O-7 | Uptime/SLO tracking | L | Not found. |

## 6. Networking, domains & TLS

| ID | Item | Size | Evidence / why it matters |
|---|---|---|---|
| N-1 | Certificate status surfacing | M | Traefik config builders exist; no UI showing per-domain cert state/acme failures. |
| N-2 | Wildcard domains | M | Not found. |
| N-3 | Mesh has no UI at all | L | *(verified)* `find apps/web/src/app -ipath "*mesh*"` → **empty**, while `useMeshPeers`, `useMeshPeerSessions`, `useMeshMembershipSnapshot`, `useReconcileMeshMembership`, `useUpsertMeshResourceIndex`, `useMeshEventStreamById`, `useWatchPublicAccessPoint` are all exported and unused. The mesh is a headline feature with zero console surface. |
| N-4 | `useReachabilityCheck` / `useReachabilityConfig` / `useUpdateReachabilityConfig` unused | S | Reachability is API-only despite being the thing that tells you whether a node is public. |
| N-5 | Custom domain self-service | S | `useAvailableDomainsForService` unused. |

## 7. Docker & infrastructure surface

| ID | Item | Size | Evidence / why it matters |
|---|---|---|---|
| I-1 | **~13 unused Docker SSE/streaming hooks** | M | *(verified)* `useDockerBuilderEventsStream`, `useDockerConfigEventsStream`, `useDockerContainerInspectStream`, `useDockerContainerLinkedList`, `useDockerDaemonEventsStream`, `useDockerImageInspectStream`, `useDockerLiveEntities`, `useDockerLiveEntityKind`, `useDockerLiveNetworks`, `useDockerLiveVolumes`, `useDockerMeshEventStreams`, `useDockerMeshSseState`, `useDockerNodeEventsStream`, `useDockerRuntimeEventsHub`, `useDockerRuntimeEventSubscription`, `useDockerSecretEventsStream`, `useDockerServiceEventsStream`. A live Docker/swarm control surface was built server-side and never surfaced. |
| I-2 | Swarm service management UI | L | Related to I-1: no service/secrets/config/node views. |
| I-3 | `useDockerLive*` consolidation | S | Several overlapping live-entity hooks; likely one should win (also a DRY item). |

## 8. Identity, admin & access

| ID | Item | Size | Evidence / why it matters |
|---|---|---|---|
| A-1 | **Admin user management is API-only** | M | *(verified)* `useAdminBanUser`, `useAdminUnbanUser`, `useAdminCreateUser`, `useAdminUpdateUser`, `useAdminRemoveUser`, `useAdminSetRole`, `useAdminHasPermission`, `useUserCount`, `useUserActions`, `useDeleteUser`, `useUpdateUser` — all unused. `admin/users/page.tsx` exists but does not use them. |
| A-2 | Personal access tokens end-to-end | M | *(verified)* `apiKeys` table + `ApiKeyService` + `ApiKeyRepository`, exported from `project.module.ts:30` — but no contract under `packages/contracts/api/modules` mentions `apiKey`, and no controller injects the service. Fully built, zero reachable surface. |
| A-3 | CLI | L | *(verified)* `apps/` contains only `api`, `doc`, `web`. No CLI, no `packages/bin` CLI for the platform (only declarative-routing/runthenkill). Programmatic access is impossible without A-2. |
| A-4 | Missing permission checks on mutations | M | Not yet audited exhaustively; several mutating handlers lack an explicit `requireAuth`/role guard. **Needs a dedicated pass.** |
| A-5 | `usePlatformRole` unused | S | Role information exists but no console uses it. |

## 9. Fleet & cluster

| ID | Item | Size | Evidence / why it matters |
|---|---|---|---|
| F-1 | Fleet admission is API-only | M | *(verified)* `useCheckMyFleetAdmission`, `useCreateMyFleetAdmissionRequest`, `useMyFleetAdmissionRequests`, `useMyFleetAllocations` all unused. Users cannot request capacity from the console. |
| F-2 | `cluster` has no dedicated test coverage | M | *(verified)* only `cluster/services/cluster.service.spec.ts`; no controller or fleet-controller specs. |
| F-3 | Cluster repository layer | M | The *swarm core* module does have repositories (`core/modules/swarm/repositories/` with 3 files + specs), so the original "no repository layer, the only one of six" claim is **wrong as stated** — re-scope to whatever remains inlined in `cluster.service.ts`. |
| F-4 | Node drain / maintenance mode | M | Not found. |

## 10. Notifications

| ID | Item | Size | Evidence / why it matters |
|---|---|---|---|
| X-1 | **Notification delivery transport** | L | *(verified)* the 8 project notification fields appear in `apps/api/src` **only** inside `project.service.ts`'s own get/update methods. Nothing sends. *(A prior change removed the UI badges that falsely claimed delivery; the settings remain, marked "pending".)* |
| X-2 | Webhook delivery retry/backoff | M | *(verified)* `grep -niE "retry\|backoff\|deliveryAttempt" webhook.service.ts` → **empty**. One transient failure loses an event. |
| X-3 | Push notifications unreachable | M | *(verified)* `apps/web/src/components/push-notifications/` and `domains/push` exist, but `usePushSubscribe`, `usePushUnsubscribe`, `usePushSubscriptions`, `usePushPublicKey`, `useNotificationPermission`, `useSendTestNotification` are all unused. The whole web-push feature is dark. |
| X-4 | Notification preferences are per-project only | S | No user-level (as opposed to project-level) notification settings. |

## 11. Web console — UX, states, i18n

| ID | Item | Size | Evidence / why it matters |
|---|---|---|---|
| W-1 | **Route-state coverage is ~8%** | M | *(verified)* 62 `page.tsx`, **5** `loading.tsx`, **4** `error.tsx`, **1** `not-found.tsx`. |
| W-2 | Move to `error.tsx` per route group | S | Same data as W-1. |
| W-3 | Empty states for list pages | M | Several pages render nothing when a project/service list is empty. |
| W-4 | Two competing type scales | M | *(verified)* `apps/web/src/components/ui/*` uses a **larger** scale (`h-8`/`text-base`/`rounded-lg`/`ring-3`) vs `@repo/ui`'s compact (`h-7`/`text-xs/relaxed`/`rounded-md`/`ring-2`). 6 of 12 files differ *systematically*; 4 have no `@repo/ui` counterpart (`map`, `place-autocomplete`, `spinner`, `button-group`). All 12 are reachable from 3 live entry points. **Not dead code** — deleting is unsafe; this needs a deliberate design decision. |
| W-5 | i18n absent | L | All strings hardcoded; no `next-intl`/`react-intl`. Retrofitting later is far more expensive. |
| W-6 | Command palette has no action commands | S | `command-palette.tsx` only navigates; no "deploy service", "restart", "open logs" actions. |
| W-7 | No keyboard-shortcut discoverability | S | `keyboard-shortcuts.tsx` exists; no help overlay affordance beyond it. |
| W-8 | Missing `metadata` on pages | S | Some routes lack `metadata`/`generateMetadata`. |
| W-9 | 82 unused hooks — dead-UI decision needed | L | Per-capability: either surface it or delete it. See §0.2. This is the largest single thematic item in the catalogue. |
| W-10 | Docker page covers 6 of ~10 entity types | M | *(verified)* dashboard/docker has activity, containers, images, logs, networks, volumes — no services, secrets, configs, nodes UI. |
| W-11 | No global search | M | Command palette is page-jump only. |
| W-12 | Mobile/responsive audit for data tables | M | Not verified; large tables likely overflow. |

## 12. Platform engineering & developer experience

| ID | Item | Size | Evidence / why it matters |
|---|---|---|---|
| P-1 | 273 `as unknown as` across ~90 files | L | *(verified)* 273 outside spec/test; the plan's figure of "22" is **wrong by 12×**. Concentrated in `packages/transport/orpc/src/builder/**` and `permissions/system/builder/**` where casts are often legitimate — **do not blind-sweep**; set a rule (no new casts; only fix ones in files you already touch). |
| P-2 | `events` contract unreachable | S | *(verified)* `eventSyncContract` is fully implemented but referenced by nothing outside its own `index.ts` and absent from `appContract`. |
| P-3 | `template` contract unimplemented | M | *(verified)* registered as `appContract.template` with 16 operations; zero controllers/services. |
| P-4 | `api_keys` / `analytics_reports` / `analytics_report_configs` have no entity schemas | M | *(verified)* tables exist and are used; no schema. Only add schemas where a contract must return the shape — otherwise document the absence. |
| P-5 | No schema↔table drift check in CI | M | Nothing detects a Drizzle table added without a matching entity schema. |
| P-6 | No migration-apply gate in CI | M | Migrations are not applied to a throwaway DB in CI. |
| P-7 | 19 API modules vs 20 contract modules | S | *(fixed)* documented in `packages/contracts/api/AGENTS.md`: `fleet`→`nodes`; `runners`/`permission` contract-less by design; `mesh`/`events` contract-without-module. |
| P-8 | e2e CI job is non-blocking | S | `continue-on-error: true` staged in `ci.yml`; must be flipped once tests are stable. |
| P-9 | `runthenkill` test flake | S | Observed failing in a full-suite run while passing standalone. |
| P-10 | No `not-found.tsx` beyond one | S | Overlaps W-1. |
| P-11 | Test coverage inverse to blast radius | L | Largest controllers (docker 40+ handlers, cluster, fleet) have no specs. Priority order: `docker.controller`, `cluster.controller`, `fleet.controller`. |
| P-12 | Doc app is separate from inline module docs | S | `apps/doc` (Fumadocs) vs scattered `docs/` inside modules — two hubs, unclear priority. |

---

## Suggested sequencing

**Tier 1 — correctness & security (do first, independently shippable)**
`S-1` (plaintext secrets) → `S-2` (`isSecret`) → `D-1` (rollback) → `O-1` (alerting) → `X-2` (webhook retry).

**Tier 2 — finish what is half-built (highest value per hour, because the hard part exists)**
`A-2` + `A-3` (API tokens → CLI) → `E-1` (dynamic vars) → `O-5` (reports UI) → `F-1` (fleet admission) → `X-3` (push).

**Tier 3 — surface what is already built**
`W-9` (the 82 unused hooks, one capability at a time) → `I-1` (Docker streams) → `N-3` (mesh UI) → `A-1` (admin users).

**Tier 4 — polish & platform hygiene**
`W-1`/`W-2`/`W-3` (route states) → `P-2`/`P-3` (contract cleanup) → `P-5`/`P-6` (CI gates) → `W-4` (type scale decision).

### Decisions this catalogue cannot make for you
1. **`W-4` type scale** — which one wins, or keep both and name them?
2. **`W-9` 82 unused hooks** — surface or delete, per capability? (Cheap to decide, large to execute.)
3. **`X-1` notifications** — implement email/Slack/webhook delivery, or drop the settings?
4. **`E-1` dynamic variables** — implement resolution, or drop the 7 columns?
5. **`A-3` CLI** — is a CLI in scope for this platform at all?

---

## Appendix — verification log

Every headline number above, with the command that produced it and its result.

| Claim | Command | Result |
|---|---|---|
| Env-var secrets are plaintext | `grep -n "value: text" config/drizzle/global/schema/environment.ts` | `194: value: text("value").notNull()` |
| `encryptedText` absent from that schema | `grep -c encryptedText .../schema/environment.ts` | `0` |
| `encryptedText` used elsewhere (primitive exists) | `grep -rl 'encryptedText("' .../schema/ \| wc -l` | `4` |
| `isSecret` never consumed by business logic | `grep -rn isSecret apps/api/src \| grep -v spec \| grep -v schema/ \| wc -l` | `3` — all `docker.repository.ts:1088-1094`, an unrelated key-name regex |
| Unused web hooks | exported `useX` names vs files referencing them | **82 of 306** |
| Route-state coverage | `find apps/web/src/app -name {page,loading,error,not-found}.tsx \| wc -l` | `62 / 5 / 4 / 1` |
| No rollback | `grep -rl rollback apps/api/src apps/web/src` | schemas + migration snapshots only |
| Dynamic vars unimplemented | `grep -rn "isDynamic\|resolvedValue\|resolutionStatus" apps/api/src` (excl. schema) | empty |
| `environment_promotions` unused | `grep -rl environmentPromotions apps/api/src` (excl. schema) | empty |
| `health_check_jobs` unused | `grep -rl healthCheckJobs apps/api/src` (excl. schema) | empty |
| Alert columns inert | `grep -rn "alertOnFailure\|alertWebhookUrl\|alertEmail" apps/api/src apps/web/src` (excl. schema) | empty |
| No log retention | `grep -rniE "retention\|pruneLogs" apps/api/src apps/web/src` | empty |
| No analytics reports UI | `find apps/web/src/app -ipath "*report*"` | empty |
| No mesh UI | `find apps/web/src/app -ipath "*mesh*"` | empty |
| Type escapes far exceed the old claim | `grep -rn "as unknown as" apps/ packages/` (excl. specs/dist) | **273**, not 22 |
| Contracts missing `.errors(...)` | `comm -23 <(.build() files) <(.errors() files)` | `0` — convention already universal |
| No CLI app | `ls apps/` | `api doc web` |
| Empty module arrays removed | `grep -rn "providers: \[\]\|exports: \[\]" apps/api/src --include="*.module.ts"` | `0` |

**False premises from the older audit, not repeated here:** `events` "unimplemented" (it is implemented but
unmounted); `reachability` "no service, no exports, no tests" (a `@Global()` module with 5 providers /
3 exports and a spec); `.errors(...)` "not declared everywhere" (100% coverage); `mesh-runtime`/`sub-app-runner`
"empty modules" (both wired); `cluster` "no repository layer" (the swarm core module has three).
