import { domainError } from '@deployer/effect-core'

/** Nobody validated is calling: no session, a malformed credential, an expired claim. Mapped to 401 by kind. */
export class Unauthenticated extends domainError('Unauthenticated', 'unauthorized')<{
    readonly reason?: string
}>() {
    override publicMessage(): string {
        return this.reason ?? 'Authentication required'
    }
}

/** The caller is known (or the credential is absent) and may not: the wire message says which requirement was missed. */
export class Forbidden extends domainError('Forbidden', 'forbidden')<{
    readonly reason: string
}>() {
    override publicMessage(): string {
        return this.reason
    }
}
