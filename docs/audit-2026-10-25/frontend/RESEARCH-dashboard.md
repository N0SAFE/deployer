# Dashboard research — what a self-hosted deploy console is for

Date: 2026-11-01. Companion to [`FRONTEND-ROADMAP.md`](./FRONTEND-ROADMAP.md). Sources tagged `[web]` (fetched this
session), `[audit]` (the repo's own benchmark/audit files), `[code]` (`apps/web`, verified).

## 1. The job to be done

A deploy console is not an analytics product. An operator opens it to answer, in under ten seconds:

1. **Is my stuff serving?** — the app, its database, the edge, the nodes.
2. **What changed?** — a deploy, a config edit, a node event, a certificate, a peer.
3. **What do I do now?** — one primary action, and what happens if I take it.

Everything else (long tables, charts, reports) is secondary and belongs behind those three answers. `[audit]
journeys.md` states the same as six journeys; `[code] apps/web/AGENTS.md` already encodes the information-presentation
rule that follows from it (no top KPI strips; context header, sections, actions near controls).

Corollary: the console's **primary unit is the service**, not the project and not the deployment. A service has a state,
an owner, a URL, a history and actions. Projects are containers; deployments are events of a service.

## 2. The four UX properties that matter most

| Property | Why | What it costs when missing |
|---|---|---|
| **Visibility of status** `[web]` [NN/g heuristic #1](https://www.nngroup.com/articles/visibility-system-status/) | Every action must show its consequence: deploying, failed, serving v41, queued. | The user leaves the action to find out what happened — the single worst finding in the current audit (§4 of the web report). |
| **Honesty** (no fake data, no silent success) | A console is trusted exactly as far as its last lie. | The current app invents log lines, reports a phantom service status, and records rollbacks that never ran. One lie costs every other screen. |
| **Progressive disclosure** `[web]` [NN/g](https://www.nngroup.com/articles/progressive-disclosure/) | The 80 % case is two clicks; the 20 % (healthchecks, placement, ulimits) is one layer down. | 9-step wizard modals and 40-field forms for a first deploy. |
| **Recognition over recall, one vocabulary** | Status words, environment names, roles and permission names must be the same everywhere. | The audit found a free-form environment UI over a 4-value enum, and roles restated in five components. |

## 3. How the best consoles do it (competitor evidence, from the repo's own benchmarks)

`[audit] bench-coolify.md`, `bench-dokploy-dockhand.md`, `bench-market.md` already scored 30+ products row by row. The
patterns that recur in every strong console:

1. **A single "New" entry point** that asks *what* (Git / Docker / database / template) before *how*. Coolify's picker;
   Railway's "Deploy from repo or template".
2. **A per-resource configuration sidebar** with instant save and inline help (General, Environment, Domains, Storage,
   Health, Limits, Webhooks, Preview, Danger), instead of one giant form. Coolify.
3. **A live deployment view** — stage timeline, streamed logs, a global "deployments in flight" indicator that follows you
   across pages. Coolify `ActivityMonitor` + `DeploymentsIndicator`; GitHub Actions' run page.
4. **"Configuration changed — redeploy required"** as a first-class badge, because a stored setting that is not live is a
   lie waiting to be believed. Coolify's `ConfigurationChecker`.
5. **Status with an operator-grade empty/error vocabulary**: "Serving v41", "Nothing deployed yet", "Still serving v41 —
   deploy failed at build", "Node `n2` unreachable, showing cached". `[audit] journeys.md` J2/J4 write these lines out.
6. **Danger is separate and typed** — a Danger tab, typed confirmation, impact preview ("7 tasks will move; quorum 2/3
   stays"). Coolify's two-step confirmation.
7. **Global search and a command palette that acts** — not just navigation. Dockhand's palette + saved filters; Coolify's
   Cmd-K search across projects/servers/resources.
8. **Charts are history, not decoration** — a metrics tab with 1 h/24 h ranges and limits drawn, or no chart at all.
   Dockhand.
9. **Honest "unavailable"** beats a fake screen: a page that says *why* it cannot work, and what to do. Already the best
   pattern in this repo (`<UnavailableIntegration>`).
10. **The console is the product's front door** — first-run is a guided path to a live URL, not an empty dashboard.

`[web]` General dashboard guidance agrees on hierarchy and restraint: few, large, meaningful figures; one accent colour for
the one number that matters; preattentive attributes (position, length, colour) before labels
([NN/g dashboards](https://www.nngroup.com/articles/dashboards-preattentive/)).

## 4. What to reject

- **Top-of-page KPI strips.** Banned by `[code] apps/web/AGENTS.md` and still used in 20 files. They consume the first
  viewport with numbers nobody acts on.
- **A global dashboard that duplicates lists.** An "overview" that is a wall of shortcuts to other pages adds a click, not
  an answer.
- **Charts without a series.** A flat line drawn from a single snapshot is decoration presented as data (audit
  `observability.md` calls it out).
- **Settings that are stored but inert.** Either wire them or hide them; "honest UI is a quick win" `[audit]
  bench-market.md`.
- **A marketing landing page inside a private console.** `[code] apps/web` serves a landing at `/` for a self-hosted tool.
- **Autonomous remediation.** Rollback stays a deterministic health-gate rule, never an LLM decision `[audit]
  ideas-dx-ai.md`.

## 5. The experience we are aiming for, in one page of scenarios

| Scenario | Today | Target |
|---|---|---|
| First run | wizard → dashboard with hints, no "next step" | guided path: install → claim → **first deploy in 60 s** → live URL, with a checklist that persists until done |
| "Is it up?" | command center with 7 client-joined reads; nothing global in the shell | a **verdict sentence** in the header of every page ("3 services, 1 failing") + the service's own status |
| "Why did my deploy fail?" | fake logs, phantom status, no stage timeline | failure card: stage, first error, last 20 lines, "still serving v41", actions (logs, retry, rollback, edit env) |
| "I changed an env var" | saved silently, nothing says a redeploy is needed | **"Redeploy required"** badge on the service, with the diff and a one-click redeploy |
| "Can Alice deploy prod?" | any viewer sees the button, API refuses at click time | controls rendered from the same catalog the API enforces; a "Requires maintainer" hint otherwise |
| "Which node runs this?" | docker pages are node-blind | node scope in the shell, per-node pages, node-aware lists |
| Multi-node incident | global chip says "Live" whatever the cause | per-page freshness, per-node reachability, honest cached/stale markers |

## 6. What "good" is measured by

- **Time to first live URL** (install → HTTP 200): target ≤ 5 min, dashboard part ≤ 3 min.
- **Time to answer "what's wrong"**: one screen, one card, no navigation.
- **Time to a truthful deploy status**: streamed, < 1 s after the backend event.
- **Destructive actions**: 100 % confirmation with impact, 0 unguarded privileged controls.
- **Honesty**: 0 fake/mislabelled surfaces (the audit's `web.md` §3 list is the baseline).
- **Shell**: every page addressable by URL with its state (tab, filter, page, scope), Back/Forward correct.
- **Accessibility**: WCAG 2.2 AA on the core journeys; keyboard-only path for deploy, rollback, invite, node drain.
- **Performance**: LCP < 2.5 s p75, INP < 200 ms, route JS budget per area, no client-side join over a 100-row window.

## 7. Sources

- NN/g, *Visibility of System Status* — https://www.nngroup.com/articles/visibility-system-status/
- NN/g, *Progressive Disclosure* — https://www.nngroup.com/articles/progressive-disclosure/
- NN/g, *Dashboards: Making Charts and Graphs Easier to Understand* — https://www.nngroup.com/articles/dashboards-preattentive/
- Repo: `docs/audit-2026-10-25/web.md`, `journeys.md`, `bench-coolify.md`, `bench-dokploy-dockhand.md`, `bench-market.md`,
  `ideas-dx-ai.md`, `observability.md`, `roadmap/web.md`
- Code: `apps/web/AGENTS.md` (information-presentation rule), `apps/web/src/components/dashboard/navigation.ts`,
  `apps/web/src/lib/access/*`, `packages/ui/base/src/styles/globals.css`
