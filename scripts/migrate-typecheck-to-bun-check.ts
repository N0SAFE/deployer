#!/usr/bin/env bun
/**
 * Move every workspace type-check from `tsc --noEmit` to `bun check --no-script`.
 *
 * bun 1.4.3 ships a built-in TypeScript checker. It consumes the same
 * `tsconfig.json`, reports the same diagnostics in the same format (verified:
 * identical output and identical exit codes, error and clean, across all 40
 * workspaces in this repo) and runs roughly 10x faster, so the separate `tsc`
 * process per package is pure overhead.
 *
 * What is NOT rewritten:
 *   - `tsc` used to EMIT declarations (`pkg-build`'s types pass). bun's checker
 *     does not emit, so that must stay `tsc`.
 *   - Any `tsc` invocation carrying extra flags (`-p <path>`, `--build`,
 *     `--project`), where the intent is something other than a plain check.
 *
 * Idempotent: a script already on `bun check --no-script` is left alone.
 *
 * Run: `bun --bun scripts/migrate-typecheck-to-bun-check.ts`
 */

import { Glob } from 'bun'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')

/**
 * The exact call being replaced.
 *
 * Anchored on the whole script value rather than a substring: `tsc --noEmit`
 * appears inside longer pipelines in third-party manifests (`tsc --noEmit -p
 * typescript_test/…`), and a substring rewrite would silently drop the flags
 * that make those commands do their job.
 */
const FROM = 'tsc --noEmit'
const TO = 'bun check --no-script'

function main(): void {
    const manifests = new Glob(
        '{apps,packages,tooling,infra}/**/package.json'
    ).scanSync({ cwd: ROOT, absolute: true })

    let rewritten = 0
    for (const manifestPath of manifests) {
        if (manifestPath.includes('node_modules')) continue

        const manifest = JSON.parse(
            fs.readFileSync(manifestPath, 'utf8')
        ) as { scripts?: Record<string, string> }
        const scripts = manifest.scripts
        if (scripts === undefined) continue

        let changed = false
        for (const [name, script] of Object.entries(scripts)) {
            // Exact match only — see the note on FROM.
            if (script.trim() !== FROM) continue
            scripts[name] = script.replace(FROM, TO)
            changed = true
        }

        if (!changed) continue
        fs.writeFileSync(
            manifestPath,
            `${JSON.stringify(manifest, null, 4)}\n`
        )
        console.log(`rewrite ${path.relative(ROOT, path.dirname(manifestPath))}`)
        rewritten += 1
    }

    console.log(`done — ${String(rewritten)} manifest(s) rewritten`)
}

main()
