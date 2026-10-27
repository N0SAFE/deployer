import { domainError } from '@deployer/effect-core'

/** A typed 404 rather than a null return, so a client gets a code. */
export class UserNotFound extends domainError('UserNotFound', 'not_found')<{
    readonly id: string
}>() {
    override publicData() {
        return { id: this.id }
    }
    override publicMessage() {
        return `user "${this.id}" was not found`
    }
}

/** A create/update would collide with an existing account. */
export class EmailTaken extends domainError('EmailTaken', 'conflict')<{
    readonly email: string
}>() {
    override publicMessage() {
        return `an account for "${this.email}" already exists`
    }
}

/** The actor may not do this. `reason` is a sentence written for the client. */
export class UserForbidden extends domainError('UserForbidden', 'forbidden')<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The input breaks a rule about what a user is. `reason` is a sentence written for the client. */
export class UserInvalid extends domainError('UserInvalid', 'validation')<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** Every failure a user use case can raise on purpose. */
export type UserDomainFailure =
    UserNotFound | EmailTaken | UserForbidden | UserInvalid
