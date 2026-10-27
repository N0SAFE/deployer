import 'reflect-metadata'

import { CommandFactory } from 'nest-commander'
import { hasProperty, isError, isObjectWithMessage } from '@deployer/type-guards'

import { DependencyBuilderModule } from './modules/dependency-builder.module'
import { scopedLogger } from './logger'

/**
 * Entry point for the dependency-builder CLI.
 *
 * This process is the single owner of internal workspace package builds in the
 * dev stack. It discovers which applications compose has enabled, computes the
 * union of the internal packages they need, publishes those artifacts from the
 * IMAGE into the shared volume, and then stays in Turbo watch mode.
 *
 * ── THE IMAGE ALREADY BUILT THEM ────────────────────────────────────────────
 * The Dockerfile runs a full `turbo run build`, so by the time this process
 * starts every package is built. Its job is to PUBLISH that work — adopt the
 * image's `dist/` trees into the volume and open the gate — not to repeat it.
 * A build only runs when something is genuinely missing (a partial volume, a
 * host run, a package the image did not know about).
 *
 * It is a Nest + nest-commander app for the same reason `apps/api`'s CLI is: the
 * build orchestration has real dependencies (a discovery service, a planner, a
 * Turbo runner) that are easier to reason about as injected providers than as
 * free functions, and the repo already standardises on that shape.
 */
const logger = scopedLogger('Bootstrap')

/** Was this thrown by commander to report `--help`? Not a failure. */
function isHelpDisplayed(err: unknown): boolean {
    return (
        isObjectWithMessage(err) &&
        hasProperty(err, 'code') &&
        err.code === 'commander.helpDisplayed'
    )
}

async function bootstrap(): Promise<void> {
    try {
        await CommandFactory.run(DependencyBuilderModule, {
            logger: ['error', 'warn', 'log'],
            errorHandler: (err: unknown) => {
                // Commander exits through this handler for `--help`; that is not
                // a failure, so it must not be reported as one.
                if (isHelpDisplayed(err)) {
                    process.exit(0)
                }

                logger.error(isError(err) ? err : new Error(String(err)))
                process.exit(1)
            },
        })
    } catch (err: unknown) {
        logger.error(isError(err) ? err : new Error(String(err)))
        process.exit(1)
    }
}

// Not a top-level `await`: this package is built to both ESM and CJS, and CJS
// has no top-level await. The floating promise is deliberate — `bootstrap`
// owns every exit path and never resolves into a state worth awaiting.
void bootstrap()
