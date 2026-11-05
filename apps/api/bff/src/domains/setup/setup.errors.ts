import { domainError } from '@deployer/effect-core'

/**
 * Whether a dashboard is expected could not be read, so the verification cannot say what to probe. Guessing would either
 * hide a missing dashboard or fail an "API only" install forever, so the question is refused instead.
 */
export class ManagedWebFlagUnreadable extends domainError(
    'ManagedWebFlagUnreadable',
    'dependency_missing'
)<{ readonly reason: string }>() {
    override publicMessage() {
        return 'Could not tell whether a dashboard is part of this installation.'
    }
}
