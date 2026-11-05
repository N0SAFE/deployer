import { meshNodeContract } from '../node'

import { meshAccessContract } from './access'
import { meshDirectoryContract } from './directory'
import { meshRelayContract } from './relay'
import { meshRosterContract } from './roster'

/**
 * Every node-agent procedure. Internal: never composed into the public BFF router.
 *
 * `node` is served only on the agent's local socket; the rest is served on both doors (`peerRouter` in the transport).
 */
export const nodeAgentContract = {
    access: meshAccessContract,
    directory: meshDirectoryContract,
    node: meshNodeContract,
    relay: meshRelayContract,
    roster: meshRosterContract,
}

export type NodeAgentContract = typeof nodeAgentContract

export * from './access'
export * from './directory'
export * from './errors'
export * from './transport'
export * from './relay'
export * from './roster'
