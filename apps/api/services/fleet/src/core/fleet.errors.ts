import { domainError } from '@deployer/effect-core'

/** Something the caller named does not exist. `reason` is a sentence written for the client. */
export class FleetNotFound extends domainError('FleetNotFound', 'not_found')<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The input breaks a rule. `reason` is a sentence written for the client. */
export class FleetInvalid extends domainError('FleetInvalid', 'validation')<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The request collides with existing state. `reason` is a sentence written for the client. */
export class FleetConflict extends domainError('FleetConflict', 'conflict')<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The caller could not prove who it is (a webhook with no or a wrong signature). `reason` is a sentence written for the client. */
export class FleetUnauthorized extends domainError(
    'FleetUnauthorized',
    'unauthorized'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}
