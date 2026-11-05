import { ORPCError } from '@orpc/server'
import { Context, Effect, Layer, Ref } from 'effect'
import {
    AuthzDenied,
    SYSTEM_ROLES_TABLE,
    decide,
    permissionsInRoles,
    type AccessDeclaration,
    type Actor,
    type CapabilitySet,
    type Decision,
    type Facts,
    type Permission,
    type RoleTable,
    type Scope,
} from '@deployer/auth/authz'

/** An access middleware (`accessRequired`, …) already ran: it left its proof under `context.access`. */
function hasAccessProof(context: unknown): boolean {
    return (
        context !== null &&
        typeof context === 'object' &&
        Reflect.get(context, 'access') !== undefined
    )
}

/**
 * Authorization, as an Effect service plus one oRPC middleware.
 *
 * The split is deliberate:
 *
 * - `Authz` is the service a handler yields, so a check runs inside the same fiber and trace as the work it guards and a
 *   spec swaps the store with a `Layer`;
 * - `authzGate` is the transport edge: it reads the declaration attached to the *contract* (`access()` from
 *   `@deployer/auth/authz`), resolves the caller, asks the store, and refuses with `FORBIDDEN`.
 *
 * Nothing here knows about Nest: the host (an oRPC router inside a Nest app) calls `configureAuthz` once, and the
 * `procedure()` builder appends the gate to every Effect handler. That is what makes the rule uniform — a new procedure
 * cannot forget it — and why a procedure with no declaration is a loud event instead of a silent allow.
 */

/**
 * The declaration and its reader live in `@deployer/auth/authz/meta`: a contract WRITES it and this gate READS it, so two
 * definitions would be two chances to agree by accident. Re-exported here because a controller imports the gate from this
 * package and should not have to know where the metadata lives.
 */
import { accessOf } from '@deployer/auth/authz/meta'

export { access, accessOf } from '@deployer/auth/authz/meta'

export type AuthzMode = 'off' | 'shadow' | 'enforce'

/** Where capabilities come from. The database-backed implementation replaces this once grants land. */
export type PermissionStore = {
    readonly capabilities: (
        actor: Actor,
        scope: Scope
    ) => Promise<CapabilitySet>
}

export type AuthzOptions = {
    readonly store: PermissionStore
    readonly mode: AuthzMode
    /** Every decision, for the log and the shadow-mode report. */
    readonly onDecision?: (event: DecisionEvent) => void
}

export type DecisionEvent = {
    readonly decision: Decision
    readonly actor: Actor | null
    readonly mode: AuthzMode
    readonly enforced: boolean
    /** Set when the procedure declared nothing: the gate allowed it only because the mode is not `enforce`. */
    readonly undeclared: boolean
}

export type AuthzQuery = {
    readonly actor: Actor
    readonly permission: Permission
    readonly scope: Scope
    readonly facts?: Partial<Omit<Facts, 'actorId' | 'now'>>
}

export type AuthzShape = {
    /** The decision, never failing: "not allowed" is an answer, not an error. */
    readonly check: (query: AuthzQuery) => Effect.Effect<Decision>
    /** A refusal as a typed failure, for a handler that must stop. */
    readonly require: (query: AuthzQuery) => Effect.Effect<void, AuthzDenied>
    /** The full picture: capabilities, their sources and the decision. */
    readonly explain: (
        query: AuthzQuery
    ) => Effect.Effect<Decision & { readonly capabilities: CapabilitySet }>
}

export class Authz extends Context.Service<Authz, AuthzShape>()(
    'authz/Authz'
) {}

