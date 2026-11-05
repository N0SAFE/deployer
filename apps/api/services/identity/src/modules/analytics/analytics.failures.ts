import { Data } from 'effect'

/**
 * An analytics database call failed; wraps the driver error. Deliberately not a `DomainError`: the
 * boundary answers it with a generic internal error carrying a correlation id.
 */
export class AnalyticsRepositoryFailure extends Data.TaggedError(
    'AnalyticsRepositoryFailure'
)<{
    readonly cause: unknown
}> {}
