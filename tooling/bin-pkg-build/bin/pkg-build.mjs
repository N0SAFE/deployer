#!/usr/bin/env bun
/**
 * `pkg-build` launcher — the committed entry point the `bin` points at.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The bin used to point straight at `dist/cjs/main.js`. That cannot work on a
 * cold tree: `dist/` is git-ignored and excluded by `.dockerignore`, and a bin's
 * SYMLINK is created by the package manager at INSTALL time. If the target does
 * not exist then, no `node_modules/.bin/pkg-build` is ever linked — every
 * consumer's `bun --bun pkg-build` then fails with `Script not found "pkg-build"`,
 * from a package whose own source is perfectly fine. It is a bootstrap cycle:
 * pkg-build is what builds the tree, so it cannot require a built tree to install.
 *
 * This launcher breaks the cycle. It is plain committed JavaScript with no
 * imports of its own, so the bin always links, and it resolves the real CLI at
 * RUN time by preferring the built output and falling back to source.
 *
 * ── ORDER OF PREFERENCE ─────────────────────────────────────────────────────
 *   1. `dist/cjs/main.js` — the built CLI. Preferred because it is pre-compiled,
 *      so NestJS decorator metadata is already emitted and it works from ANY cwd.
 *      Running `src/main.ts` instead means bun compiles it at each invocation and
 *      resolves `tsconfig.json` from the CONSUMER's directory, which lacks the
 *      decorator settings and fails.
 *   2. `src/main.ts` — only when `dist` is absent (a cold checkout before the
 *      first build). Run with `--cwd` set to this package so bun picks up the
 *      right `tsconfig.json`.
 *
 * The exit code and stdio are passed through unchanged.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))

/** The built CLI, if this package has been built. */
const builtCli = join(packageDir, 'dist/cjs/main.js')
/** The source CLI, used only when there is no build yet. */
const sourceCli = join(packageDir, 'src/main.ts')

const useBuilt = existsSync(builtCli)
const entry = useBuilt ? builtCli : sourceCli

if (!existsSync(entry)) {
    console.error(
        `pkg-build: neither ${builtCli} nor ${sourceCli} exists — the package is incomplete.`
    )
    process.exit(1)
}

// `--cwd` matters only for the source fallback: the built output has no tsconfig
// to resolve. Passing it always keeps the two paths identical in behaviour.
const args = useBuilt
    ? [entry, ...process.argv.slice(2)]
    : ['--cwd', packageDir, entry, ...process.argv.slice(2)]

const child = Bun.spawn(['bun', '--bun', ...args], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
})

process.exit(await child.exited)
