import { Context } from 'effect'

import type { Effect } from 'effect'

import type { ScopeKind } from '@deployer/auth/authz'

/** A node of a lineage: a scope kind and, except for the platform, the id of the thing. */
export type ScopeRef = { readonly kind: ScopeKind; readonly id?: string }

/** Facts a condition may read about a scope, loaded by its owner. */
export type ScopeFacts = {
    readonly ownerId?: string | null
    readonly environmentKind?:
        'production' | 'staging' | 'preview' | 'dev' | null
}

/** The scope does not exist (or is not visible to this service). Concealed as a 404 by the middleware. */
export class ScopeNotFound extends Error {
    readonly _tag = 'ScopeNotFound'
    constructor(
        readonly kind: ScopeKind,
        readonly id: string
    ) {
        super(`${kind} ${id} not found`)
        this.name = 'ScopeNotFound'
    }
}

/**
 * What a scope plugin provides: where a thing sits (its lineage up to, but excluding, the platform) and the facts about
 * it. The service that owns the entity provides the `live` Layer over its own tables; every other service provides a
 * `remote` Layer over the owner's client. Same tag, same shape: not a second kind of service.
 */
export type ScopeResolverShape = {
    readonly kind: Exclude<ScopeKind, 'platform'>
    /** The scope itself first, then each ancestor: `service -> project`. The platform is appended by the middleware. */
    readonly lineage: (
        id: string
    ) => Effect.Effect<readonly ScopeRef[], ScopeNotFound>
    readonly facts: (id: string) => Effect.Effect<ScopeFacts, ScopeNotFound>
}

export class ProjectScope extends Context.Service<
    ProjectScope,
    ScopeResolverShape
>()('access/ProjectScope') {}
export class EnvironmentScope extends Context.Service<
    EnvironmentScope,
    ScopeResolverShape
>()('access/EnvironmentScope') {}
export class ServiceScope extends Context.Service<
    ServiceScope,
    ScopeResolverShape
>()('access/ServiceScope') {}
export class NodeScope extends Context.Service<NodeScope, ScopeResolverShape>()(
    'access/NodeScope'
) {}

/** The tag a scope kind resolves through. The platform has none: it is always the root. */
export const scopeTags = {
    project: ProjectScope,
    environment: EnvironmentScope,
    service: ServiceScope,
    node: NodeScope,
} as const

export type ScopeTagOf<K extends ScopeKind> = K extends 'platform'
    ? never
    : (typeof scopeTags)[Extract<K, keyof typeof scopeTags>]

/** The Effect identifier a kind's plugin registers: the `R` the middleware adds to a procedure. */
export type ScopeServiceOf<K extends ScopeKind> =
    ScopeTagOf<K> extends Context.Service<infer Identifier, any>
        ? Identifier
        : never
