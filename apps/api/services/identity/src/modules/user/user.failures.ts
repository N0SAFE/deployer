import { Data } from 'effect'

/**
 * A database call failed; wraps the driver error. Deliberately not a `DomainError`: the boundary
 * answers it with a generic internal error carrying a correlation id, never the driver's message.
 */
export class UserRepositoryFailure extends Data.TaggedError(
    'UserRepositoryFailure'
)<{
    readonly cause: unknown
}> {}
