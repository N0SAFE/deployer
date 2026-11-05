import z from 'zod/v4'

import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

/**
 * A service asks its agent whether a peer that is connecting to it is part of the mesh. The service never holds the swarm's
 * credential: the agent does, and answers. What the peer presented is either the swarm's credential (another agent
 * relaying a call) or a direct grant's token (a caller the agent sent here), so one question covers both.
 */
export const meshVerifyInput = z.object({
    /** What the peer presented at the upgrade. */
    presented: z.string().min(1),
    /** The replica being connected to: a grant is only good for the replica it names. */
    replicaId: z.string().min(1),
})

export const meshVerifyOutput = z.object({ ok: z.boolean() })

const meshVerifyOps = standard.zod(meshVerifyOutput, 'meshVerify')

export const meshVerifyContract = meshVerifyOps
    .create()
    .path('/verify')
    .input((b) => b.body(meshVerifyInput))
    .output(meshVerifyOutput)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build()
