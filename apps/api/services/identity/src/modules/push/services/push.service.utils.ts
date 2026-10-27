import { BadRequestError, ValidationError } from '@deployer/errors'
import { Effect } from 'effect'

import { PushInvalid } from '../domain/push.errors'

/**
 * Lift a synchronous rule into the Effect error channel: a rule's validation refusal becomes
 * `PushInvalid`, anything else is a defect.
 */
export function rule<T>(operation: () => T): Effect.Effect<T, PushInvalid> {
    return Effect.suspend((): Effect.Effect<T, PushInvalid> => {
        try {
            return Effect.succeed(operation())
        } catch (error) {
            if (
                error instanceof ValidationError ||
                error instanceof BadRequestError
            ) {
                return Effect.fail(new PushInvalid({ reason: error.message }))
            }
            return Effect.die(error)
        }
    })
}
