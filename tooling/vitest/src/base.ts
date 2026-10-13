/// <reference types="vitest" />
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type ViteUserConfigExport } from 'vitest/config'

/**
 * Alias every workspace package name to its `src` directory.
 *
 * Tests must run against **source**, not built output. Packages publish
 * `exports` whose runtime targets are `dist/**`, so an import of
 * `@deployer/orpc-utils/builder/x` would load the built copy while a sibling module
 * imports the source directly — two module instances, which breaks shared state
 * and circular initialisation (`Cannot access 'X' before initialization`).
 *
 * String keys prefix-match in Vite, so `@deployer/utils` also covers
 * `@deployer/utils/anything`.
 *
 * Walks upward from cwd to find the workspace root, then registers each
 * package that has both a manifest and a `src` directory.
 */
export function workspaceSourceAliases(): Record<string, string> {
  const aliases: Record<string, string> = {}

  const packagesDir = findPackagesDir()
  if (!packagesDir) return aliases

  // Packages live both directly under packages/ and one level deeper
  // (packages/<group>/<name>).
  const candidates: string[] = []
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    candidates.push(entry.name)
    const nested = join(packagesDir, entry.name)
    for (const inner of readdirSync(nested, { withFileTypes: true })) {
      if (inner.isDirectory()) candidates.push(join(entry.name, inner.name))
    }
  }

  for (const rel of candidates) {
    const pkgDir = join(packagesDir, rel)
    const manifestPath = join(pkgDir, 'package.json')
    const src = join(pkgDir, 'src')
    // `src` may itself be absent for root-entry or config-only packages.
    if (!existsSync(manifestPath) || !existsSync(src)) continue
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string }
      if (manifest.name) aliases[manifest.name] = src
    } catch {
      // Ignore unreadable manifests.
    }
  }
  return aliases
}

/** Walk up from cwd until a `packages/` directory is found. */
function findPackagesDir(): string | null {
  let current = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(current, 'packages')
    if (existsSync(candidate)) return candidate
    const parent = resolve(current, '..')
    if (parent === current) break
    current = parent
  }
  return null
}

/** One alias rule. The array form, because object keys have no guaranteed order. */
export type AliasEntry = { find: string | RegExp; replacement: string }

/**
 * The base alias rules, in ARRAY form and in a deliberate order.
 *
 * ── WHY THIS IS NO LONGER AN OBJECT ─────────────────────────────────────────
 * The object form was `{ '@': './src', '~': './', ...packages }`, and Vite gives
 * object keys no guaranteed precedence. That worked only because no consumer had
 * two aliases where one was a prefix of the other — until `apps/api` needed
 * `@/core/*` to resolve into `../shared/src/core/*` while `@/*` still resolved into
 * its own `./src/*`. With `'@'` winning, every `@/core/...` import was rewritten to
 * `./src/core/...`, a directory that does not exist.
 *
 * Order, most specific first:
 *   1. `@deployer/<name>` — workspace packages, so a test loads SOURCE not `dist/`
 *   2. `~`             — the project root
 *   3. `@/`            — the project's own `src/`, LAST because `'@'` also
 *                        prefix-matches `@deployer/...` and every `@/…` subpath
 *
 * `@/` is expressed as a regex capturing the remainder so a consumer can put its
 * own `@/core` rule ahead of it without the two fighting.
 */
function baseAliasEntries(): AliasEntry[] {
  return [
    ...Object.entries(workspaceSourceAliases()).map(([find, replacement]) => ({ find, replacement })),
    { find: '~', replacement: '.' },
    { find: /^@\/(.*)$/, replacement: 'src/$1' },
    // A bare `@` import (no subpath) still resolves to `src`.
    //
    // ── WHY THIS IS A REGEX AND NOT THE STRING '@' ──────────────────────────
    // `@rollup/plugin-alias` orders its entries with REGEX rules last, whatever
    // position they hold in the array. A string `'@'` is therefore evaluated
    // before `/^@\/core/`, and its match rule (`importee.startsWith(find + '/')`)
    // makes it swallow every `@/core/...` import — rewriting it to
    // `src/@/core/...` and undoing the shared remap entirely. Anchoring the regex
    // to `@` alone means it matches only a bare `@` and defers everything else to
    // the rules above it.
    { find: /^@$/, replacement: 'src' },
  ]
}

/**
 * Base Vitest configuration for all packages
 */
export const createBaseConfig = (overrides: ViteUserConfigExport = {}): ViteUserConfigExport => {
  const baseAliases: AliasEntry[] = baseAliasEntries()

  // `resolve.alias` from an override must ADD to the base aliases, not replace
  // them — otherwise a package that declares its own alias silently loses source
  // resolution for every dependency.
  //
  // An override ARRAY is prepended (its rules are more specific) and the base
  // array appended after it. An override OBJECT keeps the historical spread
  // behaviour so existing consumers are unaffected.
  const overrideResolve = (overrides as { resolve?: { alias?: Record<string, string> | AliasEntry[] } }).resolve
  const overrideAlias = overrideResolve?.alias

  const alias: Record<string, string> | AliasEntry[] = Array.isArray(overrideAlias)
    ? [...overrideAlias, ...baseAliases]
    : { ...Object.fromEntries(baseAliases.map((entry) => [String(entry.find), entry.replacement])), ...(overrideAlias ?? {}) }

  const merged: ViteUserConfigExport = {
    ...overrides,
    resolve: {
      ...overrideResolve,
      alias,
    },
  }

  return defineConfig({
    test: {
      globals: true,
      environment: 'node',
      include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/cypress/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*'
      ],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        reportsDirectory: './coverage',
        clean: true,
        exclude: [
          'coverage/**',
          'dist/**',
          '**/[.]**',
          'packages/*/test{,s}/**',
          '**/*.d.ts',
          '**/virtual:*',
          '**/__x00__*',
          '**/\x00*',
          'cypress/**',
          'test{,s}/**',
          'test{,-*}.{js,cjs,mjs,ts,tsx,jsx}',
          '**/*{.,-}test.{js,cjs,mjs,ts,tsx,jsx}',
          '**/*{.,-}spec.{js,cjs,mjs,ts,tsx,jsx}',
          '**/tests/**',
          '**/__tests__/**'
        ]
      },
      // Common setup files
      setupFiles: [],
      // Timeout settings
      testTimeout: 10000,
      hookTimeout: 10000,
    },
    // Aliases are merged into `merged.resolve` above, including any package
    // overrides.
    ...merged,
  })
}

export const defaultConfig = createBaseConfig()

export default defaultConfig
