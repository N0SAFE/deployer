import {
    BadRequestError,
    ForbiddenError,
    ValidationError,
} from '@deployer/errors'
import { Effect } from 'effect'
import { ZodError } from 'zod/v4'

import { ProjectForbidden, ProjectInvalid } from './domain/project.errors'
import { ProjectInfraFailure } from './project.failures'

/** Lift a Promise-returning infrastructure call; a rejection is an infrastructure failure. */
export function attempt<A>(
    run: () => Promise<A>
): Effect.Effect<A, ProjectInfraFailure> {
    return Effect.tryPromise({
        try: run,
        catch: (cause) => new ProjectInfraFailure({ cause }),
    })
}

/**
 * Lift a synchronous rule or parse into the Effect error channel.
 *
 * The rules throw `@deployer/errors` classes and the parsers throw `ZodError`: the known refusals
 * become the project domain's tagged failures, anything else is a defect (a bug, not a refusal).
 */
export function rule<A>(
    run: () => A
): Effect.Effect<A, ProjectForbidden | ProjectInvalid> {
    return Effect.suspend(
        (): Effect.Effect<A, ProjectForbidden | ProjectInvalid> => {
            try {
                return Effect.succeed(run())
            } catch (error) {
                if (error instanceof ForbiddenError)
                    return Effect.fail(
                        new ProjectForbidden({ reason: error.message })
                    )
                if (
                    error instanceof ValidationError ||
                    error instanceof BadRequestError ||
                    error instanceof ZodError
                ) {
                    return Effect.fail(
                        new ProjectInvalid({ reason: error.message })
                    )
                }
                return Effect.die(error)
            }
        }
    )
}
