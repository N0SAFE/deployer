import { Data } from 'effect'

/**
 * A database, DNS or other infrastructure call failed. Deliberately not a `DomainError`: the
 * boundary answers it with a generic internal error carrying a correlation id, never the cause.
 */
export class ProjectInfraFailure extends Data.TaggedError(
    'ProjectInfraFailure'
)<{
    readonly cause: unknown
}> {}
