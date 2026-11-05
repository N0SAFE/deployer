import { fromNodeHeaders } from 'better-auth/node'
import { Effect } from 'effect'
import z from 'zod/v4'

import { verifyMeshToken, verifyPeerServiceToken } from '@deployer/auth/mesh'
import { secretsMatch } from '@deployer/auth/server'
import { Actor, CurrentActor } from '@deployer/effect-core'
import { actorFromContext } from '@deployer/effect-orpc'
import { effectMiddleware } from '@deployer/nest-effect'

import { SYSTEM_ACTOR_HEADER, verifySystemActorClaim } from '../system-actor'

import { AuthUtils, AuthUtilsEmpty } from './auth-utils'
import { Forbidden, Unauthenticated } from './auth.errors'
import { MeshSecret, PlatformSecret } from './secrets'
import { SessionResolver } from './session-resolver'
import {
    assertAuthenticated,
    type ORPCAuthContext,
    type MeshContext,
    type MeshParcourEntry,
} from './types'

/**
 * The auth middlewares, written as Effects (`effectMiddleware`, over `@orpc/effect`'s `middlewareGen`).
 *
 * Each one declares what it needs as a service (`SessionResolver`, `MeshSecret`, `PlatformSecret`), and that need is carried
 * into the procedure's requirements: a service whose module does not provide it fails to compile instead of failing at the
 * first request. A refusal is a typed domain error (`Unauthenticated`, `Forbidden`) mapped to its status by kind.
 *
 * `requireAuth()` and `requireSystemActor()` are also what GRANT the actor: they provide `CurrentActor` to everything after
 * them, so code that needs one cannot be reached without having been validated here.
 */

const headerRecord = z.record(
    z.string(),
    z.union([z.string(), z.array(z.string()), z.undefined()])
)

/** The request's headers as web standard `Headers`, whichever shape the transport handed over. */
function headersOf(context: unknown): Headers | null {
    const request: unknown =
        context !== null && typeof context === 'object'
            ? Reflect.get(context, 'request')
            : undefined
    if (request === null || typeof request !== 'object') return null
    const headers: unknown = Reflect.get(request, 'headers')
    if (headers instanceof Headers) return headers
    const parsed = headerRecord.safeParse(headers)
    return parsed.success ? fromNodeHeaders(parsed.data) : null
}

/** An auth face that is a real session: logged in, with a session and a user. */
function isLoggedIn(value: unknown): value is ORPCAuthContext<true> {
    return (
        value !== null &&
        typeof value === 'object' &&
        Reflect.get(value, 'isLoggedIn') === true &&
        Reflect.get(value, 'session') !== null &&
        Reflect.get(value, 'session') !== undefined &&
        Reflect.get(value, 'user') !== null &&
        Reflect.get(value, 'user') !== undefined
    )
}

/**
 * Who is calling, resolved ONCE per request: a session the request already carries (a test, the BFF's forwarded context)
 * wins; otherwise Better Auth answers through `SessionResolver`. A lookup that fails is "no session", logged, never a 500.
 */
const sessionOf = (context: unknown) =>
    Effect.gen(function* () {
        const existing: unknown =
            context !== null && typeof context === 'object'
                ? Reflect.get(context, 'auth')
                : undefined
        if (isLoggedIn(existing)) return existing
        const headers = headersOf(context)
        if (headers === null) return null
        const sessions = yield* SessionResolver
        const session = yield* sessions.resolve(headers).pipe(
            Effect.catch((failure) =>
                Effect.logWarning(
                    `session lookup failed, treating the caller as anonymous: ${String(failure.cause)}`
                ).pipe(Effect.as(null))
            )
        )
        return session === null ? null : assertAuthenticated(new AuthUtils(session))
    })

/** The `Actor` a verified session stands for, with the same impersonation downgrade the boundary applies. */
const actorOfAuth = (auth: ORPCAuthContext<true>): Actor =>
    actorFromContext({ auth: { user: auth.user, session: auth.session } }) ??
    Actor.user(auth.user.id, auth.user.role ?? 'user', auth.session.id)

/**
 * Require a logged-in caller, and let validation be what grants the actor.
 *
 * Narrows `context.auth` to the authenticated face (non-null `user` and `session`) and provides `CurrentActor`. Without a
 * session it fails with `Unauthenticated` before the handler, or anything after this middleware, runs.
 */
export function requireAuth() {
    return effectMiddleware<SessionResolver, { readonly auth: ORPCAuthContext<true> }>(function* ({
        context,
        next,
    }) {
        const auth = yield* sessionOf(context)
        if (auth === null) return yield* new Unauthenticated({})
        return yield* next({ context: { auth } }).pipe(
            Effect.provideService(CurrentActor, actorOfAuth(auth))
        )
    })
}

