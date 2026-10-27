#!/usr/bin/env bun
/**
 * Report `@deployer/*` imports whose subpath its package does NOT export.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * A package's `exports` map is CLOSED: a subpath that is not declared does not
 * fall back to directory resolution, so
 *
 *   @deployer/nest-schema/global/runtime
 *
 * fails even though `dist/esm/global/runtime/` exists as a directory — the
 * wildcard expands to `dist/esm/global/runtime.mjs`, which is not a file.
 *
 * That class of mistake is invisible to `bun check --no-script` (the specifier is just a
 * string) and surfaces only at RUNTIME, as `Cannot find module`, inside
 * whichever container happens to import it first. Enumerating them once is
 * cheaper than finding them one crash at a time.
 *
 * Run: `bun --bun scripts/check-package-subpath-imports.ts`
 */

import { Glob } from 'bun'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')

interface PackageExports {
    name: string
    dir: string
    /** Every `exports` subpath exactly as declared. */
    subpaths: Set<string>
    /** Declared subpaths containing `*`. */
    wildcards: string[]
}

/** Every workspace package's name and its declared `exports` subpaths. */
function readPackages(): Map<string, PackageExports> {
    const packages = new Map<string, PackageExports>()

    for (const pattern of [
        'apps/**/package.json',
        'packages/**/package.json',
        'tooling/**/package.json',
    ]) {
        for (const rel of new Glob(pattern).scanSync({ cwd: ROOT })) {
            if (rel.includes('node_modules')) continue
            const manifestPath = path.join(ROOT, rel)
            let manifest: { name?: string; exports?: Record<string, unknown> }
            try {
                manifest = JSON.parse(
                    fs.readFileSync(manifestPath, 'utf8')
                ) as typeof manifest
            } catch {
                continue
            }
            if (manifest.name === undefined) continue
            packages.set(manifest.name, {
                name: manifest.name,
                dir: path.dirname(rel),
                subpaths: new Set(Object.keys(manifest.exports ?? {})),
                wildcards: Object.keys(manifest.exports ?? {}).filter((k) =>
                    k.includes('*')
                ),
            })
        }
    }

    return packages
}

/**
 * Resolve `subpath` to the file it names, or `null` when nothing resolves.
 *
 * ── WHY THIS CHECKS A FILE AND NOT JUST THE MAP ─────────────────────────
 * The map alone is not enough: `./*` matches `./global/runtime`, which expands
 * under the wildcard to `./dist/esm/global/runtime.mjs`. That key EXISTS in the
 * sense that the pattern matches, but the file does not — `global/runtime` is a
 * DIRECTORY, so the specifier fails at runtime while a map-only check reports
 * it as fine.
 *
 * So resolution mirrors Node: an exact key wins, otherwise the wildcard whose
 * prefix and suffix match, and the target is only accepted when the FILE it
 * names is present on disk. A directory is never a valid target — `exports`
 * disables directory resolution entirely.
 */
