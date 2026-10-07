# 100-Point Enhancement Overview — Deployer Console

Audited against the live v3 tree on 2026-09-15. Every point cites the file(s) that would change and the
observation that justifies it. Effort: `S` (hours), `M` (a day or two), `L` (a week+).

Items marked ⚑ were verified against source during this audit — file paths were opened and the
observation confirmed, including several that corrected an earlier, wrong reading. Unmarked items are
gaps established by a scoped negative search, or design proposals; they are not equally established and
should be re-checked before scheduling.

**Sections A–F are the web app.** **G–I are platform and engineering.** **J–Q (51–100) extend into
observability, data density, navigation, resilience, security, release workflow and platform depth.**

> **Correction note.** This document was expanded from 50 to 100 points. During that pass, five
> previously-listed items were found to be wrong or stale and were rewritten: item 1 (the hook was
> described as unused — only one of the two is), item 3 (cited a line already fixed to `?? false`),
> item 24 (an overstated site-wide failure that is partly mitigated), item 12 (claimed `window.confirm`,
> where the code uses bare `confirm`), and items 11/28 (stale line counts). Treat the ⚑ items as the
> trustworthy core.

---

## A. Information — what each page says (1–10)

The recurring failure is a page that shows the numbers it happens to have, not the variable a person
needs to act on.

**1. ⚑ Give the service Logs page real log output.** `services/[serviceId]/logs/page.tsx:132` composes
"log lines" out of deployment status strings ("Deployment failed in production"), container status
strings and a mesh state object. A page whose job is "show me what this service printed" contains none
of its output, so "why did it fail" is unanswerable from it. The file says so itself, in a `KNOWN GAP`
doc comment at L121-130. Both halves of the fix already exist: `useDeploymentLogs`
(`domains/deployment/hooks.ts:48`) is written and has **zero consumers** (it appears in the knip
baseline), and `useDockerContainerLogsSnapshot` (`domains/docker/hooks.ts:1079`) is already proven in
production at `container-detail-modal/container-detail-modal-trigger.tsx:560`. The logs page should
reuse both rather than reinvent either. `L`

**2. ⚑ The environment configuration page saves a field the API does not accept.**
`configuration/environment/page.tsx:73-77` writes `{ id, enabledEnvironments: editEnabledEnvs,
environmentVariables: envVars } as never`. `environmentVariables` is genuinely in the contract
(`packages/contracts/api/modules/service/schemas.ts:14`, entity `service.schema.ts:40`), but
**`enabledEnvironments` appears nowhere in `packages/contracts/**`** — and the `as never` suppresses the
type error that would have exposed it. Zod strips unknown keys, so the toggle is discarded, the toast
still says "Environment configuration saved", and the page reseeds from `?? ENV_NAMES` (L52, L58) on
reload. The same phantom field is read at `services/[serviceId]/page.tsx:144`. Either add
`enabledEnvironments` to the entity and the update contract, or delete it from the UI. `M`

**3. ⚑ Stop answering "which environments is this service in?" as "all four".** Four sites hardcode the
same non-answer, so environment membership is uniform everywhere it is asked. The two reads of the
phantom field from item 2 — `configuration/environment/page.tsx:52,58` and
`services/[serviceId]/page.tsx:144` — all read `?? ENV_NAMES`. Separately,
`dependencies/page.tsx:81-85` builds `graphServiceEnvironments` by assigning `[...ENV_NAMES]` to **every**
service (the code comment concedes per-service env lists are not persisted), and
`ServiceDependencyGraphPanel.tsx:504` consumes it with the same `?? [...ENV_NAMES]` fallback. The
recently-fixed contrast is worth keeping: `service-detail-layout-inner.tsx:92` now reads
`service.isActive ?? false` with a comment explaining that treating unknown as active made the first
click do the opposite of what the label promised. Same shape of bug, same fix, four sites remaining. `S`

**4. ⚑ Resolve dependency targets to names.** `monitoring/page.tsx:147` prints raw UUIDs
(`dep.targetId ?? dep.target_service_id`) under the heading "Dependency Telemetry". An operator cannot
tell which service depends on which. `S`

**5. Add a failure-reason column to the deployments table.** `deployments/page.tsx` has nine columns
and none says why a rollout failed. The logs exist; the table just never references them. `S`

