import { Data } from 'effect'

/**
 * A push database call failed; wraps the driver error. Deliberately not a `DomainError`: the
 * boundary answers it with a generic internal error carrying a correlation id.
 */
export class PushRepositoryFailure extends Data.TaggedError(
    'PushRepositoryFailure'
)<{
    readonly cause: unknown
}> {}
