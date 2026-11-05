import { domainError } from '@deployer/effect-core'

/** The machine's readings could not be taken. */
export class MetricsUnavailable extends domainError(
    'MetricsUnavailable',
    'dependency_missing'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}