**6. Reconcile the `previews` page's two sources.**
`.../services/[serviceId]/previews/page.tsx` renders the same concept twice from unrelated queries:
as cards from `useServicePreviews` (L56, the `preview_environments` read model, rendered at L128
onward) and as a table from `useDeploymentList` filtered on `environment === 'preview' || type ===
'preview'` (L53, L63-66). Nothing joins `PreviewEnvironment.id` to `Deployment.id`, so one preview can
appear as both a card and a row with different status, URL and expiry — or in one list and not the
other. `M`

**7. Rank fleet servers by headroom, not by API order.** `admin/system` lists servers as returned. The
question "where can this go" wants headroom-ascending order. `S`

**8. Add "last successful deploy" to the services table.** `services/page.tsx` shows health but not
recency — a green service deployed three weeks ago and one deployed ten minutes ago are different risk
profiles. `S`

**9. Show remaining capacity where allocation happens.** `admin/system` shows allocated CPU/memory per
server but never what remains for the *next* allocation, which is the number the Assign Capacity form
exists to answer. `S`

**10. Make cluster node degradation explainable.** `cluster/page.tsx` summarises state; the per-
condition reason lives on the node detail page, reachable only by clicking a row with no keyboard
equivalent (see item 13). `S`

---

## B. Interaction — how the console responds (11–18)

**11. ⚑ Name the strict-mode switch.** `admin/system/page.tsx:2285` renders a `Switch` bound to
`strictEnabled` whose entire accessible name is a sibling `<p>Strict mode</p>` at L2284 — a `<p>` is not
a label and is not associated with the control, so the setting that gates mesh-wide trust enforcement is
an unnamed toggle to a screen reader. `S`

**12. Replace native `confirm()` for destructive actions.** `admin/providers/code/github/page.tsx:90`
(`if (!confirm(...)) return`) and `admin/users/page.tsx:106` use the blocking browser dialog for
deletions that the copy itself calls permanent. The tell is that the sibling page already does this
properly — `admin/providers/code/gitlab/page.tsx:62,144` has a real `confirmDelete` dialog — so the code
base disagrees with itself about how to confirm an irreversible action. `S`

**13. Make cluster rows keyboard-reachable.** `cluster/page.tsx:177` navigates on `onClick` for a
`<TableRow>` with no `role`, `tabIndex` or Open link — mouse-only navigation. `S`

**14. ⚑ Finish the icon-button labelling sweep.** Fixed in five files this session (google-dns, github,
ServiceDomainConfig, domains, deployments). The `size="icon"` without `aria-label` pattern remains across
the docker modals. `S`

**15. Make the Environment filter on dependencies do something, or remove it.**
`projects/[projectId]/dependencies/page.tsx:300` renders an Environment select backed by `environment`
state (L48, `['all', ...ENV_NAMES]`). But `filteredServices` (L195-208) reads only `statusFilter` and
`searchQuery` — never `environment` — and `graphServiceEnvironments` (L82-88) assigns **every** service
to **every** `ENV_NAMES` entry, with the code comment conceding that per-service env lists are not
persisted. The value is passed on as `selectedEnvironment` (L356) but nothing can ever be excluded. `S`

**16. Persist table state across navigation.** Sort, filters, column visibility and page are local
`useState` in `deployments`, `services`, `admin/users`; returning from a detail page resets them. The
docker tables already use `useSafeQueryParamStatesFromZod` — adopt it more widely. `M`

**17. Search the things operators actually search for.** ⌘K matches pages, projects and services only.
Containers, images, deployments and nodes — the objects usually searched by id — are not indexed. `M`

**18. Confirm before discarding a dirty form.** `configuration/general/page.tsx` has two Save buttons
and no dirty-state; navigating away silently loses edits. `S`

---

## C. Accessibility (19–23)

**19. ⚑ `aria-live` is used in exactly two app components.** `components/setup/connection-status.tsx:68`
and `auth/me/_components/accounts-section.tsx:119`. Analytics refreshes, the SSE status under the strip,
and every async table load report nothing to assistive tech. A shared `<LiveRegion>` for "loaded N
results" / "connection dropped" / "N services started" is the fix — and the two existing uses show the
pattern is already understood in this codebase. `M`

**20. ⚑ Respect `prefers-reduced-motion` beyond one rule.** The only occurrence in the app is
`packages/ui/base/src/styles/globals.css:112`. `StatusDot` pulses, spinners, shimmers and progress bars
all need the guard. `S`

