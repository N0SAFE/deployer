import {
    BadRequestError,
    ForbiddenError,
    ValidationError,
} from '@deployer/errors'
import { Effect } from 'effect'

import { UserForbidden, UserInvalid } from '../domain/user.errors'

/**
 * Lift a synchronous rule into the Effect error channel.
 *
 * The rules throw `@deployer/errors` classes; the known ones become the user domain's tagged
 * failures, anything else is a defect (a bug in a rule, not a refusal).
 */
export function rule<T>(
    operation: () => T
): Effect.Effect<T, UserForbidden | UserInvalid> {
    return Effect.suspend((): Effect.Effect<T, UserForbidden | UserInvalid> => {
        try {
            return Effect.succeed(operation())
        } catch (error) {
            if (error instanceof ForbiddenError)
                return Effect.fail(new UserForbidden({ reason: error.message }))
            if (
                error instanceof ValidationError ||
                error instanceof BadRequestError
            ) {
                return Effect.fail(new UserInvalid({ reason: error.message }))
            }
            return Effect.die(error)
        }
    })
}
