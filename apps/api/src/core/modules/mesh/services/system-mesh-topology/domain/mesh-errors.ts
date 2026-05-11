import { MeshBaseDomainError } from "../../../shared/domain/mesh-base-error";

export { MeshBaseDomainError };

export class MeshNotFoundError extends MeshBaseDomainError {
    constructor(resource: string, id: string) {
        super("mesh.not_found", `${resource} '${id}' not found`);
    }
}

export class MeshValidationError extends MeshBaseDomainError {
    constructor(message: string) {
        super("mesh.validation", message);
    }
}

export class MeshAuthorizationError extends MeshBaseDomainError {
    constructor(action: string) {
        super("mesh.unauthorized", `Not authorized to ${action}`);
    }
}

export class MeshTrustError extends MeshBaseDomainError {
    constructor(reason: string) {
        super("mesh.trust", `Trust violation: ${reason}`);
    }
}

export class MeshConflictError extends MeshBaseDomainError {
    constructor(reason: string) {
        super("mesh.conflict", reason);
    }
}

export class MeshDependencyMissingError extends MeshBaseDomainError {
    constructor(dependency: string, action: string) {
        super("mesh.dependency_missing", `${dependency} required to ${action}`);
    }
}