**21. Provide a non-visual equivalent of the topology graph.** The React Flow canvas in `cluster` and
`projects/[projectId]/dependencies` is the sole representation of the graph. A table of edges served
from the same data makes topology readable without sight. `M`

**22. Keep focus clear of the sticky header.** `dashboard/layout.tsx:63` is `sticky top-0 z-10`; in-page
anchors can land beneath it. `S`

**23. Add `aria-busy` to loading regions.** Skeletons are visual only — a screen reader reads an empty
card with no indication that content is coming. `S`

---

## D. Performance (24–28)

**24. ⚑ Audit the remaining server-side `setQueryData` session hydration.** Four server call sites stamp
the session into the query cache — `packages/auth/src/react/session/SessionHydration.tsx:99`,
`packages/routing/declarative/src/layout-wrappers/server.tsx:209,339`, and
`page-wrappers/server.tsx:413`. TanStack's `setQueryData` sets `dataUpdatedAt: Date.now()` internally,
which is non-deterministic during prerender. One site is already guarded:
`utils/providers/SessionHydrationProvider.tsx:69-73` documents the mechanism and skips hydration entirely
when no session cookie is present (the `shouldFetch: hasCookie` fast path). **Verify whether the three
`declarative-routing` call sites carry the same guard** — if they don't, they still fire during prerender
for any route they wrap. Confidence: medium, the mitigation shows the failure was understood but not
whether every path got it. `M`

**25. Extend `useDeferredValue` beyond one page.** Only `docker/containers/page.tsx:214` uses it, on the
stated rationale that SSE fires every ~200 ms. `docker/logs`, `docker/activity` and `nodes` share that
rationale. `S`

**26. Virtualise the long tables.** `docker/containers` and `deployments` render up to 300 rows of DOM.
`@tanstack/react-virtual` is already a dependency. `M`

**27. Paginate with server-side cursors.** Several tables fetch `limit: 300` then page in memory
(`admin/system` uses `limit: 100` for users) even though the contract supports `limit`/`offset`. `M`

**28. Split `admin/system/page.tsx`.** **2,550 lines**, one route, four tab panels each of which is its
own page's worth of content. The fix is `/admin/system/{fleet,mesh,directory,node}` as separate routes —
deferred this session because it changes user-visible URLs. `L`

---

## E. Feedback, errors and empty states (29–33)

**29. ⚑ `POST /mesh/trust/strict/mode` returns 500 and the UI says "Unknown error".** Reproduced this
session. The global exception filter is registered and the ORPC interceptor is wired, yet **nothing** is
logged by the domain service — no `MeshValidationError`, no `MeshAuthorizationError`, no stack — which is
the anomaly. Missing `.errors(meshDomainErrorContracts(e))` declarations were added to both strict-mode
contracts (correct in itself; only 2 of ~30 mesh contracts had them) but did **not** fix the 500. Next
step: instrument the ORPC handler path. `M`

**30. ⚑ Reuse tunnels on 409/1013 instead of failing.** Fixed this session in
`cloudflare-tunnel.service.ts` — `createTunnel` now looks the name up first, because a partial failure
left an orphan whose id was never stored and every retry collided. Check the same hole doesn't exist for
CNAME creation. `S`

**31. Make every failure name the operation and the reason.** `handleToggleStrictMode` falls back to
`'Unknown error'`; so do several other handlers. The typed-error helpers exist
(`isDefinedORPCError`, `getErrorMessage`) — the gap is contracts that don't declare their errors. `M`

