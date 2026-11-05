import z from 'zod/v4'

import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

const selfDeleteResultSchema = z.object({ deleted: z.literal(true) })

const selfOps = standard.zod(selfDeleteResultSchema, 'selfDelete')

/**
 * Delete the CALLER'S account (`AUTH-032`).
 *
 * Scoped to the session, so there is no id to point at someone else, and it requires a fresh passkey proof: deleting an
 * account ends it, and the request must come from the person behind it rather than from a walked-away tab. The service
 * refuses when the caller is the last platform super admin — a lockout is not a deletion.
 *
 * The user row cascades to its sessions, accounts and keys, so a later sign-in cannot resurrect any of them.
 */
export const selfDeleteContract = selfOps
    .create()
    .path('/me/delete')
    .input(z.object({}))
    .output(selfDeleteResultSchema)
    .tags('User')
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build()
