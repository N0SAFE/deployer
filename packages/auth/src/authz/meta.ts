import { defineMeta } from '@orpc/contract'

import type { AccessDeclaration } from './types'

/**
 * The authorization declaration a procedure carries, as oRPC metadata (`DEC-AUTH-26`).
 *
 * Here rather than in the Nest host because BOTH ends need it: a contract writes it (`.meta(access({...}))`, through the
 * `standard.zod` builder) and the gate reads it back off the implemented procedure. Two copies of the key would be two
 * chances to disagree, and the failure mode is silent — a declaration nothing reads, on a route nothing gates.
 *
 * `defineMeta` stores the value under one key and merges nothing, so a second `.meta(...)` (OpenAPI, docs) cannot clobber
 * it. Imported as `@deployer/auth/authz/meta`: this pulls `@orpc/contract`, which the client-side permission table must
 * not.
 */
const [accessMeta] = defineMeta('authz', (value: AccessDeclaration) => value)

/** Attach a declaration to a procedure contract. */
export const access = (declaration: AccessDeclaration) =>
    accessMeta(declaration)

/** The declaration on a procedure (or a lazy one), or `undefined` when it declares nothing. */
export function accessOf(procedure: unknown): AccessDeclaration | undefined {
    if (procedure === null || typeof procedure !== 'object') return undefined
    const meta = (
        procedure as {
            readonly '~orpc'?: { readonly meta?: Record<PropertyKey, unknown> }
        }
    )['~orpc']?.meta
    const declaration = meta?.authz
    return declaration === null || typeof declaration !== 'object'
        ? undefined
        : (declaration as AccessDeclaration)
}
