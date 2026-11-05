import { ORPCError, os } from '@orpc/server'
import { Context as EffectContext, Effect } from 'effect'

import {
    decide,
    type Decision,
    type Permission,
    type ScopeKind,
} from '@deployer/auth/authz'

import { actorOf, authzConfigured } from '../authz'

import { describe } from './descriptor'
import {
    EnvironmentScope,
    NodeScope,
    ProjectScope,
    ServiceScope,
    type ScopeRef,
    type ScopeResolverShape,
} from './scope'

import type { Marked } from '../requirements'
import type {
    AnyRequirement,
    InputOf,
    KindOf,
    NameOf,
    PermissionOfRequirement,
    RequirementSpec,
    ScopeServicesOf,
} from './resource'

/**
 * What a passed check leaves in `context.access.<name>`: the proof, typed with what was checked.
 *
 * Only the access middlewares in this file create one, so a handler that holds an entry knows a decision was made (or
 * that the mode was `off`, which is recorded rather than hidden).
 */
export type AccessEntry<P extends Permission, K extends ScopeKind> = {
    readonly permission: P
    /** The scope that was checked; the platform when the requirement was platform-wide. */
    readonly scope: ScopeRef & { readonly kind: K }
    /** The id from the input, when the requirement was located by one. */
    readonly id: string | undefined
    /** `permission` when the catalog decided, `self` for an id that is the caller's, `off` when `AUTHZ_MODE=off`. */
    readonly via: 'permission' | 'self' | 'off'
    readonly decision: Decision | null
}

/** The caller is authenticated: what `requireAuth()` guarantees and these middlewares require before them. */
export type AuthenticatedContext = {
    readonly auth: {
        readonly isLoggedIn: true
        readonly user: { readonly id: string }
    }
}

/** `context.access` for a requirement list: one entry per requirement, keyed by its name. */
export type AccessRecord<Rs extends readonly AnyRequirement[]> = {
    readonly [R in Rs[number] as NameOf<R>]: AccessEntry<
        PermissionOfRequirement<R>,
        KindOf<R>
    >
}

type DuplicateName<
    Rs extends readonly unknown[],
    Seen extends string = never,
> = Rs extends readonly [infer H, ...infer T]
    ? NameOf<H> extends Seen
        ? NameOf<H>
        : DuplicateName<T, Seen | NameOf<H>>
    : never

/** A compile error naming the clash, instead of one entry silently replacing the other. */
type UniqueNames<Rs extends readonly AnyRequirement[]> = [
    DuplicateName<Rs>,
] extends [never]
    ? unknown
    : {
          readonly 'two requirements share a name; give one .as("…")': DuplicateName<Rs>
      }

const PLATFORM: ScopeRef = { kind: 'platform' }

/** The scope a requirement names. A platform requirement has none: its id, when present, is a subject, not a scope. */
function scopeOf(spec: RequirementSpec, id: string | undefined): ScopeRef {
    return spec.scope === 'platform' || id === undefined
        ? { kind: spec.scope }
        : { kind: spec.scope, id }
}

/** `params.id` read off the validated input; `undefined` when any step is missing. */
function valueAt(input: unknown, path: string): unknown {
    return path
        .split('.')
        .reduce<unknown>(
            (node, key) =>
                node !== null && typeof node === 'object'
                    ? Reflect.get(node, key)
                    : undefined,
            input
        )
}

function failure(spec: RequirementSpec, message: string): ORPCError<string, unknown> {
    return new ORPCError('INTERNAL_SERVER_ERROR', {
        message: `access ${spec.permission}: ${message}`,
    })
}

/** The plugin that resolves a scope kind, read from the request's Effect context. */
function resolverFor(
    kind: Exclude<ScopeKind, 'platform'>,
    effectContext: EffectContext.Context<never>
): ScopeResolverShape | undefined {
    switch (kind) {
        case 'project':
            return EffectContext.getOrUndefined(effectContext, ProjectScope)
        case 'environment':
            return EffectContext.getOrUndefined(effectContext, EnvironmentScope)
        case 'service':
            return EffectContext.getOrUndefined(effectContext, ServiceScope)
        case 'node':
            return EffectContext.getOrUndefined(effectContext, NodeScope)
    }
}

async function lineageOf(
    spec: RequirementSpec,
    id: string | undefined,
    context: unknown
): Promise<readonly ScopeRef[]> {
    if (spec.scope === 'platform') return [PLATFORM]
    if (id === undefined) {
        throw failure(spec, `needs "${spec.key ?? ''}" in the input to locate its ${spec.scope}`)
    }
    const effectContext: unknown =
        context !== null && typeof context === 'object'
            ? Reflect.get(context, 'effect/context')
            : undefined
    const resolver = EffectContext.isContext(effectContext)
        ? resolverFor(spec.scope, effectContext)
        : undefined
    if (resolver === undefined) {
        throw failure(
            spec,
            `no ${spec.scope} scope plugin is provided to this service (provide the owner's \`live\` or a \`remote\` Layer)`
        )
    }
    const found = await Effect.runPromise(
        resolver.lineage(id).pipe(
            Effect.map((chain) => ({ found: true as const, chain })),
            Effect.catchTag('ScopeNotFound', () =>
                Effect.succeed({ found: false as const })
            )
        )
    )
    if (!found.found) {
        // Concealment: a scope the caller cannot be told exists reads as absent (DEC-AUTH-14).
        throw new ORPCError('NOT_FOUND', { message: `${spec.scope} not found` })
    }
    return [...found.chain, PLATFORM]
}

