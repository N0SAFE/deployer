#!/usr/bin/env bun
/**
 * Point pre-restructure `@deployer/nest-schema/global/<name>` imports at the
 * barrel, `@deployer/nest-schema/global`.
 *
 * ── WHY THE FLAT PATHS BROKE ────────────────────────────────────────────────
 * `packages/nest/schema` was regrouped into `global/{fleet,health,identity,
 * platform,project,runtime,traefik}/` and its `exports` map was regenerated from
 * that layout. A specifier like `global/deployment` therefore expands — via the
 * `./*` wildcard — to `dist/esm/global/deployment.mjs`, which does not exist.
 * `deployment.ts` now lives under FOUR subdirectories, so there is no single
 * file the old path could mean.
 *
 * `./global` IS exported and its barrel re-exports every subdirectory, so it is
 * the one unambiguous target for all of them.
 *
 * The `exports` map is CLOSED, so this fails at runtime as `Cannot find module`
 * — invisible to `bun check --no-script`, which sees only a string.
 *
 * Run: `bun --bun scripts/fix-schema-global-imports.ts [--dry]`
 */

import { Glob } from 'bun'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const DRY = process.argv.includes('--dry')

/**
 * Subdirectories the schema's `global/` tree now has.
 *
 * A specifier whose last segment is one of these is ALREADY correct — e.g.
 * `global/identity/auth` — and must not be rewritten.
 */
const SUBDIRS = new Set([
    'fleet',
    'health',
    'identity',
    'platform',
    'project',
    'runtime',
    'traefik',
    'utils',
])

/**
 * `@deployer/nest-schema/global/<name>` — no subdirectory in the path.
 *
 * Two shapes come through here, distinguished by whether `<name>` is a real
 * FILE or a DIRECTORY in the built tree:
 *
 *   `global/deployment` -> no such file; the name exists under four
 *                          subdirectories, so it rewrites to the BARREL
 *                          (`@deployer/nest-schema/global`).
 *
 *   `global/runtime`    -> a DIRECTORY holding `index.mjs`. The wildcard
 *                          expands to `global/runtime.mjs`, which is not a file,
 *                          so it rewrites to that directory's INDEX.
 *
 * Both are the same underlying mistake — naming a path that resolves to nothing
 * under a CLOSED export map — so one pass fixes both.
 */
const FLAT_GLOBAL = /@deployer\/nest-schema\/global\/([a-z0-9-]+)(?=["'])/g

/** Does the built tree contain `global/<segment>.mjs` as a FILE? */
function isBuiltFile(segment: string): boolean {
    return fs.existsSync(
        path.join(ROOT, 'packages/nest/schema/dist/esm/global', `${segment}.mjs`)
    )
}

/** Does the built tree contain `global/<segment>/index.mjs`? */
function isBuiltDir(segment: string): boolean {
    return fs.existsSync(
        path.join(
            ROOT,
            'packages/nest/schema/dist/esm/global',
            segment,
            'index.mjs'
        )
    )
}

let changed = 0
const touched: string[] = []

for (const pattern of [
    'apps/**/*.{ts,tsx}',
    'packages/**/*.{ts,tsx}',
    'tooling/**/*.{ts,tsx}',
]) {
    for (const rel of new Glob(pattern).scanSync({ cwd: ROOT })) {
        if (rel.includes('node_modules') || rel.includes('/dist/')) continue
        const abs = path.join(ROOT, rel)
        const source = fs.readFileSync(abs, 'utf8')

        const updated = source.replace(FLAT_GLOBAL, (match, segment: string) => {
            // Already a real file (`global/deployment` never is; a future
            // `global/foo` might be) — leave it.
            if (isBuiltFile(segment)) return match
            // A subdirectory's own index: `global/runtime` -> `…/runtime/index`.
            if (SUBDIRS.has(segment) && isBuiltDir(segment)) {
                return `@deployer/nest-schema/global/${segment}/index`
            }
            // Otherwise the flat name only exists somewhere inside a
            // subdirectory, so the barrel is the unambiguous target.
            return '@deployer/nest-schema/global'
        })
        if (updated === source) continue

        changed += 1
        touched.push(rel)
        if (!DRY) fs.writeFileSync(abs, updated)
    }
}

console.log(
    `${DRY ? 'would rewrite' : 'rewrote'} ${String(changed)} file(s)`
)
for (const file of touched.sort()) console.log(`  ${file}`)
