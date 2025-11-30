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
