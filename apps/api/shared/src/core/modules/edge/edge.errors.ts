import { domainError } from '@deployer/effect-core'

/** Two edge providers claimed the same id: a wiring mistake at boot. */
export class EdgeProviderAlreadyRegistered extends domainError(
    'EdgeProviderAlreadyRegistered',
    'conflict'
)<{ readonly id: string }>() {
    override publicMessage() {
        return `Edge provider '${this.id}' is registered twice`
    }
}

/** No edge provider has that id. */
export class EdgeProviderUnknown extends domainError(
    'EdgeProviderUnknown',
    'validation'
)<{
    readonly id: string
    readonly available: readonly string[]
}>() {
    override publicMessage() {
        return `Unknown edge provider '${this.id}'. Available: ${this.available.join(', ') || 'none'}`
    }
}

/** A public lane does not satisfy its provider's descriptor (an unknown or mistyped option, a missing acknowledgement, the provider's own check). */
export class EdgeLaneInvalid extends domainError(
    'EdgeLaneInvalid',
    'validation'
)<{ readonly reason: string }>() {
    override publicMessage() {
        return this.reason
    }
}

/** The cluster setting that holds an edge provider's state could not be read or written; the cause stays server-side. */
export class EdgeStateFailure extends domainError(
    'EdgeStateFailure',
    'dependency_missing'
)<{ readonly operation: string }>() {
    override publicMessage() {
        return `The edge provider state could not be ${this.operation}.`
    }
}
