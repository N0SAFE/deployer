import { domainError } from '@deployer/effect-core'

/** Something the caller named does not exist. `reason` is a sentence written for the client. */
export class RuntimeNotFound extends domainError(
    'RuntimeNotFound',
    'not_found'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The input, or the state it meets, breaks a rule. `reason` is a sentence written for the client. */
export class RuntimeInvalid extends domainError(
    'RuntimeInvalid',
    'validation'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The request collides with existing state. `reason` is a sentence written for the client. */
export class RuntimeConflict extends domainError(
    'RuntimeConflict',
    'conflict'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The actor may not do this. `reason` is a sentence written for the client. */
export class RuntimeForbidden extends domainError(
    'RuntimeForbidden',
    'forbidden'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}
