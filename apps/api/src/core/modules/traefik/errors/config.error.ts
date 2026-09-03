import { AppError } from '@repo/errors';
import type { ValidationIssue } from '@repo/errors';

/**
 * Base error class for all Traefik-related errors
 * All Traefik errors should extend this class
 */
export class TraefikError extends AppError {
  constructor(
    message: string,
    code: string,
    context?: Record<string, unknown>
  ) {
    super(message, code, context);
    this.name = TraefikError.name;
  }
}

/**
 * Error thrown when building a Traefik configuration fails
 */
export class ConfigBuildError extends TraefikError {
  constructor(
    message: string,
    public readonly builderState?: Record<string, unknown>
  ) {
    super(message, 'CONFIG_BUILD_ERROR', { builderState });
    this.name = ConfigBuildError.name;
  }
}

/**
 * Error thrown when synchronizing a configuration to the filesystem fails
 */
export class ConfigSyncError extends TraefikError {
  constructor(
    message: string,
    public readonly configId: string,
    public readonly path?: string,
    public readonly cause?: Error
  ) {
    super(message, 'CONFIG_SYNC_ERROR', { configId, path });
    this.name = ConfigSyncError.name;
    if (cause?.stack) {
      this.stack = `${this.stack ?? ''}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Error thrown when configuration validation fails
 */
export class ConfigValidationError extends TraefikError {
  constructor(
    public readonly issues: ValidationIssue[]
  ) {
    const errorCount = issues.filter(i => i.severity === 'error').length;
    super(
      `Configuration validation failed with ${String(errorCount)} error(s)`,
      'CONFIG_VALIDATION_ERROR',
      { issues }
    );
    this.name = ConfigValidationError.name;
  }

  /**
   * Get only error-level issues
   */
  get errors(): ValidationIssue[] {
    return this.issues.filter(i => i.severity === 'error');
  }

  /**
   * Get only warning-level issues
   */
  get warnings(): ValidationIssue[] {
    return this.issues.filter(i => i.severity === 'warning');
  }
}

/**
 * Error thrown when a configuration is not found
 */
export class ConfigNotFoundError extends TraefikError {
  constructor(
    public readonly configId: string,
    public readonly configType = 'service'
  ) {
    super(
      `${configType} configuration not found: ${configId}`,
      'CONFIG_NOT_FOUND',
      { configId, configType }
    );
    this.name = ConfigNotFoundError.name;
  }
}
