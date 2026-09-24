/// <reference types="vitest" />
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type ViteUserConfigExport } from 'vitest/config'

/**
 * Alias every workspace package name to its `src` directory.
 *
 * Tests must run against **source**, not built output. Packages publish
 * `exports` whose runtime targets are `dist/**`, so an import of
 * `@repo/orpc-utils/builder/x` would load the built copy while a sibling module
 * imports the source directly — two module instances, which breaks shared state
 * and circular initialisation (`Cannot access 'X' before initialization`).
 *
 * String keys prefix-match in Vite, so `@repo/utils` also covers
 * `@repo/utils/anything`.
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

/**
 * Base Vitest configuration for all packages
 */
export const createBaseConfig = (overrides: ViteUserConfigExport = {}): ViteUserConfigExport => {
  const baseAliases = {
    '@': './src',
    '~': './',
    // Workspace packages resolve to source so a test never loads a built copy
    // alongside the source it is testing.
    ...workspaceSourceAliases(),
  }

  // `resolve.alias` from an override must ADD to the workspace aliases, not
  // replace them — otherwise a package that declares its own `@` alias silently
  // loses source resolution for every dependency.
  const overrideResolve = (overrides as { resolve?: { alias?: Record<string, string> } }).resolve
  const merged: ViteUserConfigExport = {
    ...overrides,
    resolve: {
      ...overrideResolve,
      alias: { ...baseAliases, ...(overrideResolve?.alias ?? {}) },
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
