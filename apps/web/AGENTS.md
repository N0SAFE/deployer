# AGENTS.md — apps/web (Next.js)

Follow the root `AGENTS.md` first. This file adds Web-specific guidance.

## Scope Rules

- **LLM mandatory rule**: before creating, moving, or editing files under `apps/web/src/**`, read `v3/apps/web/ARCHITECTURE.md` and follow it as the canonical structure guide for this folder.
- Enforce feature-local structure for non-trivial route features: `_models` (Zod-first schemas + inferred types), `_hooks`, `_components`, `_data-table` (`columns.tsx`, `filter-config.ts`), and `_utils` (pure helpers).
- Keep filters in `_data-table/filter-config.ts`, table columns in `_data-table/columns.tsx`, and feature-specific schemas/types in `_models/*`.
- Always use the declarative routing system; do not hardcode `href` or manual `fetch()` to API.
- After route structure changes, run `bun run web -- dr:build`.

## Quick Context via MCP

- Inspect this app:
  - `repo://app/web/package.json`
  - `repo://app/web/dependencies`
  - `repo://graph/uses/web` and `repo://graph/used-by/web`

## Workflows

Development (Docker-first):
- Prefer MCP: `docker-up { mode: "dev", target: "web" }` — start the web app stack
- Legacy: `bun run dev:web` — also starts the web app
- Logs: `bun run dev:web:logs`

Routing:
- Routes defined by `src/app/**/route.info.ts`
- Generate routes: use MCP `run-script { targetType: "app", targetName: "web", script: "dr:build" }` or watch `dr:build:watch`

Testing and checks:
- Type-check: `bun run web -- type-check`
- Test: `bun run web -- test`

## Boundaries

- Use shared UI from `@repo/ui` where possible.
- Client API access should use generated ORPC hooks.

## UI Information Presentation Rule (Top info cards are disallowed)

> **Added**: 2026-03-30  
> **Type**: Pattern  
> **Confidence**: Verified ✅  
> **Scope**: `apps/web`

### Summary

Do **not** use a top-of-screen KPI/info-card strip (4-up stat cards directly below the page title) as the default information pattern.

### Context

In dense dashboard screens, top metric card strips push actionable controls below the fold and duplicate information that is better understood in-context near the relevant section/table.

### Details / Implementation

Use this preferred structure instead:

1. **Context-first header**
  - Title + one concise subtitle + current status sentence.
  - Keep primary actions visible (top-right) and mirrored in sticky footer actions when forms are long.

2. **Section-first information placement**
  - Put metrics next to the section they affect (services stats in services section, dependency stats in dependencies section).
  - Prefer compact inline indicators (`Badge`, muted text rows, compact key/value lines) over decorative standalone cards.

3. **Action-oriented summary blocks (not decorative cards)**
  - Use lightweight callouts/toolbars near interactive controls (bulk actions, filters, policy scope selectors).
  - Keep summary text concise and decision-oriented.

4. **Responsive behavior**
  - Prioritize controls and context in first viewport.
  - Avoid large summary grids that consume vertical space before interaction areas.

### Anti-pattern (forbidden)

- A full-width top grid of metric cards immediately below the page title used as the main information display pattern.

### Affected Files / Locations

- `v3/apps/web/src/app/dashboard/projects/[projectId]/configuration/page.tsx` — should avoid relying on top summary card strip as primary information architecture.
- `v3/apps/web/src/app/dashboard/projects/[projectId]/configuration/environments/[environmentId]/page.tsx` — same rule applies for environment editor screens.

### Evidence

- `v3/apps/web/src/app/dashboard/projects/[projectId]/configuration/page.tsx#L518-L565`
- `v3/apps/web/src/app/dashboard/projects/[projectId]/configuration/environments/[environmentId]/page.tsx#L624-L672`
- `v3/docs/qa/web-rebuild/feature-mapping-v1-v2-to-v3.md#L25` (showcase/demo surfaces removed in v3; current config UI is the practical reference surface)

### Known Limitations / Caveats

- Small inline metric chips are allowed when they directly support nearby decisions.
- Temporary exception allowed only for true executive overview pages explicitly requested by product/user.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
