import { domainError } from '@deployer/effect-core'

/** The supervised resource cannot run in this deployment (no swarm and not deployment-managed). */
export class SupervisedResourceUnavailable extends domainError(
    'SupervisedResourceUnavailable',
    'dependency_missing'
)<{
    readonly resource: string
    readonly reason: string
}>() {
    override publicMessage() {
        return `${this.resource}: ${this.reason}`
    }
}

/** Convergence finished but the resource is not there: the engine accepted the spec and nothing exists. */
export class SupervisedResourceMissing extends domainError(
    'SupervisedResourceMissing',
    'dependency_missing'
)<{
    readonly resource: string
}>() {
    override publicMessage() {
        return `${this.resource} was not created`
    }
}

/** The resource was converged but has no running task; the engine accepted the spec and nothing runs. */
export class SupervisedResourceNotRunning extends domainError(
    'SupervisedResourceNotRunning',
    'dependency_missing'
)<{
    readonly resource: string
}>() {
    override publicMessage() {
        return `${this.resource} has no running task`
    }
}

/** A `direct` public lane's :80/:443 is already bound on some node. Deterministic: retrying cannot help, the operator frees the port or picks another lane. */
export class EntryPortConflict extends domainError(
    'EntryPortConflict',
    'conflict'
)<{
    readonly port: number
}>() {
    override publicMessage() {
        return `port ${String(this.port)} is already in use on a node`
    }
}
