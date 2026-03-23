import { DomainError } from './domain-error';

/**
 * Thrown when an organization domain is not found.
 * 
 * @example
 * ```typescript
 * throw new OrganizationDomainNotFoundError('domain-123');
 * // Error message: "[OrganizationDomainNotFoundError] Organization domain with ID 'domain-123' not found"
 * 
 * throw new OrganizationDomainNotFoundError('example.com', 'domain');
 * // Error message: "[OrganizationDomainNotFoundError] Organization domain 'example.com' not found"
 * ```
 */
export class OrganizationDomainNotFoundError extends DomainError {
  constructor(identifier: string, type: 'id' | 'domain' = 'id') {
    const message = type === 'id' 
      ? `Organization domain with ID '${identifier}' not found`
      : `Organization domain '${identifier}' not found`;
    super(message);
  }
}

/**
 * Thrown when attempting to register a domain that already exists.
 * 
 * @example
 * ```typescript
 * throw new DomainAlreadyExistsError('example.com');
 * // Error message: "[DomainAlreadyExistsError] Domain 'example.com' is already registered"
 * ```
 */
export class DomainAlreadyExistsError extends DomainError {
  constructor(domain: string) {
    super(`Domain '${domain}' is already registered`);
  }
}

/**
 * Thrown when a domain name has an invalid format.
 * 
 * @example
 * ```typescript
 * throw new InvalidDomainFormatError('invalid..domain');
 * // Error message: "[InvalidDomainFormatError] Invalid domain format: 'invalid..domain'"
 * 
 * throw new InvalidDomainFormatError('invalid..domain', 'Consecutive dots are not allowed');
 * // Error message: "[InvalidDomainFormatError] Invalid domain format: 'invalid..domain'. Consecutive dots are not allowed"
 * ```
 */
export class InvalidDomainFormatError extends DomainError {
  constructor(domain: string, reason?: string) {
    const message = reason
      ? `Invalid domain format: '${domain}'. ${reason}`
      : `Invalid domain format: '${domain}'`;
    super(message);
  }
}

/**
 * Thrown when attempting to use a domain that has not been verified.
 * 
 * @example
 * ```typescript
 * throw new DomainNotVerifiedError('example.com');
 * // Error message: "[DomainNotVerifiedError] Domain 'example.com' is not verified. Please verify the domain first."
 * ```
 */
export class DomainNotVerifiedError extends DomainError {
  constructor(domain: string) {
    super(`Domain '${domain}' is not verified. Please verify the domain first.`);
  }
}

/**
 * Thrown when domain deletion fails.
 * 
 * @example
 * ```typescript
 * throw new DomainDeletionError('domain-123');
 * // Error message: "[DomainDeletionError] Failed to delete domain with ID 'domain-123'"
 * 
 * throw new DomainDeletionError('domain-123', 'Domain has active project associations');
 * // Error message: "[DomainDeletionError] Failed to delete domain with ID 'domain-123': Domain has active project associations"
 * ```
 */
export class DomainDeletionError extends DomainError {
  constructor(domainId: string, reason?: string) {
    const message = reason
      ? `Failed to delete domain with ID '${domainId}': ${reason}`
      : `Failed to delete domain with ID '${domainId}'`;
    super(message);
  }
}

/**
 * Thrown when a project tries to use a subdomain at a level 
 * higher than their registered domain's granularity.
 * 
 * @example
 * ```typescript
 * throw new GranularityViolationError('api.staging.example.com', 'staging.example.com');
 * // Error message: "[GranularityViolationError] Cannot use subdomain 'api.staging.example.com'. Projects can only use subdomains at or below the registered domain level 'staging.example.com'"
 * ```
 */
export class GranularityViolationError extends DomainError {
  constructor(requestedSubdomain: string, registeredDomain: string) {
    super(
      `Cannot use subdomain '${requestedSubdomain}'. Projects can only use subdomains at or below the registered domain level '${registeredDomain}'`
    );
  }
}
