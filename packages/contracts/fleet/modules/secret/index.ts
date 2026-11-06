import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import z from 'zod/v4'

import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

/**
 * The platform's secrets as the operator sees them: which node holds which, by fingerprint, and who is behind.
 * Never a value: revealing one is a separate, step-up-gated action.
 */

export const secretIdSchema = z.enum(['mesh', 'platform'])

export const nodeSecretSchema = z.object({
    id: secretIdSchema,
    purpose: z.string().min(1),
    fingerprint: z.string().min(1).nullable(),
    /** Which generation of a rotating secret the node holds; null for one that does not rotate yet. */
    generation: z.number().int().positive().nullable(),
    adoptedAt: z.string().nullable(),
    consumers: z.array(z.string().min(1)),
})

export const secretAdoptionSchema = z.object({
    id: secretIdSchema,
    /** The fingerprint most nodes hold, or null when no node holds one. */
    current: z.string().min(1).nullable(),
    /** The generation `current` is, when the secret rotates. */
    currentGeneration: z.number().int().positive().nullable(),
    nodes: z.array(
        z.object({
            nodeId: z.string().min(1),
            fingerprint: z.string().min(1).nullable(),
            generation: z.number().int().positive().nullable(),
            adoptedAt: z.string().nullable(),
            status: z.enum(['current', 'stale', 'missing']),
        })
    ),
})

export const secretInventorySchema = z.object({
    /** Every node the fleet's agent knows of. A node that did not answer is listed with `reachable: false`. */
    nodes: z.array(
        z.object({
            nodeId: z.string().min(1),
            reachable: z.boolean(),
            secrets: z.array(nodeSecretSchema),
        })
    ),
    adoption: z.array(secretAdoptionSchema),
})

export type SecretInventory = z.infer<typeof secretInventorySchema>

const secretOps = standard.zod(secretInventorySchema, 'secretInventory')

export const secretInventoryContract = secretOps
    .list()
    .path('/inventory')
    .input(z.object({}))
    .output(secretInventorySchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build()

export const secretContract = oc
    .meta(openapi({ tags: ['Secrets'], prefix: '/secrets' }))
    .router({ inventory: secretInventoryContract })

export type SecretContract = typeof secretContract