/**
 * Mark a procedure as public (no authentication required). `context.auth` is still the caller's session when there is one
 * (`isLoggedIn` may be false), and the actor is provided only when there is one: public code that needs an actor is a
 * requirement nothing satisfies.
 */
export function publicAccess() {
    return effectMiddleware<SessionResolver, { readonly auth: ORPCAuthContext }>(function* ({
        context,
        next,
    }) {
        const auth = yield* sessionOf(context)
        if (auth === null) {
            return yield* next({ context: { auth: new AuthUtilsEmpty() } })
        }
        return yield* next({ context: { auth } }).pipe(
            Effect.provideService(CurrentActor, actorOfAuth(auth))
        )
    })
}

// ─── Incoming header constants ──────────────────────────────────────────────

const HDR_MESH_NODE_ID = 'x-mesh-node-id'
const HDR_MESH_PARCOUR = 'x-mesh-parcour'
const HDR_MESH_INTERNAL_KEY = 'x-mesh-internal-key'

/**
 * Parse the parcour header — a comma-separated list of nodeIds, oldest
 * first. Each entry MAY carry an optional `@timestamp` suffix.
 *
 * Input:  "node-a@2025-01-01T00:00:00Z,node-b"
 * Output: [{ nodeId: "node-a", timestamp: "2025-01-01T00:00:00Z" },
 *          { nodeId: "node-b" }]
 */
function parseParcour(raw: string | null): MeshParcourEntry[] {
    if (!raw) return []
    return raw
        .split(',')
        .map((part) => {
            const trimmed = part.trim()
            if (!trimmed) return null
            const atIdx = trimmed.indexOf('@')
            if (atIdx > 0) {
                return {
                    nodeId: trimmed.slice(0, atIdx),
                    timestamp: trimmed.slice(atIdx + 1) || undefined,
                }
            }
            return { nodeId: trimmed }
        })
        .filter((e): e is MeshParcourEntry => e !== null)
}

/**
 * Build the full MeshContext from the incoming headers and verified
 * peer identity.
 */
function buildMeshContext(
    verifiedNodeId: string,
    tokenType: 'peer-service' | 'mesh-internal',
    webHeaders: Headers
): MeshContext {
    const callerNodeId = verifiedNodeId

    const rawParcour =
        webHeaders.get(HDR_MESH_PARCOUR) ??
        webHeaders.get(HDR_MESH_PARCOUR.toUpperCase())
    const incomingParcour: MeshParcourEntry[] = parseParcour(rawParcour)

    const incomingNodeId: string | null =
        webHeaders.get(HDR_MESH_NODE_ID) ??
        webHeaders.get(HDR_MESH_NODE_ID.toUpperCase())

    // Build the full parcour: incoming trail (oldest first) → caller.
    const fullParcour: MeshParcourEntry[] = [...incomingParcour]
    const lastIncoming: MeshParcourEntry | undefined =
        fullParcour[fullParcour.length - 1]
    if (lastIncoming?.nodeId !== callerNodeId) {
        fullParcour.push({ nodeId: callerNodeId })
    }

    // If the incomingNodeId header differs from the last parcour entry,
    // prepend it as an even earlier hop (the caller's outbound record).
    if (incomingNodeId !== null && incomingNodeId !== callerNodeId) {
        const firstExisting: MeshParcourEntry | undefined = fullParcour[0]
        if (firstExisting?.nodeId !== incomingNodeId) {
            fullParcour.unshift({ nodeId: incomingNodeId })
        }
    }

    const originNodeId: string = fullParcour[0]?.nodeId ?? callerNodeId
    const previousCallerNodeId: string | null =
        fullParcour.length >= 2
            ? (fullParcour[fullParcour.length - 2]?.nodeId ?? null)
            : null

    return {
        verified: true,
        callerNodeId,
        meshParcour: fullParcour,
        originNodeId,
        previousCallerNodeId,
        peerIdentity: { nodeId: callerNodeId, tokenType },
    }
}

// ─── requireMesh — the core peer-identity middleware ─────────────────────────

/**
 * **requireMesh** — validate that the caller is an authenticated mesh peer and populate `context.mesh` with verified routing
 * information. Orthogonal to `requireAuth()`: it never reads or modifies `context.auth`.
 *
 * Accepted credentials, in order of preference:
 *
 * 1. **Peer service token** (`v2.…`) in `X-Mesh-Internal-Key`, signed with a node-specific derivative of the mesh secret.
 * 2. **Generic mesh control token** (`v1.…`, or the bare shared secret) in `X-Mesh-Internal-Key`.
 *
 * Failures: `Forbidden` (no valid credential, or the secret is not configured), `Unauthenticated` (a peer token that is
 * malformed or expired).
 */
