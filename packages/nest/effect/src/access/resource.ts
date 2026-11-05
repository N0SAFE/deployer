import { Effect, Option } from 'effect'

import { isPermission, type Permission, type ScopeKind } from '@deployer/auth/authz'
import { CurrentActor } from '@deployer/effect-core'

import { Authorized, mint } from './authorized'
import { evaluate } from './decision'
import { DecisionLedger } from './ledger'
import {
    EnvironmentScope,
    NodeScope,
    ProjectScope,
    ServiceScope,
    type ScopeNotFound,
    type ScopeResolverShape,
    type ScopeServiceOf,
} from './scope'

import type { AccessDenied } from './errors'

/** `service:deploy` -> `service`. The first colon splits, so `cluster:join-token:reveal` is `cluster`. */
export type ResourceOf<P extends string> = P extends `${infer R}:${string}`
    ? R
    : never

/** The resource names the catalog declares. */
export type ResourceName = ResourceOf<Permission>

/** `service` -> `read | create | update | deploy | …`, straight from the catalog. */
export type ActionOf<R extends string> = Permission extends infer P
    ? P extends `${R}:${infer A}`
        ? A
        : never
    : never

/** `params.id` -> `{ params: { id: string } }`: what a dotted path demands of the input. */
export type NestedInput<Path extends string> =
    Path extends `${infer Head}.${infer Tail}`
        ? { readonly [K in Head]: NestedInput<Tail> }
        : { readonly [K in Path]: string }

/** What a resource declares about itself. */
export type ResourceDefinition<
    K extends ScopeKind,
    Key extends string | undefined,
> = {
    /** The scope kind its permissions are checked in. `platform` resources have no lineage. */
    readonly scope: K
    /**
     * The input field the resource is normally found under (`serviceId`, or a dotted path such as `params.id`). When it
     * is set, `.on(...)` is optional; when it is not, the controller must say which field. For a `platform` resource
     * the id names the *subject* (the user being acted on), not a scope, and is what `.orSelf()` compares with the caller.
     */
    readonly idKey?: Key
}

/** A requirement as data: everything the middleware needs, nothing it must guess. */
export type RequirementSpec = {
    readonly resource: string
    readonly scope: ScopeKind
    readonly permission: Permission
    /** The input field (or dotted path) holding the id, or `null` for a platform-wide check. */
    readonly key: string | null
    /** The resource's own id key: what `.orSelf()` falls back to on a platform resource. */
    readonly defaultKey: string | null
    readonly name: string
    readonly orSelf: boolean
}

declare const requirementTypes: unique symbol

type UnionToIntersection<U> = (
    U extends unknown ? (x: U) => void : never
) extends (x: infer I) => void
    ? I
    : never

const invalidPath = (key: string): boolean =>
    key === '' || key.startsWith('.') || key.endsWith('.') || key.includes('..')

/**
 * The fluent builder `Resource.can(action)` returns. Immutable: every step returns a new one.
 *
 * `P` is the permission, `Input` what the procedure's input must carry for it to be locatable, `N` the name in
 * `context.access`, `K` the scope kind (so the middleware can say which scope plugin it needs), and `DK` the resource's
 * default id key while it is still the one in use (`undefined` once `.on(...)` named another).
 */
export class RequirementBuilder<
    P extends Permission,
    Input extends object,
    N extends string,
    K extends ScopeKind,
    DK extends string | undefined = undefined,
> {
    declare readonly [requirementTypes]?: {
        permission: P
        input: Input
        name: N
        kind: K
    }
    readonly spec: RequirementSpec

    constructor(spec: RequirementSpec) {
        this.spec = spec
    }

    /**
     * The input field (or dotted path) that holds the id, when it is not the resource's own `idKey`. On a platform
     * resource the id is the *subject*, not a scope: it is only used by `.orSelf()` and rules that compare with the caller.
     */
    on<const Key extends string>(
        key: Key
    ): RequirementBuilder<P, NestedInput<Key>, N, K> {
        if (invalidPath(key)) {
            throw new Error(`${this.spec.permission}: "${key}" is not a field path`)
        }
        return new RequirementBuilder({ ...this.spec, key })
    }

    /** The name the proof takes in `context.access`; required when two requirements share a resource. */
    as<const Name extends string>(
        name: Name
    ): RequirementBuilder<P, Input, Name, K, DK> {
        return new RequirementBuilder({ ...this.spec, name })
    }

    /** Pass when the id in the input is the caller's own, with no permission needed. */
    orSelf(): RequirementBuilder<
        P,
        Input & (DK extends string ? NestedInput<DK> : object),
        N,
        K,
        DK
    > {
        const key = this.spec.key ?? this.spec.defaultKey
        if (key === null) {
            throw new Error(
                `${this.spec.permission}: .orSelf() needs an id to compare with the caller; use .on("field")`
            )
        }
        return new RequirementBuilder({ ...this.spec, key, orSelf: true })
    }
}

/** Any builder, whatever it demands. */
export type AnyRequirement = RequirementBuilder<
    Permission,
    object,
    string,
    ScopeKind,
    string | undefined
>

/** The input a list of requirements needs: every requirement's input, together. */
export type InputOf<Rs extends readonly AnyRequirement[]> =
    UnionToIntersection<
        Rs[number] extends infer R
            ? R extends RequirementBuilder<
                  Permission,
                  infer I,
                  string,
                  ScopeKind,
                  string | undefined
              >
                ? I
                : never
            : never
    >

export type NameOf<R> =
    R extends RequirementBuilder<
        Permission,
        object,
        infer N,
        ScopeKind,
        string | undefined
    >
        ? N
        : never
