import { Effect, Option } from 'effect'

import { CurrentActor } from '@deployer/effect-core'

import type { Decision, Permission, ScopeKind } from '@deployer/auth/authz'

import { effectMiddleware } from '../effect-middleware'

import { type AccessArgs, type AuthenticatedContext } from './context'
import { evaluate } from './decision'
import { describe } from './descriptor'
import { Forbidden, Unauthenticated } from './errors'
import { RequirementBuilder, resolverService } from './resource'

import type { Marked } from '../requirements'
import type { AccessPolicy } from './policy'
import type {
    EnvironmentScope,
    NodeScope,
    ProjectScope,
    ScopeRef,
    ServiceScope,
} from './scope'
import type { ErrorMap } from '@orpc/contract'
import type { Middleware } from '@orpc/server'
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

/** The id a requirement is about: what the controller mapped from the request, else the resource's default input field. */
function idOf(
    requirement: AnyRequirement,
    input: unknown,
    context: AuthenticatedContext
): string | undefined {
    if (requirement.mapping !== null) {
        const mapped = requirement.mapping({ input, context })
        return typeof mapped === 'string' && mapped !== '' ? mapped : undefined
    }
    const { key } = requirement.spec
    if (key === null) return undefined
    const raw = valueAt(input, key)
    return typeof raw === 'string' ? raw : undefined
}

/** The first name two requirements share, or `undefined` when every name is distinct. */
function duplicateName(specs: readonly RequirementSpec[]): string | undefined {
    const seen = new Set<string>()
    for (const spec of specs) {
        if (seen.has(spec.name)) return spec.name
        seen.add(spec.name)
    }
    return undefined
}

/** A function that returns one requirement or several, however the controller wrote it. */
type Mapped = AnyRequirement | readonly AnyRequirement[]
type Normalized<Ret extends Mapped> = Ret extends readonly AnyRequirement[]
    ? Ret
    : readonly [Ret]
const isMapping = (
    arg: unknown
): arg is (args: AccessArgs<unknown>) => Mapped => typeof arg === 'function'
const isMany = (ret: Mapped): ret is readonly AnyRequirement[] =>
    Array.isArray(ret)
const normalize = (ret: Mapped): readonly AnyRequirement[] =>
    isMany(ret) ? ret : [ret]

/** A value that answers every property, call and conversion with itself: what the audit feeds a mapping function. */
function probe(): unknown {
    return new Proxy(() => undefined, {
        get: (_target, key) =>
            key === Symbol.toPrimitive ? () => 'probe' : probe(),
        apply: () => probe(),
    })
}

/**
 * The requirements of a mapping function, for the boot audit. The function is run once on a stand-in input, which is why a
 * mapping should only read the input (`.on(input.params.id)`); one that does anything else may report fewer requirements,
 * and the audit then still sees the middleware, just not its list.
 */
function specsOfMapping(
    map: (args: AccessArgs<unknown>) => Mapped
): readonly RequirementSpec[] {
    try {
        return normalize(
            map({
                input: probe(),
                context: { auth: { isLoggedIn: true, user: { id: 'probe' } } },
            })
        ).map((requirement) => requirement.spec)
    } catch {
        return []
    }
}

/** Everything the access checks may ask of the request's Effect context; only the kinds a requirement uses are REQUIRED of a module. */
type AccessDeps = AccessPolicy | ProjectScope | EnvironmentScope | ServiceScope | NodeScope

/** The caller as the decision knows them. No validated actor is a 401: it means `requireAuth()` did not run before this. */
const callerOf = Effect.gen(function* () {
    const actor = yield* Effect.serviceOption(CurrentActor)
    if (Option.isNone(actor)) return yield* new Unauthenticated({})
    return {
        id: actor.value.id,
        role: actor.value.kind === 'user' ? actor.value.role : 'system',
    }
})

function middlewareOf<const Rs extends readonly AnyRequirement[], In>(
    resolve: (args: AccessArgs<unknown>) => readonly AnyRequirement[]
): Middleware<
    AuthenticatedContext,
    { readonly access: AccessRecord<Rs> } & Marked<AccessPolicy | ScopeServicesOf<Rs>>,
    In,
    unknown,
    ErrorMap
> {
    // The middleware yields every plugin kind at runtime, by the scope each requirement names; the requirement it advertises is
    // the narrower set its `Rs` implies (`ScopeServicesOf`). They agree by construction, and a downcast is what says so.
    return effectMiddleware<AccessDeps, { readonly access: AccessRecord<Rs> }, In, AuthenticatedContext>(
        function* ({ context, next }, input) {
            const caller = yield* callerOf
            const requirements = resolve({ input, context })
            const duplicate = duplicateName(requirements.map((requirement) => requirement.spec))
            if (duplicate !== undefined) {
                return yield* Effect.die(
                    new Error(`two requirements share the name "${duplicate}"; give one .as("…")`)
                )
            }
            const entries: [string, AccessEntry<Permission, ScopeKind>][] = []
            for (const requirement of requirements) {
                const { spec } = requirement
                const id = idOf(requirement, input, context)
                if ((spec.mapped || spec.key !== null) && id === undefined) {
                    // The contract's schema validated the input before any middleware ran; a missing id is a wiring mistake.
                    return yield* Effect.die(
                        new Error(`access ${spec.permission}: the request has no id to locate this by`)
                    )
                }
                const entry = yield* evaluate(spec, id, caller, (scopeId) =>
                    spec.scope === 'platform'
                        ? Effect.succeed([])
                        : Effect.flatMap(resolverService(spec.scope), (resolver) =>
                              resolver.lineage(scopeId)
                          )
                )
                entries.push([spec.name, entry])
            }
            // The proofs are keyed by names only the types know. This is the one place the dynamic record meets its mapped type.
            const access = Object.fromEntries(entries) as AccessRecord<Rs>
            return yield* next({ context: { access } })
        }
    ) as Middleware<
        AuthenticatedContext,
        { readonly access: AccessRecord<Rs> } & Marked<AccessPolicy | ScopeServicesOf<Rs>>,
        In,
        unknown,
        ErrorMap
    >
}

