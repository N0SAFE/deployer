#!/usr/bin/env bun
/**
 * `pkg-build` launcher — the committed entry point the `bin` points at.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The bin must link at INSTALL time, when nothing has been built. A bin whose
 * target does not exist then is never symlinked, so every consumer's
 * `bun --bun pkg-build` fails with `Script not found "pkg-build"` — from a
 * package whose own source is fine. It is a bootstrap cycle: pkg-build is what
 * builds the tree, so it cannot need a built tree to install.
 *
 * This launcher breaks the cycle. It is plain committed JavaScript importing
 * only `node:*`, so the link always resolves, and it defers the choice of what
 * to run to run time. No TypeScript here on purpose: a `.mjs` file is evaluated
 * as JavaScript, so a type annotation would be a syntax error.
 *
 * ── WHAT IT RUNS ────────────────────────────────────────────────────────────
 * It is a thin shim: it locates the CLI and hands the arguments over. The CLI is
 * a nest-commander program that also exposes a library entry, `main(argv)`, so
 * the built path imports a module and passes the arguments as a parameter
 * instead of relying only on the environment.
 *
 * Order of preference:
 *   1. `dist/cjs/main.js` — the built CLI. Preferred because it is
 *      pre-compiled: NestJS relies on `emitDecoratorMetadata`, and a source file
 *      only gets that from a tsconfig carrying `experimentalDecorators`.
 *   2. `src/main.ts`, run with `--tsconfig-override` pointing at this package's
 *      own tsconfig — the cold-checkout path, before the first build.
 *
 * The override is load-bearing and must NOT be a `--cwd`. Bun resolves
 * `tsconfig.json` from the process cwd, and the CLI builds the package in that
 * cwd. A `--cwd` aimed at this package would hijack the build target: the CLI
 * would rebuild `@deployer/pkg-build` and exit 0 while the consumer's `dist/`
 * was never touched — a silent wrong-package build, worse than a crash. The
 * override supplies the decorator flags without moving the cwd.
 *
 * The exit code and stdio are passed through unchanged.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const builtCli = join(packageDir, 'dist/cjs/main.js')
const sourceCli = join(packageDir, 'src/main.ts')
const tsconfig = join(packageDir, 'tsconfig.json')

const args = process.argv.slice(2)

if (existsSync(builtCli)) {
    // `main` exits the process itself; awaiting it just keeps this frame alive.
    const { main } = await import(builtCli)
    await main(args)
} else if (existsSync(sourceCli)) {
    // The source path needs `--tsconfig-override`, which is a bun flag applied
    // at process start rather than an argument to `main`, so it cannot be
    // supplied to an in-process import. Re-run once with the flag, and the child
    // is then free to take the built path above.
    const child = Bun.spawn(
        ['bun', '--bun', '--tsconfig-override', tsconfig, sourceCli, ...args],
        { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' }
    )
    process.exit(await child.exited)
} else {
    console.error(
        `pkg-build: neither ${builtCli} nor ${sourceCli} exists — the package is incomplete.`
    )
    process.exit(1)
}
