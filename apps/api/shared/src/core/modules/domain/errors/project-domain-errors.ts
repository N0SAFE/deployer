import { domainError } from '@deployer/effect-core'

export class ProjectDomainNotFoundError extends domainError(
    'ProjectDomainNotFoundError',
    'not_found'
)<{
    readonly identifier: string
}>() {
    override publicMessage() {
        return `Project domain with ID '${this.identifier}' not found`
    }
}

export class ProjectDomainUpdateError extends domainError(
    'ProjectDomainUpdateError',
    'dependency_missing'
)<{
    readonly domainId: string
    readonly reason?: string
}>() {
    override publicMessage() {
        return `Failed to update project domain with ID '${this.domainId}'${this.reason ? `: ${this.reason}` : ''}`
    }
}

export class ProjectDomainDeletionError extends domainError(
    'ProjectDomainDeletionError',
    'dependency_missing'
)<{
    readonly domainId: string
    readonly reason?: string
}>() {
    override publicMessage() {
        return `Failed to delete project domain with ID '${this.domainId}'${this.reason ? `: ${this.reason}` : ''}`
    }
}
