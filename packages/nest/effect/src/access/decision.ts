import { Effect } from 'effect'

import {
    decide,
    type Decision,
    type Permission,
    type ScopeKind,
} from '@deployer/auth/authz'

import { authzConfigured } from '../authz'

import { AccessDenied } from './errors'

import type { AccessEntry } from './middleware'
import type { RequirementSpec } from './resource'
import type { ScopeNotFound, ScopeRef } from './scope'

export const PLATFORM: ScopeRef = { kind: 'platform' }

/** The scope a requirement names. A platform requirement has none: its id, when present, is a subject, not a scope. */
export function scopeOf(spec: RequirementSpec, id: string | undefined): ScopeRef {
    return spec.scope === 'platform' || id === undefined
        ? { kind: spec.scope }
        : { kind: spec.scope, id }
}

/** Where a scope sits: itself, then each ancestor (the platform is appended by the decision). */
export type LineageOf<R> = (
    id: string
) => Effect.Effect<readonly ScopeRef[], ScopeNotFound, R>

/** What the decision needs to know about the caller: who they are, and the role the legacy capability store reads. */
export type Caller = { readonly id: string; readonly role: string }

/**
 * The one decision, used by the middleware and by `Resource.require(...)`.
 *
 * `off` records and does nothing else; `shadow` decides and logs but never refuses; `enforce` refuses with
 * `AccessDenied`. A scope that does not exist fails with `ScopeNotFound`, which reads as a 404.
 */
export function evaluate<R>(
    spec: RequirementSpec,
    id: string | undefined,
    caller: Caller,
    lineageOf: LineageOf<R>
): Effect.Effect<AccessEntry<Permission, ScopeKind>, AccessDenied | ScopeNotFound, R> {
    return Effect.gen(function* () {
        const options = authzConfigured()
        const mode = options?.mode ?? 'off'
        const base = { permission: spec.permission, id }

        if (spec.orSelf && id !== undefined && id === caller.id) {
            return { ...base, scope: scopeOf(spec, id), via: 'self', decision: null } as const
        }
        if (options === null || mode === 'off') {
            return { ...base, scope: scopeOf(spec, id), via: 'off', decision: null } as const
        }

        const lineage: readonly ScopeRef[] =
            spec.scope === 'platform' || id === undefined
                ? [PLATFORM]
                : [...(yield* lineageOf(id)), PLATFORM]
        const scope = lineage[0] ?? PLATFORM
        const capabilities = yield* Effect.promise(() =>
            Promise.all(lineage.map((ref) => options.store.capabilities(caller, ref)))
        )
        const decision: Decision = decide({
            permission: spec.permission,
            scope,
            capabilities: {
                permissions: [...new Set(capabilities.flatMap((c) => c.permissions))],
                sources: capabilities.flatMap((c) => c.sources),
            },
            facts: { actorId: caller.id, now: Date.now() },
        })
        options.onDecision?.({
            decision,
            actor: caller,
            mode,
            enforced: mode === 'enforce',
            undeclared: false,
        })
        if (!decision.allowed && mode === 'enforce') {
            return yield* new AccessDenied({
                permission: spec.permission,
                scope,
                reason: decision.reason,
            })
        }
        return { ...base, scope, via: 'permission', decision } as const
    })
}
