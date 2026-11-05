import { roleGrants } from './definition'
import { platformRoleRank } from './hierarchy'

/**
 * How long an impersonated session lives (`AUTH-067`).
 *
 * One hour, not the 30 days a normal session gets: impersonation is an inspection tool, and a forgotten tab must stop
 * being an admin's identity on its own.
 */
export const IMPERSONATION_TTL_SECONDS = 3600

/**
 * Why an impersonation was refused.
 *
 * A closed union, so the endpoint answers a reason the UI can explain instead of a generic 403.
 */
export type ImpersonationRefusal =
    /** The caller does not hold `user:impersonate`. */
    | 'no-capability'
    /** Never act as an equal or a stronger principal — that is privilege escalation by another name. */
    | 'equal-or-higher'

/**
 * Whether `actorRole` may act as a user holding `targetRole`.
 *
 * Two independent conditions, both from the same declaration the rest of authz reads: the capability
 * (`user:impersonate`, held by `superAdmin`, or by a custom role that was granted it) and a STRICTLY higher rank. The
 * second is what stops an `admin` from impersonating another `admin`.
 */
export function canImpersonate(
    actorRole: string,
    targetRole: string
): ImpersonationRefusal | null {
    if (!roleGrants(actorRole, 'user:impersonate')) return 'no-capability'
    if (platformRoleRank(actorRole) <= platformRoleRank(targetRole))
        return 'equal-or-higher'
    return null
}
