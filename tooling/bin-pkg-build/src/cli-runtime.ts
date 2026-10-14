#!/usr/bin/env bun
import 'reflect-metadata'

import { CommandFactory } from 'nest-commander'

import { c } from './utils/colors'

/**
 * The options `CommandFactory.run` accepts, as it declares them.
 *
 * Read off the function rather than imported by name: nest-commander does not
 * export `CommandFactoryRunOptions` from its index, and re-declaring the shape
 * here would drift the moment the factory's signature changes.
 */
type CliOptions = Parameters<typeof CommandFactory.run>[1]

/**
 * The CLI option set, shared by both ways of running it.
 *
 * `logger: false` because the builder's own output (colored progress lines and
 * raw compiler output) is the UX; Nest's logger would only prefix it.
 */
export function cliOptions(): CliOptions {
    return {
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
    }
}

/**
 * Install the arguments and run a command graph.
 *
 * `CommandFactory` has no `argv` option — commander reads `process.argv`
 * directly — so the arguments are set here, leaving the process in the same
 * state a direct invocation would have produced. The explicit `process.exit(0)`
 * is required because the Nest application context can keep handles open after
 * the command resolves.
 *
 * Lives here rather than in `main.ts` so both CLI entries can share it without
 * importing each other: `main` runs the cwd's package, `cli` runs a config
 * already in hand, and neither should have to depend on the other to do it.
 */
export async function run(
    module: Parameters<typeof CommandFactory.run>[0],
    argv: string[]
): Promise<never> {
    process.argv = [...process.argv.slice(0, 2), ...argv]
    await CommandFactory.run(module, cliOptions())
    process.exit(0)
}
