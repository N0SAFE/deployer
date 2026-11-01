# FRONTEND ROADMAP — the console as a control room

Date: 2026-11-01. Status: **design, ready to implement**. Covers `apps/web` and `packages/ui/base`. Absorbs the UX half of
`roadmap/web.md` — those items keep their `WEB-*` IDs and are referenced, not duplicated. Research and benchmark evidence:
[`frontend/RESEARCH-dashboard.md`](./frontend/RESEARCH-dashboard.md), plus the repo's own `web.md`, `journeys.md` and the
three `bench-*.md` files.

---

## 0. Purpose (the sentence the whole UI serves)

> **Answer three questions in ten seconds — is my platform serving, what changed, and what can I do now — then let me act
> without leaving the page.**

Everything in this roadmap follows from that sentence. The console is a **control room**, not a report: it optimises for
*state recognition and action*, not for browsing data. A user is either an operator (solo, self-hosted, wants one screen to
trust) or a developer on a team (wants "my service", "my deploy", "my logs").

The primary unit is the **service**. Projects are containers, deployments are events, nodes are machines — the service is
what has a state, a URL, a history and actions.

---

## 1. Principles (each is a checklist item on every PR)

| # | Principle | Enforceable rule |
|---|---|---|
| 1 | **Status first** | Every page opens with one sentence of state ("Serving v41 · 2/2 replicas · https://shop.example.com"), not a metric grid. |
| 2 | **Honesty over completeness** | A surface either shows real data with its freshness, or says why it cannot. Never a synthesized line, never a silent success. Fake/mislabelled surfaces are P0 defects. |
| 3 | **Actions where the state is** | Deploy/restart/rollback/logs live in the service header, not three pages away. Destructive ones name the object and the impact. |
| 4 | **Progressive disclosure** | First viewport = identity + state + primary actions. Advanced (healthchecks, limits, placement, ulimits) one layer down. |
| 5 | **The URL is the state** | Tab, filter, page, sort, node/project scope live in the URL. Back/Forward and shared links must work. |
| 6 | **Live by default, honest when not** | Subscriptions update lists and logs; a page shows "updated 12 s ago" and a reconnecting state. No global chip claiming liveness. |
| 7 | **One vocabulary** | Status words, environment names, roles and permission slugs come from one source (contracts / authz catalog). No role literal in a component. |
| 8 | **Keyboard and screen reader are first-class** | ⌘K acts, every dialog traps focus, status changes announce. |

`apps/web/AGENTS.md` already bans the top KPI strip; this roadmap extends that rule to **no top-of-page metric strip of
any kind** outside the command center's verdict sentence, and requires the header contract in §4.

---

## 2. The page contract (every page, no exceptions)

```
┌ Context header ────────────────────────────────────────────────────────────────┐
│ Breadcrumb (project ▸ service)              [scope: node ▾]   [env ▾]  [⋯]    │
│ Title                                             ●Status sentence   [Primary] │
│ one subtitle: what this is / what it costs / when it changed                   │
├ State banner (only when something is wrong) ──────────────────────────────────┤
│ ⚠ Deploy failed at build: "no Dockerfile at repo root". Still serving v41.     │
│   [View log] [Retry] [Edit env]                                                │
├ Sections ─────────────────────────────────────────────────────────────────────┤
│ … content, each section with its own empty/loading/error state …               │
└ Sticky action bar (long forms only) ──────────────────────────────────────────┘
```

Required states for every data surface (a page cannot ship without all six):

| State | Copy rule | Component |
|---|---|---|
| Loading | skeleton shaped like the content; "still loading…" after 5 s | `PageLoadingState` / `TableSkeleton` |
| Empty (never had data) | why it is empty + the one action that fixes it | `EmptyState` |
| Empty (filters) | "no match" + clear filters | `FilteredEmptyState` |
| Error | what failed + retry + copyable details | `PageErrorState` / `InlineError` |
| Stale / offline | "showing data from 2 min ago" + reconnect | new `StaleBanner` |
| No access | "You don't have access — ask an owner" (never leak existence) | new `NoAccessState` |

---

## 3. Target information architecture

```
Overview                     the verdict + what changed + what to do (command center)
Workloads
  Projects                   inventory (filtered view, same table as project pages)
  Deployments                every deploy in flight + history (a queue, not a table dump)
  ▸ Project                  overview · services · environments · deployments · domains · team · settings
    ▸ Service                overview · deployments · logs · metrics · previews · config (general/provider/env/network/preview)
Runtime
  Nodes                      inventory · capacity · diagnostics · ▸ node (services/tasks/images/logs/shell)
  Cluster                    members, role/ingress, quorum — guarded
  Docker                     containers · images · networks · volumes · logs · activity · shell
Network
  Edge & ingress · Domains · DNS · Mesh
Access
  Users · Roles & grants · Audit log · Tokens
Settings
  Account · Platform · Integrations
```

