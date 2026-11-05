import type { Permission } from '@deployer/auth/authz'
import { domainError } from '@deployer/effect-core'

import type { ScopeRef } from './scope'

/**
 * A refusal, as a typed failure. The request boundary maps its kind to one status (`forbidden`), so a handler that
 * calls `Resource.require(...)` neither throws nor catches: it fails, and the transport answers.
 */
export class AccessDenied extends domainError('AccessDenied', 'forbidden')<{
    readonly permission: Permission
    readonly scope: ScopeRef
    readonly reason: string
}>() {
    override publicMessage(): string {
        return 'You do not have permission for this action'
    }
    override publicData(): Record<string, unknown> {
        return {
            permission: this.permission,
            scope: this.scope,
            reason: this.reason,
        }
    }
}

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
