# AGENTS.md — apps/doc (Docs Site)

Follow the root `AGENTS.md` first. This file adds Docs-specific guidance.

## Scope Rules

- This app renders documentation content from `apps/doc/content` and `docs/`.
- Keep content DRY; prefer linking to `docs/*.md` over duplicating.

## Quick Context via MCP

- Inspect this app:
  - `repo://app/doc/package.json`
  - `repo://app/doc/dependencies`

## Workflows

Development:
- Prefer MCP: `docker-up { mode: "dev", target: "web" }` if docs stack shares web infra
- Legacy: `bun run dev:doc` — start docs site

Content sources:
- Many pages mirror files in `docs/` with short summaries; ensure link references are correct.

## Boundaries

- Do not invent documentation—derive from actual repo state and update the canonical files under `docs/`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
