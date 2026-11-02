import { Data } from 'effect'

import { domainError } from '@deployer/effect-core'

/** The engine denied the action. `reason` is the engine's sentence, written for the client. */
export class PermissionDenied extends domainError(
    'PermissionDenied',
    'forbidden'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/**
 * A permission database call failed; wraps the driver error. Deliberately not a `DomainError`: the
 * boundary answers it with a generic internal error carrying a correlation id.
 */
export class PermissionRepositoryFailure extends Data.TaggedError(
    'PermissionRepositoryFailure'
)<{
    readonly cause: unknown
}> {}

/** What a permission use case can fail with. */
export type PermissionFailure = PermissionDenied | PermissionRepositoryFailure
