import { ORPCError, os } from '@orpc/server'
import { Cause, Context as EffectContext, Effect, Exit } from 'effect'

import type { Decision, Permission, ScopeKind } from '@deployer/auth/authz'

import { actorOf } from '../authz'
import { evaluate, type Caller, type LineageOf } from './decision'
import { describe } from './descriptor'
import { AccessDenied } from './errors'
import {
    EnvironmentScope,
    NodeScope,
    ProjectScope,
    ScopeNotFound,
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
    NestedInput,
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

function wiring(permission: string, message: string): ORPCError<string, unknown> {
    return new ORPCError('INTERNAL_SERVER_ERROR', {
        message: `access ${permission}: ${message}`,
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

/** Where a scope sits, through the plugin this service provides; a service that forgot it fails loudly, not as a 403. */
function lineageThrough(spec: RequirementSpec, context: unknown): LineageOf<never> {
    return (id) => {
        const effectContext: unknown =
            context !== null && typeof context === 'object'
                ? Reflect.get(context, 'effect/context')
                : undefined
        const resolver =
            spec.scope !== 'platform' && EffectContext.isContext(effectContext)
                ? resolverFor(spec.scope, effectContext)
                : undefined
        return resolver === undefined
            ? Effect.die(
                  wiring(
                      spec.permission,
                      `no ${spec.scope} scope plugin is provided to this service (provide the owner's \`live\` or a \`remote\` Layer)`
                  )
              )
            : resolver.lineage(id)
    }
}

async function check(
    spec: RequirementSpec,
    input: unknown,
    context: unknown,
    caller: Caller
): Promise<AccessEntry<Permission, ScopeKind>> {
    const raw = spec.key === null ? undefined : valueAt(input, spec.key)
    const id = typeof raw === 'string' ? raw : undefined
    if (spec.key !== null && id === undefined) {
        // The contract's schema validated the input before any middleware ran; a missing key is a wiring mistake.
        throw wiring(spec.permission, `the input has no string field "${spec.key}"`)
    }
    const exit = await Effect.runPromiseExit(
        evaluate(spec, id, caller, lineageThrough(spec, context))
    )
    if (Exit.isSuccess(exit)) return exit.value
    const failure: unknown = Cause.squash(exit.cause)
    if (failure instanceof AccessDenied) {
        throw new ORPCError('FORBIDDEN', {
            message: 'You do not have permission for this action',
            data: {
                permission: failure.permission,
                scope: failure.scope,
                reason: failure.reason,
            },
        })
    }
    if (failure instanceof ScopeNotFound) {
        // Concealment: a scope the caller cannot be told exists reads as absent (DEC-AUTH-14).
        throw new ORPCError('NOT_FOUND', { message: failure.publicMessage() })
    }
    throw failure
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

/**
 * The caller acts on their own record. Unlike a permission, this is CHECKED, not assumed:
 *
 * - `accessSelf(reason)`: the procedure takes no id at all (`deleteSelf`, `exportSelf`). There is nothing to tamper with, and
 *   the proof carries `context.access.self.id`, the one id the handler may act on: the session's own.
 * - `accessSelf(reason, { on: 'params.id' })`: the input names a record; the middleware refuses with 403 unless that id is the
 *   caller's. It does not depend on `AUTHZ_MODE`: whose record it is is an identity fact, not a rollout.
 */
export function accessSelf<const Key extends string | undefined = undefined>(
    reason: string,
    options?: { readonly on: Key }
) {
    const key = options?.on
    if (key !== undefined && (key === '' || key.startsWith('.') || key.endsWith('.') || key.includes('..'))) {
        throw new Error(`accessSelf: "${key}" is not a field path`)
    }
    const middleware = os
        .$context<AuthenticatedContext>()
        .middleware<
            {
                readonly access: {
                    readonly self: { readonly reason: string; readonly id: string }
                }
            },
            Key extends string ? NestedInput<Key> : unknown
        >(({ context, next }, input) => {
            const actor = requireActor(context)
            if (key !== undefined && valueAt(input, key) !== actor.id) {
                throw new ORPCError('FORBIDDEN', {
                    message: 'You can only act on your own record',
                })
            }
            return next({
                context: { access: { self: { reason, id: actor.id } } },
            })
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