export const makeAuthz = (store: PermissionStore): Effect.Effect<AuthzShape> =>
    Effect.gen(function* () {
        // One memo per layer instance. A request-scoped layer gives one per request; a process-wide one would need the
        // `authz_epoch` key, which is a later optimisation rather than a correctness dependency.
        const memo = yield* Ref.make(new Map<string, CapabilitySet>())

        const capabilitiesFor = (
            actor: Actor,
            scope: Scope
        ): Effect.Effect<CapabilitySet> =>
            Effect.gen(function* () {
                // The role is part of the key: a user's capabilities change when their grants change, and the legacy store
                // derives them from the role.
                const key = `${actor.id}\u0000${actor.role}\u0000${scope.kind}\u0000${scope.id ?? ''}`
                const hit = (yield* Ref.get(memo)).get(key)
                if (hit !== undefined) return hit
                const resolved = yield* Effect.promise(() =>
                    store.capabilities(actor, scope)
                )
                yield* Ref.update(memo, (current) =>
                    new Map(current).set(key, resolved)
                )
                return resolved
            })

        const decisionOf = (
            query: AuthzQuery,
            capabilities: CapabilitySet
        ): Decision =>
            decide({
                permission: query.permission,
                scope: query.scope,
                capabilities,
                facts: {
                    actorId: query.actor.id,
                    ownerId: query.facts?.ownerId ?? null,
                    environmentKind: query.facts?.environmentKind ?? null,
                    now: Date.now(),
                },
            })

        return {
            check: (query) =>
                Effect.map(
                    capabilitiesFor(query.actor, query.scope),
                    (capabilities) => decisionOf(query, capabilities)
                ),
            require: (query) =>
                Effect.flatMap(
                    capabilitiesFor(query.actor, query.scope),
                    (capabilities) => {
                        const decision = decisionOf(query, capabilities)
                        return decision.allowed
                            ? Effect.void
                            : Effect.fail(
                                  new AuthzDenied(
                                      query.permission,
                                      query.scope,
                                      decision.reason
                                  )
                              )
                    }
                ),
            explain: (query) =>
                Effect.map(
                    capabilitiesFor(query.actor, query.scope),
                    (capabilities) => ({
                        ...decisionOf(query, capabilities),
                        capabilities,
                    })
                ),
        }
    })

/** `authzLive(store)` for a host that keeps one process-wide layer; the store is the only thing a deployment swaps. */
export const authzLive = (store: PermissionStore) =>
    Layer.effect(Authz, makeAuthz(store))

/**
 * The capabilities a role holds, read from a role TABLE rather than a constant.
 *
 * A role is data: a name, a scope, a rank and the permissions it grants. The shipped table is
 * `SYSTEM_ROLES_TABLE`; the `roles` row set replaces the argument and nothing else changes, which is why every call site
 * asks for permissions and never for a role name.
 *
 * A project-scoped check still resolves to an empty set: membership belongs to the project service, not to this store.
 */
export function platformRoleStore(
    table: RoleTable = SYSTEM_ROLES_TABLE
): PermissionStore {
    return {
        capabilities: (actor: Actor, scope: Scope): Promise<CapabilitySet> =>
            Promise.resolve({
                // The table is seeded from the authz model, so these ARE catalog permissions; the projection widens them to
                // strings because a `roles` row can only carry strings.
                permissions: permissionsInRoles(
                    table,
                    actor.role,
                    scope.kind
                ) as readonly Permission[],
                sources:
                    scope.kind === 'platform' ? [`role ${actor.role}`] : [],
            }),
    }
}

/** The caller, from the oRPC context the auth middleware already populated. */
export function actorOf(context: unknown): Actor | null {
    const user = (
        context as {
            auth?: { user?: { id?: unknown; role?: unknown } | null }
        } | null
    )?.auth?.user
    if (user === null || user === undefined || typeof user.id !== 'string')
        return null
    return {
        id: user.id,
        role: typeof user.role === 'string' ? user.role : 'member',
    }
}

/** Resolve the declaration's scope, including `{ by: "input", path: "serviceId" }`. */
export function resolveScope(
    declaration: AccessDeclaration,
    input: unknown,
    context: unknown
): Scope {
    // Neither a caller acting on their own record nor an open route has a scope to resolve.
    if ('self' in declaration) return { kind: 'platform' }
    if (declaration.public === true) return { kind: 'platform' }
    const scope = declaration.scope
    if (scope === undefined) return { kind: 'platform' }
    if (!('by' in scope)) return scope

    const source = scope.by === 'input' ? input : context
    const value = scope.path
        .split('.')
        .reduce<unknown>(
            (current, key) =>
                (current as Record<string, unknown> | null | undefined)?.[key],
            source
        )

    const kind = (value as { kind?: unknown } | null | undefined)?.kind
    const id = (value as { id?: unknown } | null | undefined)?.id
    if (typeof kind === 'string' && typeof id === 'string')
        return { kind: kind as Scope['kind'], id }

    // A path that names a bare id (`serviceId`) is the common case: the kind comes from the declaration, not the value.
    const kindFromPath = scope.kind ?? scope.path.replace(/Id$/, '')
    const known: ReadonlySet<string> = new Set([
        'project',
        'environment',
        'service',
        'node',
    ])
    if (typeof value === 'string' && known.has(kindFromPath))
        return { kind: kindFromPath as Scope['kind'], id: value }
    return { kind: 'platform' }
}

