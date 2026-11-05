import { domainError } from '@deployer/effect-core'

/** The engine has no such object (HTTP 404). `resource` names it for the client, e.g. `swarm service 'web'`. */
export class DockerNotFound extends domainError('DockerNotFound', 'not_found')<{
    readonly resource: string
}>() {
    override publicMessage() {
        return `${this.resource} not found`
    }
}

/** The request cannot be honoured as asked, e.g. a pull policy that forbids the pull the image needs. */
export class DockerInvalid extends domainError('DockerInvalid', 'validation')<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The engine holds state that collides with the request, e.g. a bridge network where an overlay is required. */
export class DockerConflict extends domainError('DockerConflict', 'conflict')<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The engine could not do it: unreachable, refused the call, or answered with something unreadable. */
export class DockerUnavailable extends domainError(
    'DockerUnavailable',
    'dependency_missing'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

export type DockerError =
    DockerNotFound | DockerInvalid | DockerConflict | DockerUnavailable
