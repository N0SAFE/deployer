import { domainError } from '@deployer/effect-core'

/** The caller may not manage roles. */
export class RoleForbidden extends domainError('RoleForbidden', 'forbidden')<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The role breaks a rule about what a role is (or may become). */
export class RoleInvalid extends domainError('RoleInvalid', 'validation')<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

export class RoleNotFound extends domainError('RoleNotFound', 'not_found')<{
    readonly id: string
}>() {
    override publicData() {
        return { id: this.id }
    }
    override publicMessage() {
        return `role "${this.id}" was not found`
    }
}

export type RoleFailure = RoleForbidden | RoleInvalid | RoleNotFound
