import z from 'zod/v4'

import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

export const meshTokenInput = z.object({
    /** How long the token can be redeemed. Short: the token is the swarm's credential. */
    ttlMs: z
        .number()
        .int()
        .positive()
        .max(24 * 60 * 60 * 1000)
        .default(60 * 60 * 1000),
})

export const meshTokenOutput = z.object({
    /** Hand this to the node that should join. Shown once: it carries the swarm's credential. */
    token: z.string(),
    expiresAt: z.number(),
})

const meshTokenOps = standard.zod(meshTokenOutput, 'meshToken')

/**
 * How a new node is added to a swarm: an agent that is already in it (or a standalone one, which becomes the first
 * node of a new swarm) issues a token, and the new node redeems it with `roster.join`. No node is ever pre-wired with a
 * secret through its environment.
 */
export const meshTokenContract = meshTokenOps
    .create()
    .path('/token')
    .input((b) => b.body(meshTokenInput))
    .output(meshTokenOutput)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build()
