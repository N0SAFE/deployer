/**
 * Base class for every mesh domain error.
 *
 * Decoupled from any transport (HTTP, gRPC, IPC) — a NestJS exception
 * filter maps these to the correct transport-level status code / ORPC
 * error code via the `httpStatus` and `orpcCode` fields.
 *
 * Each subclass declares its own:
 *   - `code`     — stable, machine-readable identifier (e.g. "mesh.not_found")
 *   - `httpStatus` — HTTP status code (e.g. 404) used by the filter
 *   - `orpcCode`  — ORPC error code (e.g. "NOT_FOUND") used by the contract
 *
 * Usage:
 *   class MeshTrustError extends MeshBaseDomainError { ... }
 *   class MeshTopicQueryTimeoutError extends MeshBaseDomainError { ... }
 */
export class MeshBaseDomainError extends Error {
    /**
     * @param code       Stable machine-readable identifier (snake.case).
     * @param message    Human-readable error message.
     * @param httpStatus HTTP status code the transport filter should return.
     * @param orpcCode   ORPC error code emitted in the contract response.
     */
    constructor(
        public readonly code: string,
        message: string,
        public readonly httpStatus = 500,
        public readonly orpcCode = "INTERNAL_SERVER_ERROR",
    ) {
        super(message)
        this.name = this.constructor.name
        // Preserve stack trace in V8
        Error.captureStackTrace(this, this.constructor)
    }

    /**
     * Convert this domain error to a plain serializable shape.
     * Used by the HTTP exception filter to build the response body
     * without leaking the stack trace.
     */
    toJSON(): { code: string; message: string; httpStatus: number; orpcCode: string } {
        return {
            code: this.code,
            message: this.message,
            httpStatus: this.httpStatus,
            orpcCode: this.orpcCode,
        }
    }

    /**
     * Check whether an unknown value is a mesh domain error.
     */
    static isMeshDomainError(error: unknown): error is MeshBaseDomainError {
        return error instanceof MeshBaseDomainError
    }

    /**
     * Check whether an unknown error has a specific code.
     */
    static hasCode(error: unknown, code: string): boolean {
        return (
            MeshBaseDomainError.isMeshDomainError(error) && error.code === code
        )
    }
}
