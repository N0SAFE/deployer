import z from 'zod/v4'

import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

/**
 * Revoking a join token before it expires.
 *
 * The operator has the token (it is shown once, when it is issued), so the token itself is the key: the agent remembers
 * it and both `roster.check` and `roster.join` refuse it from then on. Revoking an unknown or expired token is a no-op,
 * which keeps the call idempotent.
 */
export const meshRevokeInput = z.object({
    token: z.string().min(1).max(4096),
})

export const meshRevokeOutput = z.object({
    revoked: z.boolean(),
})

const meshRevokeOps = standard.zod(meshRevokeOutput, 'meshRevoke')

export const meshRevokeContract = meshRevokeOps
    .create()
    .path('/revoke')
    .input((b) => b.body(meshRevokeInput))
    .output(meshRevokeOutput)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build()
