#!/usr/bin/env bun
/**
 * Move every legacy `pkgBuild` block out of a `package.json` and into a typed
 * `pkg-build.config.ts` beside it.
 *
 * The builder rejects the legacy key outright, so this is a one-shot migration,
 * not a compatibility layer. Idempotent: a package that already has a config file
 * is skipped.
 *
 * Run: `bun --bun scripts/migrate-pkg-build-config.ts`
 */

import { Glob } from 'bun'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const CONFIG_FILE = 'pkg-build.config.ts'
const LEGACY_KEY = 'pkgBuild'

/** Keys in the order `build()` output reads best. */
const KEY_ORDER = [
    'root',
    'entries',
    'include',
    'formats',
    'variants',
    'outDir',
    'flat',
    'target',
    'splitting',
    'minify',
    'sourcemap',
    'external',
    'copy',
    'keepEnv',
    'types',
] as const

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/** Render a JSON-ish value as a TS literal, indented to `depth` levels of 4. */
function render(value: Json, depth: number): string {
    const pad = '    '.repeat(depth)
    const padIn = '    '.repeat(depth + 1)

    if (Array.isArray(value)) {
        if (value.length === 0) return '[]'
        const items = value.map((item) => `${padIn}${render(item, depth + 1)}`)
        return `[\n${items.join(',\n')},\n${pad}]`
    }
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value)
        if (entries.length === 0) return '{}'
        const props = entries.map(
            ([key, inner]) => `${padIn}${quoteKey(key)}: ${render(inner, depth + 1)}`
        )
        return `{\n${props.join(',\n')},\n${pad}}`
    }
    if (typeof value === 'string') return quoteString(value)
    return String(value)
}

/** Bare identifier when safe, quoted key otherwise. */
function quoteKey(key: string): string {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : quoteString(key)
}

/** Single-quoted, matching the repo's Prettier config. */
function quoteString(text: string): string {
    return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** Reorder known keys first, then any unknown remainder alphabetically. */
function orderKeys(block: Record<string, Json>): Record<string, Json> {
    const ordered: Record<string, Json> = {}
    for (const key of KEY_ORDER) {
        if (key in block) ordered[key] = block[key]
    }
    for (const key of Object.keys(block).sort()) {
        if (!(key in ordered)) ordered[key] = block[key]
    }
    return ordered
}

function writeConfig(pkgDir: string, block: Record<string, Json>): void {
    const body = render(orderKeys(block), 0)
    const file = `import { build } from '@deployer/pkg-build/config'\n\n/** Build configuration for \`${readName(pkgDir)}\`. */\nexport default build(${body})\n`
    fs.writeFileSync(path.join(pkgDir, CONFIG_FILE), file)
}

function readName(pkgDir: string): string {
    const manifest = JSON.parse(
        fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')
    ) as { name?: string }
    return manifest.name ?? path.basename(pkgDir)
}

/**
 * Does any script invoke the pkg-build CLI?
 *
 * Any script, not just `build`: `@deployer/config-eslint` is a hybrid — its JS build
 * is a custom bundler (pinned TypeScript 6) but its declarations pass goes
 * through pkg-build, so it still needs a config file.
 */
function usesPkgBuild(pkgDir: string): boolean {
    const manifest = JSON.parse(
        fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')
    ) as { scripts?: Record<string, string> }
    return Object.values(manifest.scripts ?? {}).some(
        (script) =>
            /bun\s+(?:--bun\s+)?pkg-build(?:\s|$)/.test(script) ||
            /bin-pkg-build\//.test(script)
    )
}

/**
 * Scaffold a defaults-only config for a package that builds with pkg-build but
 * has no config file.
 *
 * The file is not decoration: it is the only place the build surface is
 * discoverable from the package root, and it is what `type-check` reads to prove
 * the config parses. An empty `build({})` reproduces exactly what the package got
 * from the implicit defaults.
 */
function scaffoldConfig(pkgDir: string): void {
    const file = `import { build } from '@deployer/pkg-build/config'\n\n/** Build configuration for \`${readName(pkgDir)}\` — defaults apply. */\nexport default build({})\n`
    fs.writeFileSync(path.join(pkgDir, CONFIG_FILE), file)
}

function main(): void {
    const manifests = new Glob('{apps,packages,tooling}/**/package.json').scanSync(
        { cwd: ROOT, absolute: true }
    )

    let migrated = 0
    let scaffolded = 0
    for (const manifestPath of manifests) {
        if (manifestPath.includes('node_modules')) continue
        const pkgDir = path.dirname(manifestPath)
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
            [key: string]: Json
        }
        const hasConfig = fs.existsSync(path.join(pkgDir, CONFIG_FILE))
        const block = manifest[LEGACY_KEY]

        if (block === undefined) {
            // A consumer with no config file at all: give it the explicit,
            // typed defaults so the surface is discoverable and type-checked.
            if (!hasConfig && usesPkgBuild(pkgDir)) {
                scaffoldConfig(pkgDir)
                console.log(`scaffold ${path.relative(ROOT, pkgDir)}`)
                scaffolded += 1
            }
            continue
        }

        if (hasConfig) {
            console.log(`skip   ${path.relative(ROOT, pkgDir)} (config exists)`)
            continue
        }
        if (block === null || typeof block !== 'object' || Array.isArray(block)) {
            throw new Error(
                `${path.relative(ROOT, manifestPath)}: "${LEGACY_KEY}" must be an object`
            )
        }

        writeConfig(pkgDir, block as Record<string, Json>)
        delete manifest[LEGACY_KEY]
        fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`)
        console.log(`migrate  ${path.relative(ROOT, pkgDir)}`)
        migrated += 1
    }

    console.log(
        `done — ${String(migrated)} migrated, ${String(scaffolded)} scaffolded`
    )
}

main()
