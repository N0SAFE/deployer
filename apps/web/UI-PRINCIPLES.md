# Web UI principles

The bar every dashboard page is reviewed against. These came from walking the live
app, not from taste — each rule exists because a page broke it.

## 1. State must be TRUE before it is pretty

- **Never show a good state you have not earned.** "Healthy — nothing waiting" with
  0 nodes, or 34 nodes "Active / Healthy" that were last seen days ago, is worse
  than an ugly page: it hides the problem. Derive status from evidence (last seen,
  live connection), and say "no data yet" when there is none.
- **Empty is not filtered.** "No results match these filters" is only for a view
  with filters applied. A list that is simply empty says what it would hold and the
  next action ("No deployments yet — deploy a service").
- **Loading is a skeleton of the page, not a bare spinner.** If it can take > 3 s,
  say what it is waiting on. Every query has an error state with a retry and a
  readable reason. A live connection that is "Connecting…" says what it is and what
  it affects.
- **Counts, times and statuses agree with each other on the same screen.**

## 2. One page anatomy

`PageHeader` (eyebrow = the section, title = the thing, description = what it is for
and what it affects) → section nav if the section has one (`SectionNav`) →
`StatStrip` of vitals → cards/tables. Never a raw `<h1>`. A page that is the
overview of a section links to the pages that change things.

## 3. Naming is the product

- Name the thing in the operator's words: "Capacity & admissions", not "Fleet".
- One concept, one name, everywhere: the WireGuard network is **Mesh**; the
  platform's peer sessions are **Peer diagnostics**. Never the same word for two things.
- No duplicate navigation labels (a nav entry and a tree entry both called
  "Projects"), no jargon without a hint, no internal ids as titles when a name exists.
- Buttons say what they do ("Revoke member", not "Confirm"). Destructive actions
  name their object and their consequence, and are confirmed.

## 4. Settings live with the thing they configure

See `docs`/Settings hub. Account, Users & access, Integrations, This node, Security
are Settings; network lanes live in Network; capacity in Nodes; a service's config on
the service. A setting editable in two places is a bug — keep the better one and link.

## 5. Density, type and contrast

- Body text ≥ 13 px. Anything under 12 px is a label at most, never content, and
  never low-contrast (WCAG AA: 4.5:1 text, 3:1 large/UI).
- `font-mono` for ids, addresses, hostnames, commands — and every id has a copy button.
- Times: relative ("3 min ago") with the absolute time in a `title`/tooltip.
  Durations and sizes are human-formatted, numbers right-aligned in tables.
- Tables: sticky header on long lists, row hover, a clear primary column, status as a
  badge (colour + text, never colour alone), row actions in one consistent place.

## 6. Responsive and accessible

- Works at 375 px: tables scroll inside their card (never the page), actions wrap,
  the section nav scrolls horizontally, dialogs fit.
- Everything reachable by keyboard; visible focus; `aria-label` on icon-only buttons;
  `role="status"` for live updates; no information by colour alone.
- Respect `prefers-reduced-motion`.

## 7. Safe by default in the UI

- Secrets masked with an explicit reveal and copy. Demo/dev conveniences (demo
  credentials, sign-up links, devtools) never render outside development.
- Auth and permission-gated controls are hidden or disabled with a reason — never
  shown and then rejected.

## 8. Mechanics (the repo rules)

Typed routes only (`@/routes` builders, never a hardcoded `href`); data through the
`domains/*` hooks; shared UI from `@deployer/ui`; no `any`; no new file over ~400 lines;
move code, don't copy it. Update docs in the same change.
