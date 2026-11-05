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
