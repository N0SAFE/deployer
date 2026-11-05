import { domainError } from '@deployer/effect-core'
import { AppError } from '@deployer/errors'
import type { ValidationIssue } from '@deployer/errors'

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
        super(message, code, context)
        this.name = TraefikError.name
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
        super(message, 'CONFIG_BUILD_ERROR', { builderState })
        this.name = ConfigBuildError.name
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
        super(message, 'CONFIG_SYNC_ERROR', { configId, path })
        this.name = ConfigSyncError.name
        if (cause?.stack) {
            this.stack = `${this.stack ?? ''}\nCaused by: ${cause.stack}`
        }
    }
}

/**
 * Error thrown when configuration validation fails
 */
export class ConfigValidationError extends TraefikError {
    constructor(public readonly issues: ValidationIssue[]) {
        const errorCount = issues.filter((i) => i.severity === 'error').length
        super(
            `Configuration validation failed with ${String(errorCount)} error(s)`,
            'CONFIG_VALIDATION_ERROR',
            { issues }
        )
        this.name = ConfigValidationError.name
    }

    /**
     * Get only error-level issues
     */
    get errors(): ValidationIssue[] {
        return this.issues.filter((i) => i.severity === 'error')
    }

    /**
     * Get only warning-level issues
     */
    get warnings(): ValidationIssue[] {
        return this.issues.filter((i) => i.severity === 'warning')
    }
}

/** A Traefik configuration does not exist. */
export class ConfigNotFoundError extends domainError(
    'ConfigNotFoundError',
    'not_found'
)<{
    readonly configId: string
    readonly configType?: string
}>() {
    override publicMessage() {
        return `${this.configType ?? 'service'} configuration not found: ${this.configId}`
    }
}

/** Writing a generated configuration file to the Traefik config directory failed; the cause stays server-side. */
export class ConfigFileWriteFailure extends domainError(
    'ConfigFileWriteFailure',
    'dependency_missing'
)<{
    readonly filePath: string
}>() {
    override publicMessage() {
        return `Could not write the Traefik configuration file ${this.filePath}`
    }
}

/** A bulk sync or cleanup could not start (the database or the config directory failed); the cause stays server-side. */
export class ConfigSyncFailure extends domainError(
    'ConfigSyncFailure',
    'dependency_missing'
)<{
    readonly operation: string
}>() {
    override publicMessage() {
        return `Traefik configuration ${this.operation} failed`
    }
}
