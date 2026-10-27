import {
    BadRequestError,
    ForbiddenError,
    ValidationError,
} from '@deployer/errors'
import { HttpException } from '@nestjs/common'
import { Effect } from 'effect'
import { ZodError } from 'zod/v4'

import {
    ProjectConflict,
    ProjectForbidden,
    ProjectInvalid,
    ResourceMissing,
} from './domain/project.errors'
import { ProjectInfraFailure } from './project.failures'

/** What a promise-shaped collaborator can refuse with, in domain terms. */
export type AttemptFailure = ProjectInfraFailure | ResourceMissing | ProjectForbidden | ProjectInvalid | ProjectConflict;

/**
 * Lift a Promise-returning call.
 *
 * Shared platform services are still promise-shaped and refuse with Nest exceptions (`ProjectAccessService`
 * throws `NotFoundException` for a missing project): the four statuses a client can act on become the matching
 * domain failure. Any other rejection is an infrastructure failure.
 */
export function attempt<A>(run: () => Promise<A>): Effect.Effect<A, AttemptFailure> {
	return Effect.tryPromise({ try: run, catch: (cause): AttemptFailure => toFailure(cause) });
}

function toFailure(cause: unknown): AttemptFailure {
	if (cause instanceof HttpException) {
		const reason = cause.message;
		switch (cause.getStatus()) {
			case 400:
				return new ProjectInvalid({ reason });
			case 403:
				return new ProjectForbidden({ reason });
			case 404:
				return new ResourceMissing({ reason });
			case 409:
				return new ProjectConflict({ reason });
		}
	}
	return new ProjectInfraFailure({ cause });
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
