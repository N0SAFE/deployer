import { domainError } from '@deployer/effect-core'

/** A service did not answer: the connection failed before any HTTP response came back. */
export class ServiceUnreachable extends domainError(
    'ServiceUnreachable',
    'dependency_missing'
)<{
    readonly service: string
    readonly origin: string
    readonly reason: string
}>() {
    override publicMessage() {
        return `Service '${this.service}' (${this.origin}) is unreachable: ${this.reason}`
    }
}