**Consolidations** (removing the "which page am I on?" problem the audit found):
1. `/dashboard/services` and `/projects/[id]/services` are **one component** — the global one is the filtered view with a
   project column; the same for deployments and domains.
2. Domains: one inventory with a project filter, not a project picker gate.
3. Settings splits into **Account** (personal) and **Platform** (admin), with the permission check on the route, not on the
   nav item only.

**Scope control**: the header carries a project/service/environment/node scope; the selected node is already in the shell,
keep it but make it act on the docker pages (WEB-062).

---

## 4. Data, liveness and correctness

| UI-001 | TanStack Query defaults: `staleTime` 15 s, `retry` 1 (never on 4xx), one global error/401 handler, one mutation helper with toasts + invalidation | `WEB-030` | S |
| UI-002 | Subscribe workload lists and overview to the existing stream procedures; invalidate on event, keep a per-page "updated Ns ago" | `WEB-031/038` | M |
| UI-003 | Deployment logs stream (SSE/WebSocket), no 4 s polling, no 500-line cap; reconnect state inline | `WEB-032` | M |
| UI-004 | Server-side pagination/filter/sort on projects, services, deployments, containers, images; stop client joins over a 100-row window | `WEB-034/033` | L |
| UI-005 | Adopt the `bff.*` screen procedures (overview, service detail) so a page is one request; delete the client-side 7-read join on the command center | `WEB-033` | M |
| UI-006 | URL state everywhere: tab, filter, page, sort, scope (nuqs), removing the five `useState` tabs | `WEB-036` | M |

Product metrics: `staleTime` change alone removes the mount refetch storm; UI-002/003 make the primary loop truthful.

## 5. The core loop: deploy → watch → debug → recover

| Item | What | Maps | Effort |
|---|---|---|---|
| UI-010 | **Service header**: honest status, last deploy (actor · time · commit), URL with Open, replica health, environment switcher, primary action split-button (Deploy/Redeploy), overflow (Restart, Stop, Rollback, Cancel) | `WEB-051/009` | M |
| UI-011 | **Deployment timeline**: stages (resolve → build → push → deploy → health → route) with duration and a diff vs the previous deploy (commit, digest, env keys, plan hash, scan) | `WEB-040` | M |
| UI-012 | **Live deploy view**: a slide-in/route showing stage + streamed logs, reachable from anywhere via the global "deployments in flight" indicator | `WEB-130/043` | M |
| UI-013 | **Failure card**: stage, first error line, last 20 lines, "still serving vN", actions (logs, retry, rollback, edit env) | `WEB-052` | S |
| UI-014 | **Rollback** with a target picker (previous successful runs, commit/author/time, scan badge), sends `body.targetDeploymentId`, reports failure truthfully | `WEB-005` | S |
| UI-015 | **"Redeploy required"** badge on env/config drift, with the diff and a one-click redeploy | `WEB-042` | S |
| UI-016 | **Create-and-deploy** in the service wizard: review step gets "Deploy now", closing keeps a draft, the wizard is URL-addressable | `WEB-010` | M |
| UI-017 | Real **service logs**: container stdout/stderr with per-source/node filter, follow/pause/wrap/download, three honest empty states (not started / previous container / node unreachable) | `WEB-001/072/113` | M |
| UI-018 | **Queue visibility**: pending/next, position, cancel semantics, retry-from-stage | `WEB-043` | S |

## 6. Permission-aware UI (depends on the authz catalog)

The API now carries a typed catalog (`@deployer/auth/authz`) and an Effect gate. The web must render from it, never from
role literals.

| Item | What | Maps | Effort |
|---|---|---|---|
| UI-020 | `useCan`/`useCapabilities` (done) + `<RequirePermission>` and `<RequireProjectRole>`; replace every `role === 'admin'` in a component | `WEB-016` | S |
| UI-021 | Render destructive controls only with the permission; otherwise a disabled control with "Requires maintainer" and who to ask | `WEB-017` | S |
| UI-022 | No-access state for URLs the user cannot read (404-style copy, no existence leak) | `WEB-115` | S |
| UI-023 | Admin/platform routes guarded at the route, not only in nav | `WEB-018` | S |
| UI-024 | A generated role × control matrix test (viewer sees no Deploy/Rollback/Delete/Exec) | `WEB-121` | M |

## 7. Trust repair (P0, do first)

These are the screens that currently lie. Nothing else matters until they do not.

