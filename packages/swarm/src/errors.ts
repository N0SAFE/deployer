import { domainError } from '@deployer/effect-core'

/** The local engine is not in a state the operation needs, e.g. it is not an active swarm member. */
export class SwarmUnavailable extends domainError(
    'SwarmUnavailable',
    'dependency_missing'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The cluster did not reach the state the operation waited for in time. */
export class SwarmTimeout extends domainError(
    'SwarmTimeout',
    'dependency_missing'
)<{
    readonly waitingFor: string
    readonly afterMs: number
}>() {
    override publicMessage() {
        return `Timed out after ${String(this.afterMs)}ms waiting for ${this.waitingFor}`
    }
}

/** The request is refused by the cluster's rules (a role that cannot be taken, a node that is not allowed). */
export class SwarmInvalid extends domainError('SwarmInvalid', 'validation')<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The request collides with the cluster's state (already a member, a term already claimed). */
export class SwarmConflict extends domainError('SwarmConflict', 'conflict')<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}
