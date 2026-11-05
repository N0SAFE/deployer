import type { Permission, ScopeKind } from '@deployer/auth/authz'

import type { ScopeServiceOf } from './scope'

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

/** What a resource declares about itself. */
export type ResourceDefinition<
    K extends ScopeKind,
    Key extends string | undefined,
> = {
    /** The scope kind its permissions are checked in. `platform` resources have no lineage. */
    readonly scope: K
    /**
     * The input field the resource is normally found under (`serviceId`). When it is set, `.on(...)` is optional; when
     * it is not, the controller must say which field. For a `platform` resource the id names the *subject* (the user
     * being acted on), not a scope, and is what `.orSelf()` compares with the caller.
     */
    readonly idKey?: Key
}

/** A requirement as data: everything the middleware needs, nothing it must guess. */
export type RequirementSpec = {
    readonly resource: string
    readonly scope: ScopeKind
    readonly permission: Permission
    /** The input field holding the id, or `null` for a platform-wide check. */
    readonly key: string | null
    readonly name: string
    readonly orSelf: boolean
}

declare const requirementTypes: unique symbol

type UnionToIntersection<U> = (
    U extends unknown ? (x: U) => void : never
) extends (x: infer I) => void
    ? I
    : never

/** The fluent builder `Resource.can(action)` returns. Immutable: every step returns a new one. */
export class RequirementBuilder<
    P extends Permission,
    Input extends object,
    N extends string,
    K extends ScopeKind,
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

    /** The input field that holds the id, when it is not the resource's own `idKey`. */
    on<const Key extends string>(
        key: Key
    ): RequirementBuilder<P, { readonly [X in Key]: string }, N, K> {
        if (this.spec.scope === 'platform' && this.spec.key === null) {
            // A platform-wide permission has no subject: `.on` would have nothing to name.
            throw new Error(
                `${this.spec.permission} is checked on the platform and takes no id; remove .on("${key}")`
            )
        }
        return new RequirementBuilder({ ...this.spec, key })
    }

    /** The name the proof takes in `context.access`; required when two requirements share a resource. */
    as<const Name extends string>(
        name: Name
    ): RequirementBuilder<P, Input, Name, K> {
        return new RequirementBuilder({ ...this.spec, name })
    }

    /** Pass when the id in the input is the caller's own, with no permission needed. */
    orSelf(): RequirementBuilder<P, Input, N, K> {
        if (this.spec.key === null) {
            throw new Error(
                `${this.spec.permission}: .orSelf() needs an id to compare with the caller`
            )
        }
        return new RequirementBuilder({ ...this.spec, orSelf: true })
    }
}

/** Any builder, whatever it demands. */
export type AnyRequirement = RequirementBuilder<
    Permission,
    any,
    string,
    ScopeKind
>

/** The input a list of requirements needs: every requirement's input, together. */
export type InputOf<Rs extends readonly AnyRequirement[]> =
    UnionToIntersection<
        Rs[number] extends infer R
            ? R extends RequirementBuilder<any, infer I, any, any>
                ? I
                : never
            : never
    >

export type NameOf<R> =
    R extends RequirementBuilder<any, any, infer N, any> ? N : never
export type PermissionOfRequirement<R> =
    R extends RequirementBuilder<infer P, any, any, any> ? P : never
export type KindOf<R> =
    R extends RequirementBuilder<any, any, any, infer K> ? K : never

/** The scope plugins a requirement list needs from the Effect context: the `R` the middleware adds to a procedure. */
export type ScopeServicesOf<Rs extends readonly AnyRequirement[]> =
    ScopeServiceOf<KindOf<Rs[number]>>

/** A resource: the vocabulary a service exports for the things it owns. */
export type Resource<
    R extends string,
    K extends ScopeKind,
    Key extends string | undefined,
> = {
    readonly name: R
    readonly scope: K
    readonly idKey: Key
    /** `Service.can("deploy")`: the requirement for `service:deploy`, typed by the catalog. */
    can<const A extends ActionOf<R>>(
        action: A
    ): RequirementBuilder<
        Extract<`${R}:${A}`, Permission>,
        Key extends string ? { readonly [X in Key]: string } : object,
        R,
        K
    >
}

/** Describe a resource once, where the entity lives. */
export function defineResource<
    const R extends ResourceName,
    const K extends ScopeKind,
    const Key extends string | undefined = undefined,
>(name: R, definition: ResourceDefinition<K, Key>): Resource<R, K, Key> {
    const idKey = (definition.idKey ?? undefined) as Key
    return {
        name,
        scope: definition.scope,
        idKey,
        can: (action) =>
            new RequirementBuilder({
                resource: name,
                scope: definition.scope,
                permission: `${name}:${action}` as Permission,
                key: idKey ?? null,
                name,
                orSelf: false,
            }) as never,
    }
}
