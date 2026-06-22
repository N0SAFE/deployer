import { MeshBaseDomainError } from "../../../shared/domain/mesh-base-error";

export { MeshBaseDomainError };

/**
 * The canonical mapping between a mesh domain error and its transport
 * representation (HTTP status + ORPC error code).
 *
 * Single source of truth used by:
 *   - `InternalErrorExceptionFilter` to build HTTP responses
 *   - the mesh contract to declare typed error shapes via `.errors()`
 *   - clients (web, e2e) to pattern-match on a stable ORPC code
 */
export const MESH_DOMAIN_ERROR_HTTP_STATUS: Readonly<Record<string, number>> = Object.freeze({
    "mesh.not_found": 404,
    "mesh.validation": 400,
    "mesh.unauthorized": 403,
    "mesh.trust": 403,
    "mesh.conflict": 409,
    "mesh.dependency_missing": 424,
});

/**
 * The corresponding ORPC error codes. The contract surface and the
 * HTTP filter both read from this table so client and server agree
 * on the wire format.
 */
export const MESH_DOMAIN_ERROR_ORPC_CODE: Readonly<Record<string, string>> = Object.freeze({
    "mesh.not_found": "NOT_FOUND",
    "mesh.validation": "BAD_REQUEST",
    "mesh.unauthorized": "FORBIDDEN",
    "mesh.trust": "FORBIDDEN",
    "mesh.conflict": "CONFLICT",
    "mesh.dependency_missing": "FAILED_DEPENDENCY",
});

/**
 * Helper: look up the HTTP status for a given mesh error code, falling
 * back to 500 (server error) for unknown codes.
 */
export function meshDomainErrorStatus(code: string): number {
    return MESH_DOMAIN_ERROR_HTTP_STATUS[code] ?? 500;
}

/**
 * Helper: look up the ORPC error code for a given mesh error code.
 */
export function meshDomainErrorOrpcCode(code: string): string {
    return MESH_DOMAIN_ERROR_ORPC_CODE[code] ?? "INTERNAL_SERVER_ERROR";
}

export class MeshNotFoundError extends MeshBaseDomainError {
    constructor(resource: string, id: string) {
        super(
            "mesh.not_found",
            `${resource} '${id}' not found`,
            404,
            "NOT_FOUND",
        );
    }
}

export class MeshValidationError extends MeshBaseDomainError {
    constructor(message: string) {
        super(
            "mesh.validation",
            message,
            400,
            "BAD_REQUEST",
        );
    }
}

export class MeshAuthorizationError extends MeshBaseDomainError {
    constructor(action: string) {
        super(
            "mesh.unauthorized",
            `Not authorized to ${action}`,
            403,
            "FORBIDDEN",
        );
    }
}

export class MeshTrustError extends MeshBaseDomainError {
    constructor(reason: string) {
        super(
            "mesh.trust",
            `Trust violation: ${reason}`,
            403,
            "FORBIDDEN",
        );
    }
}

export class MeshConflictError extends MeshBaseDomainError {
    constructor(reason: string) {
        super(
            "mesh.conflict",
            reason,
            409,
            "CONFLICT",
        );
    }
}

export class MeshDependencyMissingError extends MeshBaseDomainError {
    constructor(dependency: string, action: string) {
        super(
            "mesh.dependency_missing",
            `${dependency} required to ${action}`,
            424,
            "FAILED_DEPENDENCY",
        );
    }
}