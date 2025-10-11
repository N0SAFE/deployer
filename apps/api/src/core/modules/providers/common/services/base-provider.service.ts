import { Logger } from '@nestjs/common';
import type { IDeploymentProvider, ProviderConfig, DeploymentTrigger, SourceFiles } from '../../interfaces/provider.interface';

/**
 * Base Provider Service
 * Provides common utilities and patterns for all provider services
 * Implements IDeploymentProvider as an abstract class
 */
export abstract class BaseProviderService implements IDeploymentProvider {
    protected readonly logger: Logger;

    /**
     * Provider name (must be implemented by subclass)
     */
    abstract readonly name: string;

    /**
     * Provider type (must be implemented by subclass)
     */
    abstract readonly type: 'github' | 'gitlab' | 'git' | 'static' | 'docker-registry' | 's3' | 'custom';

    constructor(loggerContext: string) {
        this.logger = new Logger(loggerContext);
    }

    /**
     * Fetch source files from the provider (must be implemented by subclass)
     */
    abstract fetchSource(config: ProviderConfig, trigger: DeploymentTrigger): Promise<SourceFiles>;

    /**
     * Validate provider configuration (must be implemented by subclass)
     */
    abstract validateConfig(config: ProviderConfig): Promise<{ valid: boolean; errors?: string[] }>;

    /**
     * Check if deployment should be skipped based on cache (must be implemented by subclass)
     */
    abstract shouldSkipDeployment(
        config: ProviderConfig,
        trigger: DeploymentTrigger,
    ): Promise<{ shouldSkip: boolean; reason: string }>;

    /**
     * Get the display name/version for this deployment (must be implemented by subclass)
     */
    abstract getDeploymentVersion(source: SourceFiles): string;

    /**
     * Get the default Traefik configuration template for this provider (must be implemented by subclass)
     */
    abstract getTraefikTemplate(): string;

    /**
     * Log with consistent formatting
     */
    protected log(message: string, metadata?: Record<string, any>): void {
        if (metadata) {
            this.logger.log(`${message} ${JSON.stringify(metadata)}`);
        } else {
            this.logger.log(message);
        }
    }

    /**
     * Log debug information
     */
    protected debug(message: string, metadata?: Record<string, any>): void {
        if (metadata) {
            this.logger.debug(`${message} ${JSON.stringify(metadata)}`);
        } else {
            this.logger.debug(message);
        }
    }

    /**
     * Log warning
     */
    protected warn(message: string, error?: Error | unknown): void {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`${message}${error ? `: ${errorMessage}` : ''}`);
    }

    /**
     * Log error
     */
    protected error(message: string, error?: Error | unknown): void {
        if (error instanceof Error) {
            this.logger.error(`${message}: ${error.message}`, error.stack);
        } else {
            this.logger.error(`${message}: ${String(error)}`);
        }
    }

    /**
     * Sanitize string for use in subdomain/domain names
     * Converts to lowercase and replaces invalid characters with hyphens
     */
    protected sanitizeForDomain(value: string): string {
        return value
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    /**
     * Match a string against a glob-like pattern
     * Supports: *, ** wildcards
     */
    protected matchesPattern(value: string, pattern: string): boolean {
        // Convert glob pattern to regex
        const regexPattern = pattern
            .split('*')
            .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*');
        
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(value);
    }

    /**
     * Safe JSON stringify with error handling
     */
    protected safeJsonStringify(value: any, defaultValue = '{}'): string {
        try {
            return JSON.stringify(value);
        } catch (error) {
            this.warn('Failed to stringify JSON', error);
            return defaultValue;
        }
    }

    /**
     * Safe JSON parse with error handling
     */
    protected safeJsonParse<T = any>(value: string, defaultValue: T | null = null): T | null {
        try {
            return JSON.parse(value) as T;
        } catch (error) {
            this.warn('Failed to parse JSON', error);
            return defaultValue;
        }
    }

    /**
     * Generate a unique identifier
     */
    protected generateId(): string {
        return crypto.randomUUID();
    }

    /**
     * Execute an async operation with error handling and logging
     */
    protected async executeWithLogging<T>(
        operationName: string,
        operation: () => Promise<T>,
        onError?: (error: Error) => T | Promise<T>
    ): Promise<T> {
        try {
            this.debug(`Starting: ${operationName}`);
            const result = await operation();
            this.debug(`Completed: ${operationName}`);
            return result;
        } catch (error) {
            this.error(`Failed: ${operationName}`, error);
            if (onError) {
                return await onError(error as Error);
            }
            throw error;
        }
    }

    /**
     * Retry an async operation with exponential backoff
     */
    protected async retryWithBackoff<T>(
        operationName: string,
        operation: () => Promise<T>,
        options: {
            maxRetries?: number;
            initialDelay?: number;
            maxDelay?: number;
            backoffMultiplier?: number;
        } = {}
    ): Promise<T> {
        const {
            maxRetries = 3,
            initialDelay = 1000,
            maxDelay = 10000,
            backoffMultiplier = 2,
        } = options;

        let lastError: Error | null = null;
        let delay = initialDelay;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.debug(`${operationName} (attempt ${attempt}/${maxRetries})`);
                return await operation();
            } catch (error) {
                lastError = error as Error;
                this.warn(`${operationName} failed (attempt ${attempt}/${maxRetries})`, error);

                if (attempt < maxRetries) {
                    await this.sleep(Math.min(delay, maxDelay));
                    delay *= backoffMultiplier;
                }
            }
        }

        this.error(`${operationName} failed after ${maxRetries} attempts`, lastError);
        throw lastError;
    }

    /**
     * Sleep for a specified duration
     */
    protected async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Validate required fields in an object
     */
    protected validateRequired<T extends Record<string, any>>(
        data: T,
        requiredFields: Array<keyof T>,
        context: string
    ): void {
        const missing = requiredFields.filter(field => !data[field]);
        if (missing.length > 0) {
            const error = `${context}: Missing required fields: ${missing.join(', ')}`;
            this.error(error);
            throw new Error(error);
        }
    }

    /**
     * Get current timestamp
     */
    protected getCurrentTimestamp(): Date {
        return new Date();
    }

    /**
     * Format bytes to human-readable string
     */
    protected formatBytes(bytes: number): string {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * Sanitize metadata to prevent invalid characters (like NUL bytes)
     */
    protected sanitizeMetadata(metadata?: Record<string, any>): Record<string, any> {
        if (!metadata) return {};

        try {
            const serialized = JSON.stringify(metadata);
            const sanitized = serialized.replace(/\u0000/g, '');
            return sanitized && sanitized !== '{}' ? JSON.parse(sanitized) : {};
        } catch {
            return {};
        }
    }

    /**
     * Sanitize string to prevent invalid characters
     */
    protected sanitizeString(value: string): string {
        return String(value || '').replace(/\u0000/g, '');
    }

    /**
     * Extract error message safely
     */
    protected getErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }

    /**
     * Check if a value is defined (not null or undefined)
     */
    protected isDefined<T>(value: T | null | undefined): value is T {
        return value !== null && value !== undefined;
    }

    /**
     * Create a timeout promise
     */
    protected createTimeout(ms: number, message = 'Operation timed out'): Promise<never> {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error(message)), ms);
        });
    }

    /**
     * Run operation with timeout
     */
    protected async withTimeout<T>(
        operation: Promise<T>,
        timeoutMs: number,
        timeoutMessage = 'Operation timed out'
    ): Promise<T> {
        return Promise.race([
            operation,
            this.createTimeout(timeoutMs, timeoutMessage),
        ]);
    }
}
