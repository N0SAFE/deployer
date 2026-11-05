import z from 'zod/v4'

import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

/** The secrets a node holds. A new secret is a new id here, and a consumer list the node declares itself. */
export const meshNodeSecretIdSchema = z.enum(['mesh', 'platform'])

/**
 * What one node says about one secret it holds: never the value.
 *
 * `fingerprint` is a short keyed digest of the value, so two nodes can be compared ("do they hold the same secret?")
 * without either of them revealing it. Null means the node holds none yet.
 */
export const meshNodeSecretSchema = z.object({
    id: meshNodeSecretIdSchema,
    purpose: z.string().min(1),
    fingerprint: z.string().min(1).nullable(),
    /** ISO-8601, when this node generated or received the value it holds. */
    adoptedAt: z.string().nullable(),
    /** What on this node reads it, so a rotation says what it touches. */
    consumers: z.array(z.string().min(1)),
})

export const meshNodeSecretsSchema = z.object({
    agentId: z.string().min(1),
    secrets: z.array(meshNodeSecretSchema),
})

export type MeshNodeSecret = z.infer<typeof meshNodeSecretSchema>
export type MeshNodeSecrets = z.infer<typeof meshNodeSecretsSchema>

const meshNodeSecretsOps = standard.zod(meshNodeSecretsSchema, 'meshNodeSecrets')

/** This node's secret inventory, as its agent holds it. Read-only, and it carries no value. */
export const meshNodeSecretsContract = meshNodeSecretsOps
    .list()
    .path('/secrets')
    .input(z.object({}))
    .output(meshNodeSecretsSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build()