/**
 * The requirement of a procedure, in the controller: what permission, on what, found where.
 *
 * ```ts
 * procedure(contract.setRole)
 *   .use(requireAuth())                                                              // required first
 *   .use(accessRequired(Service.can('deploy')))                                      // the id is the resource's default field
 *   .use(accessRequired(                                                              // or mapped from the request
 *       User.can('get').on<ContractInput<typeof contract.get>>(({ input }) => input.params.id)
 *   ))
 * ```
 *
 * A mapping's `input` is typed by the type argument (`ContractInput<…>`), and the middleware then demands that shape of the
 * procedure it is used on, so a field that does not exist is a compile error and a mismatched procedure is refused. Several requirements are
 * ONE call (`accessRequired(a, b)`): all must pass, and the proofs are keyed by name. The middleware adds the scope plugins
 * it reads to the procedure's `R`.
 */
export function accessRequired<const Rs extends readonly AnyRequirement[]>(
    ...requirements: Rs & UniqueNames<Rs>
): ReturnType<typeof middlewareOf<Rs, InputOf<Rs>>>
export function accessRequired<I extends object, const Ret extends Mapped>(
    map: (args: AccessArgs<I>) => Ret
): ReturnType<
    typeof middlewareOf<Extract<Normalized<Ret>, readonly AnyRequirement[]>, I>
>
export function accessRequired(...args: readonly unknown[]): unknown {
    const [first] = args
    if (isMapping(first)) {
        return describe(
            middlewareOf<readonly AnyRequirement[], unknown>((a) => normalize(first(a))),
            { kind: 'required', requirements: specsOfMapping(first) }
        )
    }
    const requirements = args.filter(
        (arg): arg is AnyRequirement => arg instanceof RequirementBuilder
    )
    return describe(
        middlewareOf<readonly AnyRequirement[], unknown>(() => requirements),
        {
            kind: 'required',
            requirements: requirements.map((requirement) => requirement.spec),
        }
    )
}

/**
 * The caller acts on their own record. Unlike a permission, this is CHECKED, not assumed:
 *
 * `on` is mandatory and never defaults to the id in the input: the caller states WHICH id must be theirs, so a reader sees what
 * is compared. `accessSelf(reason, ({ input }) => input.params.id)` refuses with 403 unless that id is the caller's;
 * a procedure with no id in its input names the session's own (`({ context }) => context.auth.user.id`), which is the explicit
 * way to say "nothing here can name another record". It does not depend on the rollout mode: whose record it is is an identity
 * fact, not a rollout. The proof carries `context.access.self.id`, the one id the handler may act on.
 */
export function accessSelf<I extends object = object>(
    reason: string,
    on: (args: AccessArgs<I>) => string
) {
    const middleware = effectMiddleware<
        never,
        { readonly access: { readonly self: { readonly reason: string; readonly id: string } } },
        I,
        AuthenticatedContext
    >(function* ({ context, next }, input) {
        const caller = yield* callerOf
        if (on({ input, context }) !== caller.id) {
            return yield* new Forbidden({ reason: 'You can only act on your own record' })
        }
        return yield* next({ context: { access: { self: { reason, id: caller.id } } } })
    })
    return describe(middleware, { kind: 'self', reason })
}

/** The only anonymous form. The reason is mandatory and appears in the generated public surface. */
export function accessPublic(reason: string) {
    if (reason.trim() === '') {
        throw new Error('accessPublic needs a reason: why is this route open?')
    }
    const middleware = effectMiddleware<
        never,
        { readonly access: { readonly public: { readonly reason: string } } }
    >(function* ({ next }) {
        return yield* next({ context: { access: { public: { reason } } } })
    })
    return describe(middleware, { kind: 'public', reason })
}

/** The decision is made in the handler (`Resource.require(...)`); this states that on purpose and satisfies the type. */
export function accessDeferred(reason: string) {
    if (reason.trim() === '') {
        throw new Error('accessDeferred needs a reason: why is it not known here?')
    }
    const middleware = effectMiddleware<
        never,
        { readonly access: { readonly deferred: { readonly reason: string } } },
        unknown,
        AuthenticatedContext
    >(function* ({ next }) {
        yield* callerOf
        return yield* next({ context: { access: { deferred: { reason } } } })
    })
    return describe(middleware, { kind: 'deferred', reason })
}
