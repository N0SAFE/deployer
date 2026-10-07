#!/usr/bin/env bun
import 'reflect-metadata'

import { CommandFactory } from 'nest-commander'

import { AppModule } from './app.module'
import { c } from './utils/colors'

/**
 * CLI bootstrap.
 *
 * `logger: false` because the builder's own output (colored progress lines and
 * raw compiler output) is the UX; Nest's logger would only prefix it. The
 * explicit `process.exit(0)` is required because the Nest application context
 * can keep handles open after the command resolves.
 */
async function main(): Promise<void> {
    await CommandFactory.run(AppModule, {
        cliName: 'pkg-build',
        logger: false,
        errorHandler: (error: Error) => {
            // commander signals `--help`/`--version` by throwing; that is success.
            if ('code' in error && error.code === 'commander.helpDisplayed') {
                process.exit(0)
            }
            console.error(`${c.red('x')} ${error.message}`)
            process.exit(1)
        },
    })
    process.exit(0)
}

void main().catch((error: unknown) => {
    console.error(
        `${c.red('x')} ${error instanceof Error ? error.message : String(error)}`
    )
    process.exit(1)
})
