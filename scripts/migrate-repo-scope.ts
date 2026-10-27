#!/usr/bin/env bun
/**
 * Rewrite stale `@deployer/*` imports to the current `@deployer/*` scope.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The workspace scope was renamed `@repo` -> `@deployer`, and every package's
 * `name` moved with it. Imports in a handful of files did not, so they name a
 * package that no longer exists and fail at RUNTIME:
 *
 *   error: Cannot find module '@deployer/vite-assets' from
 *   '/app/apps/setup/src/app.config.ts'
 *
 * `bun check --no-script` misses these because a specifier is only a string; nothing
 * resolves it. This rewrites the SCOPE PREFIX only, so every existing subpath
 * (`@deployer/nest-schema/global/deployment`) survives unchanged and is then subject
 * to `check-package-subpath-imports.ts` for the second class of mistake.
 *
 * Composes with that checker rather than duplicating it: this fixes the package
 * NAME, that one fixes the PATH inside it.
 *
 * Run: `bun --bun scripts/migrate-repo-scope.ts [--dry]`
 */

import { Glob } from 'bun'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const DRY = process.argv.includes('--dry')

/** `@deployer/` at the START of a specifier — the scope, never a subpath. */
const SCOPE = /(['"])(@repo\/)/g

let changed = 0
const touched: string[] = []

for (const pattern of [
    'apps/**/*.{ts,tsx,mts,cts}',
    'packages/**/*.{ts,tsx,mts,cts}',
    'tooling/**/*.{ts,tsx,mts,cts}',
    'scripts/**/*.{ts,tsx,mts,cts}',
]) {
    for (const rel of new Glob(pattern).scanSync({ cwd: ROOT })) {
        if (rel.includes('node_modules') || rel.includes('/dist/')) continue
        // This script DOCUMENTS the old scope in its own header, so it must not
        // rewrite itself — the header is the explanation of what it does.
        if (rel === 'scripts/migrate-repo-scope.ts') continue
        const abs = path.join(ROOT, rel)
        const source = fs.readFileSync(abs, 'utf8')

        // Only rewrite inside a quoted specifier, so a comment or a doc string
        // mentioning the old scope by name is left alone.
        const updated = source.replace(SCOPE, (_match, quote: string) => {
            return `${quote}@deployer/`
        })
        if (updated === source) continue

        changed += 1
        touched.push(rel)
        if (!DRY) fs.writeFileSync(abs, updated)
    }
}

// Root scripts and the workspace manifests can name the scope too (a
// `--filter=@deployer/...` breaks the same way).
for (const rel of ['package.json', 'turbo.json']) {
    const abs = path.join(ROOT, rel)
    const source = fs.readFileSync(abs, 'utf8')
    const updated = source.replace(/(['"])(@repo\/)/g, '$1@deployer/')
    if (updated === source) continue
    changed += 1
    touched.push(rel)
    if (!DRY) fs.writeFileSync(abs, updated)
}

console.log(`${DRY ? 'would rewrite' : 'rewrote'} ${String(changed)} file(s)`)
for (const file of touched.sort()) console.log(`  ${file}`)
