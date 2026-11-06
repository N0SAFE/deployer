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
    /**
     * Which generation of a rotating secret this node holds (SEC-101); null for a secret that does not rotate yet. Defaulted so
     * an answer from an older agent still parses.
     */
    generation: z.number().int().positive().nullable().default(null),
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

export const meshSecretAdoptionStatusSchema = z.enum(['current', 'stale', 'missing'])

/** One secret across the fleet: the value most nodes hold (as a fingerprint) and where each node stands against it. */
export const meshSecretAdoptionSchema = z.object({
    id: meshNodeSecretIdSchema,
    current: z.string().min(1).nullable(),
    /** The generation `current` is, when the secret rotates. */
    currentGeneration: z.number().int().positive().nullable().default(null),
    nodes: z.array(
        z.object({
            nodeId: z.string().min(1),
            fingerprint: z.string().min(1).nullable(),
            generation: z.number().int().positive().nullable().default(null),
            adoptedAt: z.string().nullable(),
            status: meshSecretAdoptionStatusSchema,
        })
    ),
})

export const meshFleetSecretsSchema = z.object({
    /** Every node this agent knows of, itself first. A node that did not answer is listed with `reachable: false`. */
    nodes: z.array(
        z.object({
            nodeId: z.string().min(1),
            reachable: z.boolean(),
            secrets: z.array(meshNodeSecretSchema),
        })
    ),
    adoption: z.array(meshSecretAdoptionSchema),
})

export type MeshSecretAdoption = z.infer<typeof meshSecretAdoptionSchema>
export type MeshFleetSecrets = z.infer<typeof meshFleetSecretsSchema>

const meshFleetSecretsOps = standard.zod(meshFleetSecretsSchema, 'meshFleetSecrets')

/**
 * The secrets of every node this agent can reach, and who is behind. The agent asks its peers; nobody else can, because
 * only an agent holds the credential to call another agent. Read-only, and it carries no value.
 */
export const meshNodeFleetSecretsContract = meshFleetSecretsOps
    .list()
    .path('/fleet-secrets')
    .input(z.object({}))
    .output(meshFleetSecretsSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build()
