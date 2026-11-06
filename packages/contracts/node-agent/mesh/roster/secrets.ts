import z from 'zod/v4'

import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

import { meshNodeSecretsSchema } from '../../node/secrets'

const meshRosterSecretsOps = standard.zod(meshNodeSecretsSchema, 'meshRosterSecrets')

/**
 * What THIS agent's node holds, by fingerprint, for a peer that is assembling the fleet's picture. Served on the peer door:
 * it is how one agent asks another. It carries no value, and a peer already holds the swarm's credential.
 */
export const meshRosterSecretsContract = meshRosterSecretsOps
    .list()
    .path('/secrets')
    .input(z.object({}))
    .output(meshNodeSecretsSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build()
