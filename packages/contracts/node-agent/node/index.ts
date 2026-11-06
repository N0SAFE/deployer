import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'

import { meshNodeConfigureContract } from './configure'
import { meshNodeLabelsContract } from './labels'
import {
    meshNodeFleetSecretsContract,
    meshNodeRetirePlatformSecretContract,
    meshNodeRotatePlatformSecretContract,
} from './secrets'
import { meshNodeSettingsContract } from './settings'
import { meshNodeStateContract } from './state'
import { meshNodeStatusContract } from './status'

/**
 * The node door: what the node's own services ask their agent about the node itself.
 *
 * Served on the agent's unix socket only, so a peer agent cannot configure another node even with the swarm's
 * credential. The agent is the only service that runs on every node, so it is the one that owns the node's local
 * database and answers for it.
 */
export const meshNodeContract = oc
    .meta(openapi({ tags: ['Mesh node'], prefix: '/node' }))
    .router({
        configure: meshNodeConfigureContract,
        labels: meshNodeLabelsContract,
        retirePlatformSecret: meshNodeRetirePlatformSecretContract,
        rotatePlatformSecret: meshNodeRotatePlatformSecretContract,
        fleetSecrets: meshNodeFleetSecretsContract,
        settings: meshNodeSettingsContract,
        state: meshNodeStateContract,
        status: meshNodeStatusContract,
    })

export type MeshNodeContract = typeof meshNodeContract

export * from './configure'
export * from './labels'
export * from './platform-secret-ring'
export * from './secrets'
export * from './settings'
export * from './state'
export * from './status'
