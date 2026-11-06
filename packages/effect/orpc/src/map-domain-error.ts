import { Effect } from 'effect'

import {
    isDomainError,
    type DomainError,
    type ErrorKind,
} from '@deployer/effect-core'
import { standardErrorActions } from '@deployer/orpc-utils'

import type { ORPCError } from '@orpc/client'

type ErrorAction = (message: string) => ORPCError<string, unknown>

const ACTION_BY_KIND: Record<ErrorKind, ErrorAction> = {
    not_found: standardErrorActions.NOT_FOUND,
    validation: standardErrorActions.BAD_REQUEST,
    conflict: standardErrorActions.CONFLICT,
    unauthorized: standardErrorActions.UNAUTHORIZED,
    forbidden: standardErrorActions.FORBIDDEN,
    dependency_missing: standardErrorActions.FAILED_DEPENDENCY,
    bad_gateway: standardErrorActions.BAD_GATEWAY,
}

/**
 * One domain error to one oRPC error, by kind. The table is a `Record<ErrorKind, ...>`, so a
 * seventh kind is a compile error until it gets a row. The wire message is `publicMessage()` (the tag unless
 * the error overrides it); `cause` and `publicData` stay server-side until a contract declares a
 * shape for them.
 */
export function mapDomainError(error: DomainError) {
    return ACTION_BY_KIND[error.kind](error.publicMessage())
}

/**
 * Turn every `DomainError` in the failure channel into its oRPC error; other failures pass through
 * unchanged. Apply at the handler boundary, once.
 */
export const catchDomainErrors = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    /** Runs once per domain error, before it is mapped: where a server-side `cause` gets reported. */
    onError?: (error: DomainError) => void
): Effect.Effect<
    A,
    Exclude<E, DomainError> | ReturnType<typeof mapDomainError>,
    R
> =>
    Effect.catch(
        effect,
        (
            error: E
        ): Effect.Effect<
            never,
            Exclude<E, DomainError> | ReturnType<typeof mapDomainError>
        > => {
            if (!isDomainError(error)) {
                return Effect.fail(error as Exclude<E, DomainError>)
            }

            onError?.(error)
            return Effect.fail(mapDomainError(error))
        }
    )
