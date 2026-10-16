/**
 * Core Application Error Classes
 *
 * All application errors should extend these base classes instead of `Error`.
 * This ensures consistent error codes, context serialization, and stack traces
 * across the monorepo.
 *
 * ## Usage
 *
 * ```typescript
 * import { NotFoundError } from "@deployer/errors"
 *
 * throw new NotFoundError("User", userId)
 * ```
 *
 * ## Module-specific errors
 *
 * Extend these classes for module-specific errors:
 *
 * ```typescript
 * import { AppError } from "@deployer/errors"
 *
 * export class MeshConnectionError extends AppError {
 *   constructor(peerId: string) {
 *     super(`Mesh peer ${peerId} unreachable`, "MESH_CONNECTION_ERROR", { peerId })
 *   }
 * }
 * ```
 */

/**
 * How a stable error `code` maps onto the transport.
 *
 * ── WHY THIS LIVES WITH THE ERROR AND NOT WITH A CONTROLLER ─────────────────
 * A domain object must be able to say "this is not found" without importing
 * `@nestjs/common` — that is the whole point of a domain layer that a service,
 * a worker and a test can all use. But the transport still has to turn that into
 * a 404 rather than a 500. Carrying the two facts on the error itself is what
 * lets the domain stay transport-free while the mapping stays in ONE place
 * (the oRPC error interceptor), instead of being re-decided by every caller in a
 * `try/catch` that somebody will eventually forget.
 *
 * `AppError.code` is a string, so a subclass may invent a code. Unknown codes
 * fall back to 500/INTERNAL_SERVER_ERROR: an unmapped error is a bug in this
 * table, and reporting it as a client error would hide it.
 */
const TRANSPORT_FOR_CODE: Readonly<
  Record<string, { readonly httpStatus: number; readonly orpcCode: string }>
> = {
  NOT_FOUND: { httpStatus: 404, orpcCode: 'NOT_FOUND' },
  VALIDATION_ERROR: { httpStatus: 400, orpcCode: 'BAD_REQUEST' },
  BAD_REQUEST: { httpStatus: 400, orpcCode: 'BAD_REQUEST' },
  UNAUTHORIZED: { httpStatus: 401, orpcCode: 'UNAUTHORIZED' },
  FORBIDDEN: { httpStatus: 403, orpcCode: 'FORBIDDEN' },
  CONFLICT: { httpStatus: 409, orpcCode: 'CONFLICT' },
  TIMEOUT: { httpStatus: 408, orpcCode: 'TIMEOUT' },
  SERVICE_UNAVAILABLE: { httpStatus: 503, orpcCode: 'SERVICE_UNAVAILABLE' },
  NOT_IMPLEMENTED: { httpStatus: 501, orpcCode: 'NOT_IMPLEMENTED' },
  INTERNAL_ERROR: { httpStatus: 500, orpcCode: 'INTERNAL_SERVER_ERROR' },
}

/**
 * Base application error class
 * All application errors should extend this class
 */
export class AppError extends Error {
  /**
   * HTTP status the transport should report. Derived from `code`, overridable
   * by a subclass whose code needs a different status.
   */
  public readonly httpStatus: number

  /** oRPC error code, so a thrown domain error reaches a client as a DEFINED error. */
  public readonly orpcCode: string

  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    const transport = TRANSPORT_FOR_CODE[code];
    this.httpStatus = transport?.httpStatus ?? 500;
    this.orpcCode = transport?.orpcCode ?? 'INTERNAL_SERVER_ERROR';
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Serialize the error for logging or API responses
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
    };
  }

  /**
   * Create a string representation for logging
   */
  toString(): string {
    const contextStr = this.context
      ? ` Context: ${JSON.stringify(this.context)}`
      : '';
    return `[${this.code}] ${this.message}${contextStr}`;
  }
}

/**
 * Error thrown when a requested resource is not found
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string | Record<string, unknown>) {
    const identifierStr =
      typeof identifier === 'string'
        ? identifier
        : identifier
          ? JSON.stringify(identifier)
          : 'unknown';

    super(`${resource} not found: ${identifierStr}`, 'NOT_FOUND', {
      resource,
      identifier,
    });
    this.name = 'NotFoundError';
  }
}

/**
 * Validation issue structure
 */
export type ValidationIssue = {
  path: string;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly issues: ValidationIssue[],
  ) {
    super(message, 'VALIDATION_ERROR', { issues });
    this.name = 'ValidationError';
  }

  /**
   * Get only error-level issues
   */
  get errors(): ValidationIssue[] {
    return this.issues.filter((i) => i.severity === 'error');
  }

  /**
   * Get only warning-level issues
   */
  get warnings(): ValidationIssue[] {
    return this.issues.filter((i) => i.severity === 'warning');
  }
}

/**
 * Error thrown when an operation conflicts with existing state
 */
export class ConflictError extends AppError {
  constructor(
    message: string,
    public readonly conflictingResource?: string,
    context?: Record<string, unknown>,
  ) {
    super(message, 'CONFLICT', { ...context, conflictingResource });
    this.name = 'ConflictError';
  }
}

/**
 * Error thrown when a user is not authorized to perform an action
 */
export class UnauthorizedError extends AppError {
  constructor(
    message = 'Unauthorized',
    public readonly action?: string,
    public readonly resource?: string,
  ) {
    super(message, 'UNAUTHORIZED', { action, resource });
    this.name = 'UnauthorizedError';
  }
}

/**
 * Error thrown when a user is forbidden from accessing a resource
 */
export class ForbiddenError extends AppError {
  constructor(
    message = 'Forbidden',
    public readonly action?: string,
    public readonly resource?: string,
  ) {
    super(message, 'FORBIDDEN', { action, resource });
    this.name = 'ForbiddenError';
  }
}

/**
 * Error thrown when an operation times out
 */
export class TimeoutError extends AppError {
  constructor(
    operation: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Operation '${operation}' timed out after ${String(timeoutMs)}ms`,
      'TIMEOUT',
      { operation, timeoutMs },
    );
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when a service or dependency is unavailable
 */
export class ServiceUnavailableError extends AppError {
  constructor(
    service: string,
    public readonly cause?: Error,
  ) {
    super(`Service '${service}' is unavailable`, 'SERVICE_UNAVAILABLE', {
      service,
    });
    this.name = 'ServiceUnavailableError';
    if (cause?.stack) {
      this.stack = `${this.stack ?? ''}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Error thrown for bad request / invalid input
 */
export class BadRequestError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BAD_REQUEST', context);
    this.name = 'BadRequestError';
  }
}
