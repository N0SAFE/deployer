# AGENTS.md — apps/doc (Docs Site)

Follow the root `AGENTS.md` first. This file adds Docs-specific guidance.

## Scope Rules

- This app renders documentation content from `apps/doc/content` and `docs/`.
- Keep content DRY; prefer linking to `docs/*.md` over duplicating.

## Static Export (read this before changing config or routes)

This app is a **static export** (`output: 'export'`), so it is served from an
object store (S3/CloudFront), not a Node server. That constrains everything:

- **No server at request time.** No route handlers that answer queries, no
  `params`/`searchParams` reads, no middleware, no image optimization, no
  ISR/revalidation. Anything dynamic must move to build time or the client.
- **Every route must be enumerable.** Dynamic segments need
  `generateStaticParams` and `dynamicParams = false`; unenumerated paths cannot
  render on demand.
- **`dynamic = 'force-static'` is required on route handlers**, which is
  likewise why `cacheComponents` and `partialPrefetching` are off — they
  conflict with the export (see the comment in `next.config.ts`).
- **`trailingSlash: true` is load-bearing.** It emits `foo/index.html` instead
  of `foo.html`, which is what lets a plain object store resolve `/foo/` via its
  index-document lookup. Turning it off breaks every URL on S3.
- **Search is client-side.** `/api/search` exports the whole index as a static
  JSON file (`staticGET`), and `src/components/search.tsx` loads it into the
  browser with `staticClient`. There is no query endpoint.

`next dev` still works for authoring (it uses the dev server), and `next build`
writes `out/`. **`next start` does not exist here** — `bun --bun serve.ts`
serves `out/` with the same index-document semantics as S3.

Deploy with `bun --bun run deploy:doc:s3 --bucket <name>`.

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

## Turbopack Filesystem Cache

`experimental.turbopackFileSystemCacheForDev` / `...ForBuild` are set explicitly in `next.config.ts` (the resolved Next range is `^16.1.2`, where build caching is not yet default). The cache lives in `.next/dev/cache/turbopack` (dev) and `.next/cache/turbopack` (build).

Compose mounts a named volume (`doc_next_cache_dev` / `doc_next_cache_prod`) over the `cache/` directory only, so the dist-dir lock at `.next/dev/lock` stays on the container layer. See `.docs/guides/DOCKER-BUILD-STRATEGIES.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
