import { domainError } from '@deployer/effect-core'

/** The caller may not do this. `reason` is a sentence written for the client. */
export class ApprovalForbidden extends domainError(
    'ApprovalForbidden',
    'forbidden'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The input breaks a rule about what a request is. */
export class ApprovalInvalid extends domainError(
    'ApprovalInvalid',
    'validation'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

export class ApprovalNotFound extends domainError(
    'ApprovalNotFound',
    'not_found'
)<{
    readonly id: string
}>() {
    override publicData() {
        return { id: this.id }
    }
    override publicMessage() {
        return `approval request "${this.id}" was not found`
    }
}

export type ApprovalFailure =
    | ApprovalForbidden
    | ApprovalInvalid
    | ApprovalNotFound
    | import('./approval.repository').ApprovalRepositoryFailure
