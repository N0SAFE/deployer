import { domainError } from '@deployer/effect-core'

/** Something the caller named does not exist: a project, webhook, API key, environment, template... */
export class ResourceNotFound extends domainError(
    'ResourceNotFound',
    'not_found'
)<{
    readonly entity: string
    readonly id: string
}>() {
    override publicData() {
        return { entity: this.entity, id: this.id }
    }
    override publicMessage() {
        return `${this.entity} "${this.id}" was not found`
    }
}

/** Something is missing, and the refusal already says what (a message from a collaborator we do not own). */
export class ResourceMissing extends domainError("ResourceMissing", "not_found")<{
	readonly reason: string;
}>() {
	override publicMessage() {
		return this.reason;
	}
}

/** The request collides with existing state. `reason` is a sentence written for the client. */
export class ProjectConflict extends domainError(
    'ProjectConflict',
    'conflict'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The actor may not do this. `reason` is a sentence written for the client. */
export class ProjectForbidden extends domainError(
    'ProjectForbidden',
    'forbidden'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** The input breaks a rule. `reason` is a sentence written for the client. */
export class ProjectInvalid extends domainError(
    'ProjectInvalid',
    'validation'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** Every failure a project use case raises on purpose. */
export type ProjectDomainFailure =
    ResourceNotFound | ProjectConflict | ProjectForbidden | ProjectInvalid
