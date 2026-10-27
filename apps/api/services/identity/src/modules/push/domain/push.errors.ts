import { domainError } from '@deployer/effect-core'

/**
 * Raised for an unknown endpoint AND for one owned by somebody else: the two are
 * deliberately indistinguishable, because telling them apart would confirm that
 * an endpoint belongs to another account.
 */
export class PushSubscriptionNotFound extends domainError(
    'PushSubscriptionNotFound',
    'not_found'
)<{ readonly endpoint: string }>() {
    override publicMessage() {
        return 'push subscription was not found'
    }
}

/** The input breaks a rule about what a push subscription is. `reason` is written for the client. */
export class PushInvalid extends domainError('PushInvalid', 'validation')<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}
