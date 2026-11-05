import { domainError } from '@deployer/effect-core';

import { TraefikError } from './config.error';

/**
 * Error thrown when middleware configuration is invalid
 */
export class MiddlewareError extends TraefikError {
  constructor(
    message: string,
    public readonly middlewareName: string,
    public readonly middlewareType?: string
  ) {
    super(message, 'MIDDLEWARE_ERROR', { middlewareName, middlewareType });
    this.name = MiddlewareError.name;
  }
}

/**
 * Error thrown when a middleware is not found
 */
export class MiddlewareNotFoundError extends TraefikError {
  constructor(
    public readonly middlewareName: string,
    public readonly scope?: 'global' | 'local'
  ) {
    super(
      `Middleware not found: ${middlewareName}${scope ? ` (scope: ${scope})` : ''}`,
      'MIDDLEWARE_NOT_FOUND',
      { middlewareName, scope }
    );
    this.name = MiddlewareNotFoundError.name;
  }
}

/**
 * Error thrown when middleware configuration validation fails
 */
export class MiddlewareConfigurationError extends TraefikError {
  constructor(
    public readonly middlewareName: string,
    public readonly middlewareType: string,
    public readonly validationErrors: string[]
  ) {
    super(
      `Invalid configuration for middleware '${middlewareName}' (type: ${middlewareType}): ${validationErrors.join(', ')}`,
      'MIDDLEWARE_CONFIGURATION_ERROR',
      { middlewareName, middlewareType, validationErrors }
    );
    this.name = MiddlewareConfigurationError.name;
  }
}

/** A middleware builder was called without a required option. */
export class MiddlewareOptionsInvalid extends domainError("MiddlewareOptionsInvalid", "validation")<{
  readonly middlewareName: string;
  readonly missingFields: readonly string[];
}>() {
  override publicMessage() { return `Missing required fields: ${this.missingFields.join(", ")}`; }
}

/** A middleware option is present but invalid (an empty user list, fewer than one retry attempt, ...). */
export class MiddlewareConfigurationInvalid extends domainError("MiddlewareConfigurationInvalid", "validation")<{
  readonly middlewareName: string;
  readonly middlewareType: string;
  readonly validationErrors: readonly string[];
}>() {
  override publicMessage() {
    return `Invalid configuration for middleware '${this.middlewareName}' (type: ${this.middlewareType}): ${this.validationErrors.join(", ")}`;
  }
}