**32. Finish the empty-state audit.** Good ones exist (`EmptyState` with an action). Still bare:
`configuration/network/page.tsx:324` ("No project domains registered yet."), `network` ("No records
found in this zone (or provider is unreachable)" — two different causes behind one sentence), `logs`. `M`

**33. Distinguish "no data" from "no data source".** `DataSourceBadge` renders `unavailable` in
analytics, but several charts show "No resource data available for this time range" for both an empty
window and a dead source. `S`

---

## F. Copy and vocabulary (34–36)

**34. ⚑ Stop showing database enums to operators.** Corrected for allocation mode this session
(`shared_slice` → "Shared slice — share the node"). Remaining: `admin/system` prints raw
`lifecycleState`, and several tables render `snake_case` statuses verbatim. `M`

**35. Keep one noun per concept through the flow.** "Retry" → "Deployment retried" is right. Elsewhere
"Resolve ownership" yields "No owner found", and "Test" yields "Connection successful". `S`

**36. Write empty states as invitations.** "No users yet." (directory tab) offers nothing to act on.
The same file already has the good pattern: "Nothing awaiting approval / New admission requests appear
here for review." `S`

---

## G. Platform — capability the docs already promise (37–44)

**37. TLS certificate management UI.** Listed in `PLATFORM_SOURCE_OF_TRUTH_TODOS.md` as a platform
capability; the console has no certificate surface at all. `StepNetwork`/`StepRunner` take a free-text
"Certificate secret" string, so an operator cannot see what exists, its expiry, or renewal state. `L`

**38. Backup and restore UI.** Promised, absent. The only trace is
`docker-volume-detail-modal.tsx:78`, where `queueMaintenance('backup' | 'restore')` enqueues a message
and calls no API — a control that reports intent and performs nothing. `L`

**39. Audit log UI.** The backend already records it (`cluster_master_history`, `core_event_logs`,
`PreviewLifecycleEventService`, `migration_applied`) and the permission model declares an `audit`
capability (`packages/auth/src/permissions/config.ts:59`). No page reads any of it;
`complete-feature-inventory.mdx:468` marks it 🔴 Planned. Highest-value missing read surface. `L`

**40. Webhook delivery log.** Promised in the readiness plan. A failing webhook is currently invisible —
no retry history, no response codes, no replay. `M`

**41. Rate limiting as configurable behaviour.** The Traefik middleware builder supports it
(`middleware-builder.ts`, `getRateLimiter`) and the platform declares it as a capability, but in
`apps/api/src` it is applied only to `registerAppInstance` and `platform/orpc/middlewares.ts`. Auth
sign-in, setup, webhooks and probes have none, and no UI exposes per-service limits. `L`

**42. Maintenance mode.** Promised, absent. No way to take a project offline with a real page rather than
a 502. `M`

**43. Fleet-wide health dashboard.** Promised, absent. Health is visible per-node and per-service but
never as one view with history, despite `HealthModule` existing server-side. `M`

**44. Rollback with a target picker.** This session removed the Rollback button from the global
deployments table: `deployment.rollback` requires a `targetDeploymentId` a one-click row button cannot
supply (`deployments/page.tsx:89` records the reasoning). The dialog that *does* exist is broken in the
same way — `projects/[projectId]/deployments/page.tsx:141` calls
`rollbackDeployment.mutateAsync({ params: { id: rollbackId } } as any)`: **no body at all**, with `as any`
suppressing the compile error that would have caught it. The dialog at L387-393 tells the user it will
"revert to the previous version" and then sends nothing to say which version that is. **Rollback is
likely non-functional on both pages.** A target picker listing prior successful deployments is the fix. `M`

---

## H. Platform — new capability (45–48)

**45. Environment- and role-scoped RBAC.** `docs/qa/permissions/permission-system-design.md:717` answers
"should role changes be audited? **Yes, full audit log table**", and the design is written, but the
shipped model is flat (`viewer | operator | admin | superAdmin`). Environment scoping is the difference
between "can deploy" and "can deploy to production". `L`

**46. Scheduled deployments and maintenance windows.** Triggers are manual only. A `cron`-shaped trigger
plus a window blocking production changes outside business hours covers much of real ops need. `L`

**47. Deployment approvals for production.** `configuration/page.tsx:258` exposes a "Require approval for
production" switch. The setting is real — persisted at `project/settings.schema.ts:87`, resolved into
effective config at `configuration-resolver.service.ts:733`, and asserted by
`deployment-complete-strategy.e2e-spec.ts:35,62`. What is missing is the gate. **No production file under
`apps/api/src/modules/deployment/**` reads it** — the only occurrences are in
`deployment.service.spec.ts:78,798`. `deploymentStatusSchema`
(`packages/contracts/common/src/platform-domain.schema.ts:4`) is
`pending | queued | building | deploying | success | failed | cancelled`: there is no approval state to
reach. So the config is plumbed, tested, displayed, and inert — which is the case item 31 warns about,
and the most misleading toggle in the product. `L`

**48. Secret management UI.** Secrets are referenced by name (`StepRunner`, `StepRuntime`) but there is
no surface to create, rotate or inspect them; rotation today is the mesh shared secret only. `L`

---

## I. Engineering and developer experience (49–50)

**49. ⚑ Delete the duplicate component library.** `apps/web/src/components/ui/` holds 12 files, 8 of which
duplicate `packages/ui/base/src/components/shadcn/` **with real drift** — `button` differs on 26 lines
(`rounded-lg`/`text-sm`/`ring-3` vs `rounded-md`/`text-xs`/`ring-2`), `dialog`'s overlay is `bg-black/10`
vs `bg-black/80`, `input-group` on 37. This is not cosmetic: the fix applied to `packages/ui`'s
`command.tsx` this session — `CommandDialog` was rendering `{children}` without the cmdk `Command` root,
which crashed every consumer — **is absent from the copy at
`apps/web/src/components/ui/command.tsx:36-63`**, which still renders `{children}` straight into
`DialogContent`. That path is reachable: `place-autocomplete.tsx:10` imports this `command`, and
`map.tsx:19` imports `place-autocomplete`. Delete the duplicate; exactly three modules consume it. `M`

**50. Close the type escapes and the test-harness hole.** 22 `as unknown as` remain across 11 files —
two were removed this session by introducing a structural `ProviderRoute` type, which is the pattern to
repeat. Alongside them sit ~30 `as never` casts across ~13 files (heaviest in
`projects/_components/steps/StepRunner.tsx` and `StepNetwork.tsx`), which are worse: `as never` is
assignable to every parameter type, so it disables checking entirely. Item 2 is the proof of the cost —
one of these casts hid a field the API never accepted. Separately, 14 `e2e` test files fail to load
(`window is not defined`, `vitest.setup.ts:70`, because that project runs `environment: 'node'` while
sharing a jsdom setup file); **68 tests pass and zero fail**, so the e2e project currently proves
nothing. `M`

---

## J. Observability — turning state into decisions (51–58)

**51. ⚑ Surface the deployment queue and its dead letters.** `deploymentQueueJobTypeSchema`,
`deploymentQueueJobStatusSchema`, `deploymentDeadLetterReasonSchema` and a `replayMode` enum
(`same_payload | patched_payload`) are all defined in
`packages/contracts/entities/src/entities/deployment/queue.schema.ts`. A repo-wide search of
`apps/web/src` for `deadLetter`, `queueJob`, `deploymentQueue` or `replayMode` returns **nothing**. Work
that fails three times and lands in a dead-letter queue is currently invisible, and the contract already
says how to replay it. `L`

**52. ⚑ Expose checkpoint resume.** `deploymentExecutionStateSchema` defines
`from_last_checkpoint | from_node | restart_failed_branch`
(`execution.schema.ts:7`) and `deploymentPhaseGuardSchema` defines a `gate` phase kind
(`plan.schema.ts:20`). Searching `apps/web/src` for `checkpoint` or `resumeFrom` returns **nothing**. The
platform can resume a partially-failed rollout; no operator can ask it to. Pairs with item 44. `M`

**53. ⚑ Add uptime and error-budget reporting.** The only occurrence of `uptime` in the entire web app is
`analytics/page.tsx:297` formatting `svc.uptime` into a caption. There is no `SLO`, no `errorBudget`, and
no uptime history — so the console can say a service is *currently* healthy but never how *reliably*
healthy it has been. `L`

**54. Add alerting rules.** Nothing in the console defines a threshold, a notification target, or a
muting window. `PushNotificationSettings.tsx` (verified present) can deliver a push, so the transport
half exists — the rule half does not. `L`

**55. Add cost and resource accounting.** There is no spend, billing, or unit-economics view anywhere
(the apparent matches for `cost`/`spend` in the dashboard are the words "cost" and "suspend" inside
comments). For a tool whose core job is allocating finite CPU and memory across a fleet, "what is this
project consuming, and what would this change add" is unanswered. `L`

**56. Make analytics time ranges adjustable and comparable.** `analytics/page.tsx` renders a fixed set of
buckets. Without an arbitrary range and a previous-period comparison, a spike cannot be told apart from
normal variance — which is the difference between information and insight. `M`

**57. Keep metric history per service.** `monitoring/page.tsx` shows current values per environment
(L30-86). There is no trend line, so degradation that is obvious over a week is invisible at any instant. `M`

**58. Show the deployer's own health.** The console watches containers, nodes and the mesh, but never
itself. `HeaderLiveStatus.tsx` shows cluster connectivity in the header and that is the extent of it. If
the API's connection pool, the queue worker, or the event stream degrades, no page says so. `M`

---

## K. Data tables and density (59–66)

**59. ⚑ Export CSV beyond Docker.** `toCsv` exists in exactly one place —
`docker/_components/docker-page-utilities.tsx:106`, surfaced through `docker/containers/page.tsx:814`.
Deployments, services, users, nodes and audit tables cannot be exported at all, which forces operators to
screenshot tables or re-derive data by hand. `M`

**60. ⚑ Bulk actions beyond Docker.** Row selection (`enableRowSelection`, `selectedRows`) appears only in
`docker/containers/page.tsx:458` and `docker/images/page.tsx:430`. Bulk delete of stale images is
supported; bulk delete of stale deployments or a bulk role change across users is not. `M`

**61. Add saved views.** Filters are local state with no way to name and recall a combination. "Failed
deployments in production this week" is a question an operator asks repeatedly and currently rebuilds
every time. `M`

**62. Add column visibility and density controls.** Docker tables expose configuration; the global
`deployments`, `services` and `admin/users` tables render every column on every screen. Item 5 asks to
*add* a column to deployments — which only works if operators can also hide one. `M`

**63. ⚑ Paginate on the server.** Tables fetch a fixed window and slice in memory — `services/page.tsx:40`
uses `limit: 100`, `projects/page.tsx:33` and `previews/page.tsx:53` use `limit: 50`, several docker
tables use `limit: 300`. The contracts already accept `limit`/`offset`, so the ceiling is artificial and
invisible: the user sees a short list, not "showing 100 of 412". `M`

**64. Report totals, not just rows.** No table states how many records exist overall. Combined with item
63, an operator cannot distinguish "that's everything" from "that's the first page". `S`

**65. Open row detail without losing the list.** Several tables navigate away to a detail route, discarding
scroll position and filters (see item 16). A side panel that preserves the table behind it is the cheaper
interaction for read-only inspection. `M`

**66. Make identifiers copyable.** Deployment, container and node IDs are rendered as truncated monospace
text (`shortId(...)`) with no copy affordance, so the common next step — pasting an ID into `docker logs`
or a support thread — requires manual re-selection of a value the user cannot even see in full. `S`

---

## L. Navigation and findability (67–72)

**67. ⚑ Fix the duplicated shortcut row.** `components/dashboard/keyboard-shortcuts.tsx` lists
`{ keys: 'g, then d', action: 'Go to deployments' }` **twice** (L38 and L41) in the help overlay, while
the binding table above it defines `o, p, d, s, c, a, u`. One row is simply wrong, and the overlay is the
one place a user goes to learn the shortcuts. `S`

**68. ⚑ Cover the whole nav model in shortcuts.** `GO_TO_BINDINGS` (L24-32) binds seven destinations; the
navigation model exposes 22. Node detail, Cluster, Mesh config, Logs, Terminal, Events, Providers and
Volumes are unreachable by keyboard, even though they are the pages an operator returns to most. `S`

**69. Add recently viewed.** With 67 routes and deep project→service→configuration nesting, returning to
the service you were just debugging means re-navigating four levels. `M`

**70. Add pinning or favourites.** The sidebar is a fixed taxonomy. Operators work on two or three
projects at a time and have no way to promote them. `S`

**71. Make every filtered view a shareable URL.** Docker log groups and the service Logs replica
selection already encode state in query params (`logs/route.info.ts:13` declares `replicas`). Most other
tables do not, so "look at this" cannot be sent to a colleague. `M`

**72. Give admin sub-pages a sibling switcher.** `admin/providers/` nests eight provider pages with no
way to move between them except back through the index. The breadcrumb deliberately skips dynamic
segments (`DashboardBreadcrumbs.tsx:95-97`), so on a provider detail page the trail says less than the
page knows. `S`

---

## M. Resilience and route boundaries (73–78)

**73. ⚑ Add route-level error boundaries.** There are **four** `error.tsx` files for 67 routes:
`app/error.tsx`, `app/dashboard/error.tsx`, and two under project/service detail. The boundary
infrastructure itself is excellent (`components/error/` ships `ErrorBoundary`, `QueryErrorBoundary`,
`FeatureErrorBoundary`, `RouteError`), so an unhandled error on any of the other ~63 routes escapes to
the root boundary and takes the shell with it. `M`

**74. ⚑ Add route-level loading states.** Only **five** `loading.tsx` files exist. Every other route
falls back to a blank frame while its shell resolves. `loading.tsx` is the cheapest perceived-performance
win available in the App Router and it is almost entirely unused. `M`

**75. ⚑ Add a dashboard-scoped not-found.** The only `not-found.tsx` is at `app/not-found.tsx`. A bad
project or service ID therefore renders the marketing-shell 404 rather than a page that keeps the
sidebar mounted and offers "back to projects". `S`

**76. Handle offline and in-flight mutations.** If the network drops mid-action, nothing indicates that a
mutation is queued, retrying, or lost. Given that the app drives real container operations, "did my
delete happen" is a load-bearing question. `M`

**77. Separate "provider is down" from "no records".** Item 32 covers the copy; the structural fix is that
a provider failure should present as a provider failure (with the provider named and a reconnect path),
not as an empty list. `M`

**78. Make stream reconnection observable.** The dashboard consumes SSE for mesh and container state
(`useDockerLiveContainers`, mesh event streams). Reconnect loops are silent, so a stale table looks
identical to a quiet system — the same failure mode as item 33. `M`

---

## N. Security and access (79–84)

**79. Add session and device management.** `auth/me/_components/accounts-section.tsx` shows linked accounts;
there is no list of active sessions, no "sign out everywhere", and no device or location history. `M`

**80. Give admins a safe impersonation path.** Support currently requires either the user's password or a
role change — both heavier than "view as this user", and neither is auditable as an act of support. `L`

**81. ⚑ Add API key management.** Searching `apps/web/src` for `apiKey` finds only a placeholder string
(`"db-password, api-key"` in `StepRuntime.tsx:94`) and a commented-out analytics token. Machine access to
the deployer has no first-class surface: no create, no scope, no revoke, no last-used. `L`

**82. Add credential rotation beyond the mesh secret.** The one rotation flow in the product is the mesh
shared secret (`admin/system/page.tsx:2416-2432`). Repository, registry and DNS credentials have no
rotation path, so the only way to rotate them is to delete and recreate the provider. `L`

**83. Add per-user and per-token quotas.** Item 41 covers rate limiting as behaviour; the access-control
half is that nothing bounds how much a given identity can request. `M`

**84. Show authentication events.** Sign-ins, failures, lockouts and password changes are the classic
first thing an operator looks at after a suspected compromise. `password_reset` and `email_verified`
appear in the schema domain; no page presents them. Pairs with item 39. `M`

---

## O. Release workflow depth (85–90)

**85. ⚑ Make deployment strategy mean something.** `CreateService.hook.ts:96` and
`StepRuntime.tsx:108` let you pick `rolling | recreate | blue-green | canary` — a four-way choice
presented as a bare enum with no accompanying rollout parameters. Choosing "canary" should ask for a
traffic percentage and a bake time; today it changes one string and nothing else about the rollout. `L`

**86. Add environment promotion.** Environments exist (`projects/[projectId]/environments`) and previews
can be promoted to a stable domain (`previews/page.tsx`, `usePromoteServicePreview`). But promoting
*staging → production* — the single most common release action — has no flow. `L`

**87. Compare two deployments.** Given two deployment records, the console cannot show which image tag,
which config, or which environment variables changed. Every incident begins with "what's different", and
the answer is currently spread across three pages. `M`

**88. Detect configuration drift.** The contracts carry provenance for exactly this
(`deploymentTemplateProvenanceSourceSchema`: `template | inlineOverride | runtimeDefault`,
`provenance.schema.ts:4`), but no page compares declared configuration against what is actually running.
A service edited outside the UI drifts silently. `L`

**89. Keep a rollback plan and history.** `deploymentRollbackTriggerSchema` exists
(`plan.schema.ts:106`), and `deployment.service.ts:709-720` writes `source: "deployment.rollback"`, yet no
page shows what a rollback would do or what previous rollbacks changed. Pairs with item 44. `M`

**90. Attach release notes to a deployment.** A deployment has an id, a status and a timestamp. It has no
answer to "what shipped". A commit range or changelog on the detail page turns the deployments table from
a log into a record. `M`

---

## P. Platform depth (91–96)

**91. Schedule by label, not by hand.** Node labels are real — `resolveSwarmNodeRole`,
`updateSwarmNodeLabels` and `updateSwarmNodeRoleAvailability` all operate on them (this session's work).
But placement is manual: nothing lets a project express "run on nodes labelled `tier=prod`", which is what
labels exist for. `L`

**92. Add node drain with an eviction preview.** `admin/system` can change a node's role and availability.
Taking a node out of service without first showing which workloads would move, and whether the fleet has
room for them, is a one-click outage. `M`

**93. Add an image and registry policy.** Container creation (`docker-create-container-modal.tsx`) is
highly configurable per container, including raw `cpuQuota` (L1426) and security options. Nothing
constrains *which registries* may be pulled from or *which* tags may be deployed, so supply-chain policy
rests on convention. `M`

**94. Make storage placement visible.** Volume creation and inspection exist
(`docker/volumes`, `docker-volume-detail-modal.tsx`) but nothing shows which node a volume lives on, or
that a stateful service and its data can be scheduled apart. `M`

**95. Add capacity planning.** `admin/system` reports allocated and used capacity per server. It cannot
answer "will this fleet hold the next five services", which is the question an allocation decision
actually depends on. `L`

**96. Surface a disaster-recovery path.** Item 38 covers the missing backup UI. The companion gap is that
nothing states the recovery objective — which data is recoverable, from when, and how long restore takes.
`L`

---

## Q. Onboarding, API surface and reach (97–100)

**97. ⚑ Publish a browsable API reference.** The web app *generates* an OpenAPI document —
`src/routes/openapi.ts` writes `./openapi-docs.yml` via `OpenApiGeneratorV3` — and nothing serves it. The
contract layer is the strongest asset in this repo; rendered as a reference (Scalar or equivalent) it
becomes usable by anyone outside the web client. `M`

**98. ⚑ Declare errors on the remaining contracts.** Only two of roughly thirty mesh contracts under
`packages/contracts/api/modules/mesh/` declared `.errors(...)` before this session. A contract that
doesn't declare its errors cannot produce a typed client error, which is the direct cause of items 29
and 31. Sweep the whole `packages/contracts/api/modules/` tree, not just mesh. `M`

**99. ⚑ Let the setup wizard be revisited.** `components/setup/steps/` holds eight steps (mode, local
account, local database, cluster, join cluster, remote URL, remote auth, progress). Onboarding runs once
and then becomes unreachable — so an operator who wants to confirm which mode was chosen, or re-probe
the mesh, has no entry point. A read-only "Setup" page under admin that shows the recorded answers and
offers re-probe closes this. `M`

**100. ⚑ Do a dedicated responsive pass.** Across the entire dashboard there are **two** responsive
breakpoint utilities in use (`docker-file-browser.tsx:238` and `docker-image-detail-modal.tsx:1549`), and
`ScrollArea` appears in a single file. Dense multi-column tables, a fixed sidebar and React Flow canvases
are assumed to run on a desktop-width viewport. This is a legitimate product decision — but it is
currently an *undocumented* one, so it should either be engineered deliberately (a stated minimum
viewport, with a clear message below it) or addressed. `M`

---

## Where I would start

| Order | Item | Why |
|---|---|---|
| 1 | 1 — real logs | A "Logs" page with no logs is the largest information lie in the product |
| 2 | 39 — audit log UI | Backend already records it; only the read surface is missing |
| 3 | 44 — rollback target picker | Broken on both pages today |
| 4 | 29 — strict-mode 500 | Live failure, cause not yet found |
| 5 | 49 — duplicate components | Carries a known crash unfixed, and blocks consistent visual work |
| 6 | 51 — deployment queue | Failures land in a dead-letter queue nothing displays |
| 7 | 73, 74 — route boundaries | Four `error.tsx` and five `loading.tsx` for 67 routes |
| 8 | 2, 3, 20, 67 | Cheapest correctness wins — all `S` |

**Deliberately excluded:** i18n. `production-readiness-plan.mdx:951` records it as an explicit
out-of-scope decision ("no translation framework; document the decision, don't half-adopt").
Retrofitting it is its own project, not an item on this list.