export type PermissionOfRequirement<R> =
    R extends RequirementBuilder<
        infer P,
        object,
        string,
        ScopeKind,
        string | undefined
    >
        ? P
        : never
export type KindOf<R> =
    R extends RequirementBuilder<
        Permission,
        object,
        string,
        infer K,
        string | undefined
    >
        ? K
        : never

/** The scope plugins a requirement list needs from the Effect context: the `R` the middleware adds to a procedure. */
export type ScopeServicesOf<Rs extends readonly AnyRequirement[]> =
    ScopeServiceOf<KindOf<Rs[number]>>

/** The input a requirement on `K` found under `Key` demands. A platform resource has no id until `.on(...)`. */
type DefaultInput<
    K extends ScopeKind,
    Key extends string | undefined,
> = K extends 'platform'
    ? object
    : Key extends string
      ? NestedInput<Key>
      : object

/** The plugin a scope kind resolves through, as an Effect: the plugin is an ordinary service in the request's context. */
function resolverService(
    kind: Exclude<ScopeKind, 'platform'>
): Effect.Effect<
    ScopeResolverShape,
    never,
    ProjectScope | EnvironmentScope | ServiceScope | NodeScope
> {
    switch (kind) {
        case 'project':
            return Effect.gen(function* () {
                return yield* ProjectScope
            })
        case 'environment':
            return Effect.gen(function* () {
                return yield* EnvironmentScope
            })
        case 'service':
            return Effect.gen(function* () {
                return yield* ServiceScope
            })
        case 'node':
            return Effect.gen(function* () {
                return yield* NodeScope
            })
    }
}

/** A scoped resource is decided on an id; a platform one on none, or on the subject's. */
type RequireIds<K extends ScopeKind> = K extends 'platform'
    ? [subject?: string]
    : [id: string]

/** A resource: the vocabulary a service exports for the things it owns. */
export type Resource<
    R extends string,
    K extends ScopeKind,
    Key extends string | undefined,
> = {
    readonly name: R
    readonly scope: K
    readonly idKey: Key | undefined
    /** `Service.can("deploy")`: the requirement for `service:deploy`, typed by the catalog. */
    can<const A extends ActionOf<R>>(
        action: A
    ): RequirementBuilder<
        Extract<`${R}:${A}`, Permission>,
        DefaultInput<K, Key>,
        R,
        K,
        Key
    >
    /**
     * The same requirement, decided inside a handler: `yield* Service.require('update', svc.id)`. It fails with
     * `AccessDenied` (or `ScopeNotFound`, a 404) and succeeds with an `Authorized` proof that a mutating service method
     * can demand. A platform resource takes no id, or the subject's.
     */
    require<const A extends ActionOf<R>>(
        action: A,
        ...id: RequireIds<K>
    ): Effect.Effect<
        Authorized<Extract<`${R}:${A}`, Permission>, K>,
        AccessDenied | ScopeNotFound,
        CurrentActor | ScopeServiceOf<K>
    >
}

/** Describe a resource once, where the entity lives. */
export function defineResource<
    const R extends ResourceName,
    const K extends ScopeKind,
    const Key extends string | undefined = undefined,
>(name: R, definition: ResourceDefinition<K, Key>): Resource<R, K, Key> {
    const idKey = definition.idKey
    const scopeKind = definition.scope

    const requireNow = (action: string, ...ids: readonly (string | undefined)[]) => {
        const permission = `${name}:${action}`
        if (!isPermission(permission)) {
            throw new Error(`${permission} is not in the permission catalog`)
        }
        const spec: RequirementSpec = {
            resource: name,
            scope: scopeKind,
            permission,
            key: null,
            defaultKey: idKey ?? null,
            name,
            orSelf: false,
        }
        return Effect.gen(function* () {
            const actor = yield* CurrentActor
            const entry = yield* evaluate(
                spec,
                ids[0],
                { id: actor.id, role: actor.kind === 'user' ? actor.role : 'system' },
                (scopeId) =>
                    scopeKind === 'platform'
                        ? Effect.succeed([])
                        : Effect.flatMap(resolverService(scopeKind), (resolver) =>
                              resolver.lineage(scopeId)
                          )
            )
            const ledger = yield* Effect.serviceOption(DecisionLedger)
            if (Option.isSome(ledger)) yield* ledger.value.decided()
            return new Authorized(entry, mint)
        })
    }

    return {
        name,
        scope: definition.scope,
        idKey,
        // The implementation yields every plugin kind; the declared type narrows it to this resource's own, which
        // `K` fixes but TypeScript cannot relate to a runtime `switch`. This is the one assertion the handler path needs
        // (a narrowing of `R` and of the proof's permission, never a widening).
        require: <const A extends ActionOf<R>>(
            action: A,
            ...id: RequireIds<K>
        ) =>
            requireNow(action, ...id) as Effect.Effect<
                Authorized<Extract<`${R}:${A}`, Permission>, K>,
                AccessDenied | ScopeNotFound,
                CurrentActor | ScopeServiceOf<K>
            >,
        can: <const A extends ActionOf<R>>(action: A) => {
            const permission = `${name}:${action}`
            if (!isPermission(permission)) {
                throw new Error(`${permission} is not in the permission catalog`)
            }
            return new RequirementBuilder<
                Extract<`${R}:${A}`, Permission>,
                DefaultInput<K, Key>,
                R,
                K,
                Key
            >({
                resource: name,
                scope: definition.scope,
                permission,
                // A scoped resource is located by its id; a platform one has none unless `.on(...)` names a subject.
                key: definition.scope === 'platform' ? null : (idKey ?? null),
                defaultKey: idKey ?? null,
                name,
                orSelf: false,
            })
        },
    }
}
