import z from 'zod/v4'

import { access } from '@deployer/auth/authz/meta'
import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

export const getPublicKeyOutputSchema = z.object({
    publicKey: z.string(),
})

const pushPublicKeyOps = standard.zod(getPublicKeyOutputSchema, 'pushPublicKey')

export const getPublicKeyContract = pushPublicKeyOps
    .list()
    .path('/public-key')
    .input(z.object({}))
    .output(getPublicKeyOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(
        access({
            self: true,
            reason: 'the caller manages their own devices and notifications',
        })
    )
    .build()
