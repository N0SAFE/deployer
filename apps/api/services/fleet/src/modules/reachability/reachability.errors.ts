import { domainError } from '@deployer/effect-core'

/**
 * This node's agent was asked for something it does not offer.
 *
 * `dependency_missing` (424): the member is still in the mesh, nothing was changed, and a caller can tell this apart
 * from a refused input.
 */
export class NodeAgentUnsupported extends domainError(
    'NodeAgentUnsupported',
    'dependency_missing'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}