export function requireMesh() {
    return effectMiddleware<MeshSecret, { readonly mesh: MeshContext }>(function* ({
        context,
        next,
    }) {
        const webHeaders = headersOf(context)
        const internalKey =
            webHeaders?.get(HDR_MESH_INTERNAL_KEY) ??
            webHeaders?.get(HDR_MESH_INTERNAL_KEY.toUpperCase()) ??
            null
        if (webHeaders === null || internalKey === null || internalKey === '') {
            return yield* new Forbidden({
                reason: 'Mesh endpoint requires internal credentials',
            })
        }

        const secrets = yield* MeshSecret
        const sharedSecret = yield* secrets.get()
        if (sharedSecret === null) {
            return yield* new Forbidden({ reason: 'Mesh shared secret is not configured' })
        }

        if (internalKey.startsWith('v2.')) {
            const verified = verifyPeerServiceToken(internalKey, sharedSecret)
            if (!verified) {
                return yield* new Unauthenticated({
                    reason: 'Invalid or expired peer service token',
                })
            }
            return yield* next({
                context: {
                    mesh: buildMeshContext(verified.nodeId, 'peer-service', webHeaders),
                },
            })
        }

        // The bare shared secret is compared in constant time (AUTH-008): `===` leaks the expected prefix, and an HMAC token
        // already goes through `timingSafeEqual` inside `verifyMeshToken`.
        const ok = internalKey.startsWith('v1.')
            ? verifyMeshToken(internalKey, sharedSecret)
            : secretsMatch(internalKey.trim(), sharedSecret)
        if (!ok) {
            return yield* new Forbidden({
                reason: 'Mesh endpoint requires internal credentials',
            })
        }
        return yield* next({
            context: { mesh: buildMeshContext('mesh-internal', 'mesh-internal', webHeaders) },
        })
    })
}

/**
 * Require a SYSTEM ACTOR: a call that no person made (a webhook, a schedule), vouched for by a peer service with a signed
 * claim in `X-Deployer-System-Actor`. Use it instead of `requireAuth()` on a procedure only a peer service should call.
 * It narrows `context.systemActor` to the verified claim and provides the system `CurrentActor`.
 *
 * @param audience - the service name the claim must be addressed to (e.g. `"runtime"`)
 *
 * Failures: `Unauthenticated` (no claim, a bad signature, a wrong audience, an expired claim), `Forbidden` (the platform
 * secret is not configured, so no claim can be verified).
 */
export function requireSystemActor(audience: string) {
    return effectMiddleware<
        PlatformSecret,
        { readonly systemActor: NonNullable<ReturnType<typeof verifySystemActorClaim>> }
    >(function* ({ context, next }) {
        const token = headersOf(context)?.get(SYSTEM_ACTOR_HEADER) ?? null
        if (token === null || token === '') {
            return yield* new Unauthenticated({ reason: 'System actor claim required' })
        }
        const secrets = yield* PlatformSecret
        const secret = yield* secrets.get()
        if (secret === null) {
            return yield* new Forbidden({ reason: 'Platform secret is not configured' })
        }
        const claim = verifySystemActorClaim(token, secret, audience)
        if (claim === null) {
            return yield* new Unauthenticated({
                reason: 'Invalid or expired system actor claim',
            })
        }
        return yield* next({ context: { systemActor: claim } }).pipe(
            Effect.provideService(CurrentActor, Actor.system(claim.source))
        )
    })
}

/**
 * Require specific platform role(s). Use it after `requireAuth()`: the role is read off the authenticated session. A caller
 * with none of the allowed roles fails with `Forbidden`.
 *
 * Interim: roles are data and the code should name permissions (`AUTHZ-024`); this stays until the routes that use it declare
 * a requirement instead.
 */
export function requirePlatformRole(allowedRoles: string[]) {
    return effectMiddleware<never>(function* ({ context, next }) {
        const auth: unknown = Reflect.get(context, 'auth')
        if (!isLoggedIn(auth)) return yield* new Unauthenticated({})
        const role = auth.user.role
        if (role === undefined || !allowedRoles.includes(role)) {
            return yield* new Forbidden({
                reason: `Insufficient permissions. Required role: ${allowedRoles.join(', ')}`,
            })
        }
        return yield* next()
    })
}

