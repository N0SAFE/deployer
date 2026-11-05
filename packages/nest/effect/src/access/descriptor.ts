import z from 'zod/v4'

import { isPermission } from '@deployer/auth/authz'

import type { RequirementSpec } from './resource'

/**
 * The marker every access middleware carries, so a boot audit can tell a procedure that declared its access from one
 * that did not, without calling it.
 */
export const accessDescriptor = Symbol.for('deployer/access-descriptor')

const requirementSchema = z.object({
    resource: z.string(),
    scope: z.enum(['platform', 'project', 'environment', 'service', 'node']),
    permission: z.string(),
    key: z.string().nullable(),
    defaultKey: z.string().nullable(),
    name: z.string(),
    orSelf: z.boolean(),
})

const descriptorSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('required'), requirements: z.array(requirementSchema) }),
    z.object({ kind: z.literal('self'), reason: z.string() }),
    z.object({ kind: z.literal('public'), reason: z.string() }),
    z.object({ kind: z.literal('deferred'), reason: z.string() }),
])

export type AccessDescriptor =
    | {
          readonly kind: 'required'
          readonly requirements: readonly RequirementSpec[]
      }
    | { readonly kind: 'self'; readonly reason: string }
    | { readonly kind: 'public'; readonly reason: string }
    | { readonly kind: 'deferred'; readonly reason: string }

/** Attach the descriptor to a middleware (non-enumerable, so it never shows up in a spread or a snapshot). */
export function describe<M extends object>(
    middleware: M,
    descriptor: AccessDescriptor
): M {
    Object.defineProperty(middleware, accessDescriptor, {
        value: descriptor,
        enumerable: false,
    })
    return middleware
}

/** The descriptor of a middleware, or `undefined` when it is not an access middleware. */
export function accessDescriptorOf(
    middleware: unknown
): AccessDescriptor | undefined {
    if (typeof middleware !== 'function' && typeof middleware !== 'object')
        return undefined
    if (middleware === null) return undefined
    const raw: unknown = Reflect.get(middleware, accessDescriptor)
    const parsed = descriptorSchema.safeParse(raw)
    if (!parsed.success) return undefined
    const value = parsed.data
    if (value.kind !== 'required') return value
    const requirements: RequirementSpec[] = []
    for (const requirement of value.requirements) {
        // A permission that is not in the catalog cannot have come from `describe`: treat the marker as foreign.
        if (!isPermission(requirement.permission)) return undefined
        requirements.push({ ...requirement, permission: requirement.permission })
    }
    return { kind: 'required', requirements }
}
