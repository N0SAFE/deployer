import z from 'zod/v4'

import type { AuthAuditAction, AuthAuditEvent } from './events'

/**
 * What a Better Auth request hook knows, reduced to the fields an audit line needs.
 *
 * Declared as a plain shape (rather than importing Better Auth's context type) so the mapping is a pure function a spec
 * can call with a literal, and so a Better Auth upgrade that changes its context is a compile error at the ONE adapter
 * site instead of everywhere.
 */
export interface AuditRequestContext {
    /** The endpoint path, e.g. `/sign-in/email` or `/admin/set-role`. */
    readonly path: string
    /** The actor, when the request arrived with a session (an admin acting on someone). */
    readonly sessionUserId: string | undefined
    /** The request body, as parsed by Better Auth. */
    readonly body: unknown
    /** What the endpoint returned, for the actions that mint a subject (`user-created`). */
    readonly returned: unknown
    readonly ip: string | undefined
    readonly userAgent: string | undefined
}

/** The body fields the audited endpoints carry. Everything is optional: one schema, per endpoint. */
const auditBodySchema = z.object({
    /** The subject of an admin action. */
    userId: z.string().min(1).optional(),
    /** The role `set-role` grants. */
    role: z.string().min(1).optional(),
    /** A key id, when the endpoint answers with one. */
    keyId: z.string().min(1).optional(),
})

const auditResultSchema = z.object({
    user: z.object({ id: z.string().min(1) }).optional(),
})

interface AuditMapping {
    readonly action: AuthAuditAction
    /** Does the actor come from the endpoint's RESULT (`sign-in`) rather than the session? */
    readonly actorFromResult?: boolean
}

/**
 * Endpoint → action.
 *
 * Prefix matching is deliberate for `sign-in`: its concrete paths depend on the enabled providers (`email`, `social`,
 * `passkey`), and all of them mean the same thing to an operator.
 */
const ROUTES: readonly (readonly [string, AuditMapping])[] = [
    ['/sign-in/', { action: 'sign-in', actorFromResult: true }],
    ['/sign-out', { action: 'sign-out' }],
    ['/admin/create-user', { action: 'user-created' }],
    ['/admin/remove-user', { action: 'user-deleted' }],
    ['/admin/set-role', { action: 'role-change' }],
    ['/admin/ban-user', { action: 'ban' }],
    ['/admin/unban-user', { action: 'unban' }],
    ['/admin/set-user-password', { action: 'password-changed' }],
    ['/two-factor/enable', { action: 'two-factor-enabled' }],
    ['/passkey/add-passkey', { action: 'passkey-added' }],
    ['/api-key/create', { action: 'api-key-created' }],
    ['/api-key/delete', { action: 'api-key-revoked' }],
    ['/invite/create', { action: 'invite-created' }],
    ['/invite/accept', { action: 'invite-accepted' }],
    ['/device/approve', { action: 'device-approved' }],
]

function mappingFor(path: string): AuditMapping | null {
    for (const [prefix, mapping] of ROUTES) {
        if (path === prefix || path.startsWith(prefix)) return mapping
    }
    return null
}

/**
 * The event a finished request represents, or `null` when it is not an audited action.
 *
 * `null` is the common answer — most auth traffic is a session check — so the hook stays quiet for it rather than
 * writing a row per request.
 */
export function auditEventFromRequest(
    context: AuditRequestContext
): AuthAuditEvent | null {
    const mapping = mappingFor(context.path)
    if (mapping === null) return null

    const body = auditBodySchema.safeParse(context.body)
    const result = auditResultSchema.safeParse(context.returned)
    const subject = body.success ? body.data.userId : undefined
    const actorId = mapping.actorFromResult
        ? result.success
            ? result.data.user?.id
            : undefined
        : context.sessionUserId

    const detail: Record<string, unknown> = {}
    if (body.success) {
        const { userId: _userId, keyId, role } = body.data
        if (role !== undefined) detail.role = role
        if (keyId !== undefined) detail.keyId = keyId
    }

    return {
        action: mapping.action,
        ...(actorId === undefined ? {} : { actorId }),
        ...(subject === undefined ? {} : { targetId: subject }),
        ...(context.ip === undefined ? {} : { ip: context.ip }),
        ...(context.userAgent === undefined
            ? {}
            : { userAgent: context.userAgent }),
        ...(Object.keys(detail).length === 0 ? {} : { detail }),
    }
}
