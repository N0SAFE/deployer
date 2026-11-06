import z from 'zod/v4'

import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

import { platformSecretRingSchema } from '../../node/platform-secret-ring'

const output = z.object({
    /** This node's platform secret ring, or null when it holds none yet. */
    ring: platformSecretRingSchema.nullable(),
})

const ops = standard.zod(output, 'meshRosterPlatformSecret')

/**
 * The platform secret ring this node holds, for a peer that finds itself on an older generation and adopts it (SEC-101).
 *
 * It carries VALUES, so it is served on the peer door only to an agent that presented the swarm's credential: the same
 * agents already hold the secret. It is how a rotation spreads without anyone being the source of truth.
 */
export const meshRosterPlatformSecretContract = ops
    .list()
    .path('/platform-secret')
    .input(z.object({}))
    .output(output)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build()

const retireOutput = z.object({ generation: z.number().int().positive().nullable() })
const retireOps = standard.zod(retireOutput, 'meshRosterRetirePlatformSecret')

/**
 * Tells this node to stop accepting an earlier generation of the platform secret: how a retirement an operator ordered on
 * one node reaches the others. It never touches the current generation. Peer door, behind the swarm's credential.
 */
export const meshRosterRetirePlatformSecretContract = retireOps
    .create()
    .path('/platform-secret/retire')
    .input((b) => b.body(z.object({ generation: z.number().int().positive() })))
    .output(retireOutput)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build()
