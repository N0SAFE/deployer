#!/usr/bin/env bun
/**
 * Rewrites package-internal `@/...` imports to relative imports.
 *
 * Why: the web app's tsconfig maps `@/*` → `apps/web/src/*`. When the web app
 * type-checks, it pulls in `packages/ui/base` sources whose internal `@/lib`,
 * `@/components`, `@/hooks` imports then resolve against the WEB's alias and
 * fail ("Cannot find module"). Packages must not use a bare `@/` alias that
 * collides with consuming apps — relative imports are the honest fix.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'packages/ui/base/src')

/** Map an alias spec (e.g. "@/lib/utils") to its absolute source path. */
function resolveAlias(spec: string): string | null {
  const rest = spec.replace(/^@\//, '')
  const candidates = [
    join(SRC, rest + '.ts'),
    join(SRC, rest + '.tsx'),
    join(SRC, rest, 'index.ts'),
    join(SRC, rest, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate
  }
  return null
}

/** Compute a relative import specifier from `fromFile` to `targetFile`. */
function toRelative(fromFile: string, targetFile: string): string {
  const fromDir = dirname(fromFile)
  let rel = relative(fromDir, targetFile).replace(/\\/g, '/')
  rel = rel.replace(/\.[cm]?[jt]sx?$/, '')
  if (!rel.startsWith('.')) rel = './' + rel
  return rel
}

const files: string[] = []
function walk(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
  }
}
walk(SRC)

let changed = 0
for (const file of files) {
  const content = readFileSync(file, 'utf8')
  const newContent = content.replace(/(from\s+['"])(@\/[^'"]+)(['"])/g, (match, prefix, spec, suffix) => {
    const target = resolveAlias(spec)
    if (!target) {
      console.error(`⚠  unresolvable alias ${spec} in ${file}`)
      return match
    }
    return `${prefix}${toRelative(file, target)}${suffix}`
  })
  if (newContent !== content) {
    writeFileSync(file, newContent)
    changed += 1
  }
}
console.log(`✅ converted ${changed} file(s)`)