| Item | What | Maps | Effort |
|---|---|---|---|
| UI-030 | Cluster role/ingress: wire the quorum-aware `ClusterNodesTable` + confirm dialog, delete the inline writes | `WEB-004` | S |
| UI-031 | Service status from the latest deployment/replicas, never `'unknown'` | `WEB-003` | S |
| UI-032 | Env "Config" link passes the UUID | `WEB-002` | XS |
| UI-033 | "Live" chip renamed to control-plane reachability; tooltip fixed; per-page freshness instead | `WEB-007` | XS |
| UI-034 | Mark every stored-but-inert setting ("Not enforced yet") or hide it; one registry of inert fields | `WEB-014` | S |
| UI-035 | `/manage/web-app` admin-only copy + UI; stop claiming "deliberately public" | `WEB-006` | XS |
| UI-036 | Drop the `customDomains` free-text bypass from the wizard | `WEB-013` | XS |
| UI-037 | Remove the banned top KPI strips from the 20 files that still use them; keep one verdict line | `WEB-095` | M |

## 8. First-run and onboarding

| Item | What | Maps | Effort |
|---|---|---|---|
| UI-040 | **Onboarding checklist** on the command center (install ✓ → claim ✓ → domain → first project → first deploy → invite), persisted per install, dismissible, one action per step | `WEB-028` | M |
| UI-041 | `/dashboard/new` quick deploy: paste repo / image / upload → detect builder → review → deploy → **live log** → Open URL; the J1 "60 seconds to a URL" path | `WEB-029` | L |
| UI-042 | Empty states that teach: "No projects yet" becomes step 2 of the checklist; "No provider" explains public URL vs connect GitHub, never hides the PAT option | `WEB-111` | S |
| UI-043 | Auth completeness pages: forgot/reset, email verification, invite accept, "mail not configured" mode | `WEB-021/022` | M |
| UI-044 | Remove the duplicate `PostSetupHints` mount; one onboarding surface | `WEB-028` | XS |

## 9. Shell, navigation and search

| Item | What | Maps | Effort |
|---|---|---|---|
| UI-050 | **Command palette that acts**: deploy, restart, open logs, copy URL, create project, invite, drain node — each with a confirmation for destructive ones | `WEB-094` | M |
| UI-050b | **Global entity search** across projects, services, deployments, domains, nodes (one procedure, ranked, keyboard-first) | `WEB-094` | M |
| UI-051 | Breadcrumbs resolve by id (no 50-item windows), fixed depth on mobile | — | S |
| UI-052 | Keyboard help matches the nav registry (drift already found) | — | XS |
| UI-053 | Global in-flight deployments indicator in the header (count + link to live view) | `WEB-130` | S |

## 10. Consistency: one table, one visual language

| Item | What | Maps | Effort |
|---|---|---|---|
| UI-060 | Adopt the shared `DataTable` everywhere (only 2 of 59 pages use it): sorting, column chooser, saved filters, bulk actions, CSV, mobile card-collapse | `WEB-035/096` | L |
| UI-061 | One visual dialect: pick flat (card + border) and delete the glass variant (`bg-card/40 backdrop-blur-xl`, 44 sites) | `WEB-095` | M |
| UI-062 | Typography/spacing scale check; `font-display` used in 2 files — either use it as the display face or drop it | `WEB-103` | S |
| UI-063 | Per-scheme `theme-color`, real manifest (name, icons, orientation), robots/noindex for a private console | `WEB-099/102` | S |
| UI-064 | Move `leaflet.css` out of the root layout | `WEB-039` | XS |

## 11. Accessibility, mobile, PWA

| Item | What | Maps | Effort |
|---|---|---|---|
| UI-070 | `aria-live="polite"` on deploy status and log follow; every mutation announces its result | `WEB-104` | S |
| UI-071 | Focus management: dialogs trap/restore, route changes focus the title, skip link everywhere | `WEB-104` | S |
| UI-072 | Mobile: card-collapse for the 5 densest tables, touch-tuned log/terminal viewers, 375 px pass in CI with axe | `WEB-101/124` | M |
| UI-073 | PWA honest: register the worker or delete it; push handler, `/oncall` compact route with action buttons | `WEB-099/100` | M |

## 12. Performance budgets

| Area | Budget |
|---|---|
| Route JS | ≤ 250 KB gzip per dashboard route (measure per route; the data-table family alone is 3.2k lines) |
| LCP | < 2.5 s p75 on a 4-vCPU node, < 1.5 s warm navigation |
| INP | < 200 ms; a filter keystroke re-renders the table within one frame |
| Network | one request per screen (BFF composition), no client join over > 50 rows |
| Realtime | a deploy state change visible < 1 s after the backend event |

