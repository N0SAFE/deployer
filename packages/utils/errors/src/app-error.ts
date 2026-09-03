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
 * import { NotFoundError } from "@repo/errors"
 *
 * throw new NotFoundError("User", userId)
 * ```
 *
 * ## Module-specific errors
 *
 * Extend these classes for module-specific errors:
 *
 * ```typescript
 * import { AppError } from "@repo/errors"
 *
 * export class MeshConnectionError extends AppError {
 *   constructor(peerId: string) {
 *     super(`Mesh peer ${peerId} unreachable`, "MESH_CONNECTION_ERROR", { peerId })
 *   }
 * }
 * ```
 */

/**
 * Base application error class
 * All application errors should extend this class
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
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