function resolveExport(pkg: PackageExports, subpath: string): string | null {
    const manifest = JSON.parse(
        fs.readFileSync(path.join(ROOT, pkg.dir, 'package.json'), 'utf8')
    ) as { exports?: Record<string, unknown> }

    const maps = manifest.exports ?? {}

    /** The chosen target for one export key, preferring `import`. */
    const targetOf = (key: string): string | null => {
        const entry = maps[key]

        /**
         * Walk the condition tree for a JS target.
         *
         * NESTED conditions are the norm for a JSX package: `@deployer/ui`
         * nests under `development`/`production` so a consumer's bundler picks
         * the matching React JSX runtime. Looking only for a top-level `import`
         * finds NOTHING there, which reported every one of its ~1000 subpath
         * imports as broken — a false positive that would have buried the real
         * findings.
         *
         * `types` is skipped: it names a `.d.ts`, not the runtime file a
         * runtime resolution would load.
         */
        const pick = (value: unknown): string | null => {
            if (typeof value === 'string') return value
            if (value === null || typeof value !== 'object') return null

            const conditions = value as Record<string, unknown>
            for (const name of ['import', 'default', 'require']) {
                const found = pick(conditions[name])
                if (found !== null) return found
            }
            // Any other branch (`development`, `production`, …) is still a real
            // target; checking one is enough to prove the file exists.
            for (const [name, nested] of Object.entries(conditions)) {
                if (name === 'types') continue
                const found = pick(nested)
                if (found !== null) return found
            }
            return null
        }

        return pick(entry)
    }

    /** Expand a key's target for `subpath`, then test the resulting FILE. */
    const tryKey = (key: string): string | null => {
        let target = targetOf(key)
        if (target === null) return null

        if (key.includes('*')) {
            if (key === subpath) return null
            const [prefix, suffix = ''] = key.split('*')
            const head = prefix ?? ''
            if (!subpath.startsWith(head) || !subpath.endsWith(suffix)) {
                return null
            }
            const middle = subpath.slice(
                head.length,
                subpath.length - suffix.length
            )
            target = target.replace('*', middle)
        } else if (key !== subpath) {
            return null
        }

        const abs = path.join(ROOT, pkg.dir, target)
        try {
            // MUST be a file. `global/runtime` is a directory, and a directory
            // is exactly the case that looks resolved and fails at runtime.
            return fs.statSync(abs).isFile() ? abs : null
        } catch {
            return null
        }
    }

    // Exact key first, then every wildcard — Node's precedence.
    if (pkg.subpaths.has(subpath)) {
        const exact = tryKey(subpath)
        if (exact !== null) return exact
    }
    for (const key of pkg.wildcards) {
        const resolved = tryKey(key)
        if (resolved !== null) return resolved
    }
    return null
}

const packages = readPackages()

/** `@deployer/nest-schema/global/runtime` -> `@deployer/nest-schema` + subpath. */
function splitSpecifier(specifier: string): { pkg: string; subpath: string } {
    const parts = specifier.split('/')
    return {
        pkg: `${parts[0]}/${parts[1]}`,
        subpath: parts.length > 2 ? `./${parts.slice(2).join('/')}` : '.',
    }
}

const IMPORT_PATTERN = /(?:from\s+|import\()\s*["'](@deployer\/[^"']+)["']/g

/**
 * Strip comments before scanning.
 *
 * A specifier inside a JSDoc `@example` is documentation, not an import — but it
 * reads identically to one, so an un-stripped scan reports a doc comment as a
 * broken import. Found exactly that: `agentAuth.ts` documents its own usage in
 * a block whose specifier had gone stale, and the checker flagged it.
 *
 * The comment is still worth CORRECTING (a wrong example misleads readers), so
 * this only stops the checker from treating documentation as a dependency.
 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '')
}

const problems: string[] = []
let checked = 0

for (const pattern of [
    'apps/**/*.{ts,tsx}',
    'packages/**/*.{ts,tsx}',
    'tooling/**/*.{ts,tsx}',
    'scripts/**/*.ts',
]) {
    for (const rel of new Glob(pattern).scanSync({ cwd: ROOT })) {
        if (rel.includes('node_modules') || rel.includes('/dist/')) continue
        const abs = path.join(ROOT, rel)
        let source: string
        try {
            source = fs.readFileSync(abs, 'utf8')
        } catch {
            continue
        }

        for (const match of stripComments(source).matchAll(IMPORT_PATTERN)) {
            const specifier = match[1]
            if (specifier === undefined) continue
            const { pkg, subpath } = splitSpecifier(specifier)
            const target = packages.get(pkg)
            // Only workspace packages have an export map this tool can police;
            // an unknown `@deployer/*` name is a different problem.
            if (target === undefined) continue

            checked += 1
            if (resolveExport(target, subpath) === null) {
                problems.push(`${rel}: ${specifier}`)
            }
        }
    }
}

const unique = [...new Set(problems)].sort()

console.log(
    `checked ${String(checked)} @deployer import(s) across the workspace`
)
if (unique.length === 0) {
    console.log('ok — every subpath is exported by its package')
    process.exit(0)
}

console.error(
    `\nx ${String(unique.length)} import(s) name a subpath their package does not export:\n`
)
for (const problem of unique) console.error(`  ${problem}`)
console.error(
    '\nThe `exports` map is CLOSED: an undeclared subpath has no directory\n' +
        'fallback, so these fail at RUNTIME with `Cannot find module`.\n'
)
process.exit(1)
