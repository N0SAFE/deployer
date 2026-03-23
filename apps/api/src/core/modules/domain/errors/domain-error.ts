/**
 * Base error class for all domain-related errors.
 * 
 * Follows the ErrorClass.name convention for consistent error messaging.
 * All domain errors should extend this class.
 * 
 * @example
 * ```typescript
 * throw new DomainError('Something went wrong with domain operations');
 * // Error message: "[DomainError] Something went wrong with domain operations"
 * ```
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(`[${new.target.name}] ${message}`);
    this.name = new.target.name;
    
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    Error.captureStackTrace(this, new.target);
  }
}