/** Set once by the host (`createOrpcModule`); `procedure()` appends the gate to every Effect handler from then on. */
let active: AuthzOptions | null = null

export function configureAuthz(options: AuthzOptions | null): void {
    active = options
}

export function authzConfigured(): AuthzOptions | null {
    return active
}

/**
 * The oRPC middleware `procedure()` appends last.
 *
 * Order matters: it must run after the middlewares that populate `context.auth` (auth, actor) and before the handler, so
 * `procedure()` applies it around the user's chain rather than at the front.
 */
export function authzGate(options: AuthzOptions) {
    type MiddlewareOptions = {
        readonly procedure: unknown
        readonly context: unknown
        readonly path: readonly string[]
        /**
         * Continue the chain. NOT `done`: oRPC's third middleware argument terminates the chain early with an output, so
         * "allowed" must call `next()` or the handler never runs and the caller gets `undefined`.
         */
        readonly next: () => unknown
    }

    return async (
        opts: MiddlewareOptions,
        _input: unknown
    ): Promise<unknown> => {
        // The controller declared its access with an access middleware (`accessRequired`, …): that middleware decided.
        if (hasAccessProof(opts.context)) return opts.next()
        const declaration = accessOf(opts.procedure)
        const actor = actorOf(opts.context)

        const refuse = (
            permission: Permission,
            scope: Scope,
            reason: string,
            undeclared: boolean
        ): never => {
            options.onDecision?.({
                decision: { allowed: false, reason, permission, scope },
                actor,
                mode: options.mode,
                enforced: options.mode === 'enforce',
                undeclared,
            })
            throw new ORPCError('FORBIDDEN', {
                message: 'You do not have permission for this action',
                data: { permission, scope, reason },
            })
        }

        // No declaration: a bug in the procedure, not in the caller. Loud in enforce mode, a log line in shadow.
        if (declaration === undefined) {
            if (
                options.mode === 'enforce' &&
                options.onDecision !== undefined
            ) {
                options.onDecision({
                    decision: {
                        allowed: true,
                        reason: 'undeclared',
                        permission: 'project:read',
                        scope: { kind: 'platform' },
                    },
                    actor,
                    mode: options.mode,
                    enforced: false,
                    undeclared: true,
                })
            }
            return opts.next()
        }

        // A caller acting on their own record (`DEC-AUTH-27`): authentication is the whole check. There is no permission
        // to evaluate — the handler is what scopes the work to `actor.id`, and a route that takes someone else's id
        // declares a permission instead.
        if ('self' in declaration) {
            if (actor === null) {
                throw new ORPCError('UNAUTHORIZED', {
                    message: 'Authentication required',
                })
            }
            options.onDecision?.({
                decision: {
                    allowed: true,
                    reason: `self: ${declaration.reason}`,
                    permission: 'user:get',
                    scope: { kind: 'platform' },
                },
                actor,
                mode: options.mode,
                enforced: options.mode === 'enforce',
                undeclared: false,
            })
            return opts.next()
        }

        if (declaration.public === true) return opts.next()

        if (actor === null) {
            throw new ORPCError('UNAUTHORIZED', {
                message: 'Authentication required',
            })
        }

        const scope = resolveScope(declaration, _input, opts.context)

        const capabilities = await options.store.capabilities(actor, scope)
        const decision = decide({
            permission: declaration.permission,
            scope,
            capabilities,
            facts: { actorId: actor.id, now: Date.now() },
        })

        options.onDecision?.({
            decision,
            actor,
            mode: options.mode,
            enforced: options.mode === 'enforce',
            undeclared: false,
        })

        if (!decision.allowed && options.mode === 'enforce') {
            return refuse(declaration.permission, scope, decision.reason, false)
        }

        return opts.next()
    }
}