Enforced by: a bundle-size check per route in CI, a Playwright timing assertion on the three core journeys, and a
`useStream` reconnect test.

---

## 13. Front-end DX (so the next page is cheap and consistent)

| Item | What |
|---|---|
| UI-080 | **Page scaffold**: `web:page <area> <name>` generates `page.tsx`, `route.info.ts`, `_hooks`, `_models`, `_components`, the state trio (loading/empty/error) and a test — so a new page starts conformant |
| UI-081 | One query-key factory per domain + generated hooks from contracts (already the pattern; make it the only one) |
| UI-082 | One state kit: `PageStates`, `EmptyState`, `StaleBanner`, `NoAccessState`, `ConfirmDialog` with impact, `StatusSentence` |
| UI-083 | Component stories for the shell, table, status, state kit, service header — reviewed in one place |
| UI-084 | Lint rule + test: no `role ===` in components (must use `useCan`), no hardcoded `href`, no `fetch` |
| UI-085 | Playwright journeys J1–J6 (UI halves) on the shared harness, one spec per journey, run in CI |

---

## 14. Phases

| Phase | Theme | Items | Effort | Exit criterion |
|---|---|---|---|---|
| **A** | Trust repair | UI-030…037, 001 defaults where cheap | 3–4 d | the audit's fake/mislabelled list is empty; no unguarded destructive control |
| **B** | Core loop | UI-010…018, 053 | 2–3 w | deploy → watch → fail → recover is one flow, live, with a truthful failure card |
| **C** | Permissions | UI-020…024 | 1 w | viewer sees no destructive control; matrix test green |
| **D** | Data layer | UI-001…006, 060 | 2–3 w | one request per screen, server pagination, URL state, one table |
| **E** | First run + shell | UI-040…044, 050–052 | 1.5–2 w | a fresh install reaches a live URL from the dashboard in < 3 min |
| **F** | Platform polish | UI-061…064, 070…073, 080…085 | 2 w | a11y/perf budgets enforced in CI; mobile journeys pass |

≈10–12 engineer-weeks total. A and B are not negotiable before any new page ships.

---

## 15. Testing and instrumentation

- **States tests** per page (`*.states.test.tsx` exists — make it mandatory): loading, empty, error, filtered-empty,
  no-access.
- **Journey specs** (Playwright): J1 first deploy, J2 push deploy + rollback, J3 domain verify, J4 debug failure, J5 node
  drain, J6 invite/role change.
- **Role matrix** generated from the authz catalog: for every route, a viewer/operator/admin expectation.
- **Axe + 375 px** on the six journeys.
- **Instrumentation**: the console has no product analytics today. Add a privacy-light event bus (page, action, result,
  duration) behind a flag; it feeds the metrics in `RESEARCH-dashboard.md` §6 (time to first URL, time to answer "what's
  wrong", drop-off in the wizard).

## 16. Rollout

1. Phase A ships as small PRs per screen (no design debt).
2. Phase B behind per-page flags where the API is not ready (timeline needs the manifest; the UI falls back to the log view).
3. Phase C after the authz store lands; until then controls are gated by platform role only.
4. Phase D is invisible when done right: the same screens, fewer requests, URL state added.
5. Every phase keeps the existing typed routes and hooks; nothing is rewritten for its own sake.

## 17. Risks

| Risk | Mitigation |
|---|---|
| Timeline/diff needs the release manifest (`DEPLOY-003`) | ship the log-based view first, add stages when the manifest exists |
| Permissions UI before the store | render from the catalog's system roles; project-scope checks stay on the existing access service until grants land |
| Table migration touches every list | migrate area by area, keep the old markup until its area's tests pass |
| "One request per screen" invites a monolith BFF | screen procedures compose; no generic proxy endpoint |
| Honesty work looks like churn | each item has a concrete lie in the audit as its acceptance test |

## 18. Definition of done (front end)

- The six journeys pass end-to-end, on desktop and 375 px, in CI.
- No fake surface remains: every screen either shows real data with freshness or states why.
- Every destructive action names its object, shows impact and is permission-gated on the client *and* server.
- A new page is scaffolded, conformant (states, URL state, hooks) and tested in under an hour.
- Budgets enforced: route JS, LCP/INP, one request per screen, < 1 s realtime status.

## 19. Mapping (do not double-track)

`UI-*` is the implementation order; the audit keeps the evidence. A screen item often closes two `WEB-*` rows. When an
`UI-*` lands, tick the `WEB-*` it names in the same commit, and add the verification line to `roadmap/web.md` the way the
other area files do.
