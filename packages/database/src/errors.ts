import { domainError } from '@deployer/effect-core'

/** The handle was read before anything gave it a connection. */
export class DatabaseNotInitialized extends domainError(
    'DatabaseNotInitialized',
    'dependency_missing'
)<{
    readonly owner: string
}>() {
    override publicMessage() {
        return `${this.owner} has not been initialized yet`
    }
}

/** The database did not answer a probe, or answered with an error. */
export class DatabaseUnhealthy extends domainError(
    'DatabaseUnhealthy',
    'dependency_missing'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}