async function check(
    spec: RequirementSpec,
    input: unknown,
    context: unknown,
    actor: { readonly id: string; readonly role: string }
): Promise<AccessEntry<Permission, ScopeKind>> {
    const raw = spec.key === null ? undefined : valueAt(input, spec.key)
    const id = typeof raw === 'string' ? raw : undefined
    if (spec.key !== null && id === undefined) {
        // The contract's schema validated the input before any middleware ran; a missing key is a wiring mistake.
        throw failure(spec, `the input has no string field "${spec.key}"`)
    }

    const options = authzConfigured()
    const mode = options?.mode ?? 'off'
    const base = { permission: spec.permission, id }

    if (spec.orSelf && id !== undefined && id === actor.id) {
        return { ...base, scope: scopeOf(spec, id), via: 'self', decision: null }
    }
    if (options === null || mode === 'off') {
        return { ...base, scope: scopeOf(spec, id), via: 'off', decision: null }
    }

    const lineage = await lineageOf(spec, id, context)
    const scope = lineage[0] ?? PLATFORM
    const capabilities = await Promise.all(
        lineage.map((ref) => options.store.capabilities(actor, ref))
    )
    const decision = decide({
        permission: spec.permission,
        scope,
        capabilities: {
            permissions: [...new Set(capabilities.flatMap((c) => c.permissions))],
            sources: capabilities.flatMap((c) => c.sources),
        },
        facts: { actorId: actor.id, now: Date.now() },
    })
    options.onDecision?.({
        decision,
        actor,
        mode,
        enforced: mode === 'enforce',
        undeclared: false,
    })
    if (!decision.allowed && mode === 'enforce') {
        throw new ORPCError('FORBIDDEN', {
            message: 'You do not have permission for this action',
            data: { permission: spec.permission, scope, reason: decision.reason },
        })
    }
    return { ...base, scope, via: 'permission', decision }
}

function requireActor(context: unknown) {
    const actor = actorOf(context)
    if (actor === null) {
        throw new ORPCError('UNAUTHORIZED', { message: 'Authentication required' })
    }
    return actor
}

/**
 * The requirement of a procedure, in the controller: what permission, on what, found where.
 *
 * ```ts
 * procedure(contract.deploy)
 *   .use(requireAuth())                                   // required first: this is typed after it
 *   .use(accessRequired(Service.can('deploy')))           // `.on` inferred from the resource's id key
 * ```
 *
 * Several requirements are ONE call (`accessRequired(a, b)`): they all must pass, and the proofs are keyed by name.
 * The middleware demands what the requirements locate by (`InputOf`), so a procedure whose input lacks the field does
 * not accept it, and it adds the scope plugins it reads to the procedure's `R`.
 */
export function accessRequired<const Rs extends readonly AnyRequirement[]>(
    ...requirements: Rs & UniqueNames<Rs>
) {
    const specs = requirements.map((requirement) => requirement.spec)
    const middleware = os
        .$context<AuthenticatedContext>()
        .middleware<
            { readonly access: AccessRecord<Rs> } & Marked<ScopeServicesOf<Rs>>,
            InputOf<Rs>
        >(async ({ context, next }, input) => {
            const actor = requireActor(context)
            const entries: [string, AccessEntry<Permission, ScopeKind>][] = []
            for (const spec of specs) {
                entries.push([spec.name, await check(spec, input, context, actor)])
            }
            // The proofs are keyed by names only the types know; `Marked` is a phantom no runtime value carries. This is
            // the one place the dynamic record meets its mapped type.
            const access = Object.fromEntries(entries) as AccessRecord<Rs>
            return next({
                context: { access } as { readonly access: AccessRecord<Rs> } & Marked<ScopeServicesOf<Rs>>,
            })
        })
    return describe(middleware, { kind: 'required', requirements: specs })
}

/** The caller acts on their own record: only authentication is checked; the handler must scope the work to `actor.id`. */
export function accessSelf(reason: string) {
    const middleware = os
        .$context<AuthenticatedContext>()
        .middleware<
            { readonly access: { readonly self: { readonly reason: string } } },
            unknown
        >(({ context, next }) => {
            requireActor(context)
            return next({ context: { access: { self: { reason } } } })
        })
    return describe(middleware, { kind: 'self', reason })
}

/** The only anonymous form. The reason is mandatory and appears in the generated public surface. */
export function accessPublic(reason: string) {
    if (reason.trim() === '') {
        throw new Error('accessPublic needs a reason: why is this route open?')
    }
    const middleware = os
        .$context<object>()
        .middleware<
            { readonly access: { readonly public: { readonly reason: string } } },
            unknown
        >(({ next }) => next({ context: { access: { public: { reason } } } }))
    return describe(middleware, { kind: 'public', reason })
}

/** The decision is made in the handler (`Resource.require(...)`); this states that on purpose and satisfies the type. */
export function accessDeferred(reason: string) {
    if (reason.trim() === '') {
        throw new Error('accessDeferred needs a reason: why is it not known here?')
    }
    const middleware = os
        .$context<AuthenticatedContext>()
        .middleware<
            { readonly access: { readonly deferred: { readonly reason: string } } },
            unknown
        >(({ context, next }) => {
            requireActor(context)
            return next({ context: { access: { deferred: { reason } } } })
        })
    return describe(middleware, { kind: 'deferred', reason })
}
