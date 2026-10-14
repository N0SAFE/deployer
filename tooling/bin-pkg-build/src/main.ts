#!/usr/bin/env bun
import { CommandFactory } from 'nest-commander'

import { AppModule } from './app.module'
import { run } from './cli-runtime'
import { c } from './utils/colors'

/**
 * The `pkg-build` CLI, running from the process cwd.
 *
 * This is the path that does not already hold a config: the cwd names the
 * package, and `PkgConfigService` imports the config from it. Exported as
 * `main(argv)` so the bin can hand the arguments over explicitly — the CLI is a
 * library entry with a process wrapper around it, not a script that only works
 * as one.
 */
export async function main(
    argv: string[] = process.argv.slice(2)
): Promise<never> {
    return run(AppModule, argv)
}

/**
 * Run when this file IS the process entry point: the source fallback, which is
 * also how the package builds itself. When the bin imports the built `main.js`
 * to call `main` itself, this stays inert.
 */
if (import.meta.main) {
    void main().catch((error: unknown) => {
        console.error(
            `${c.red('x')} ${error instanceof Error ? error.message : String(error)}`
        )
        process.exit(1)
    })
}
