import { DomainError } from './domain-error';

/**
 * Thrown when a service domain mapping is not found.
 * 
 * @example
 * ```typescript
 * throw new ServiceDomainMappingNotFoundError('mapping-123');
 * // Error message: "[ServiceDomainMappingNotFoundError] Service domain mapping with ID 'mapping-123' not found"
 * ```
 */
export class ServiceDomainMappingNotFoundError extends DomainError {
  constructor(identifier: string) {
    super(`Service domain mapping with ID '${identifier}' not found`);
  }
}

/**
 * Thrown when a mapping doesn't belong to the specified service.
 * 
 * @example
 * ```typescript
 * throw new ServiceMappingMismatchError('mapping-123', 'service-456');
 * // Error message: "[ServiceMappingMismatchError] Mapping 'mapping-123' does not belong to service 'service-456'"
 * ```
 */
export class ServiceMappingMismatchError extends DomainError {
  constructor(mappingId: string, serviceId: string) {
    super(`Mapping '${mappingId}' does not belong to service '${serviceId}'`);
  }
}

/**
 * Thrown when a subdomain + basePath combination conflicts with existing mappings.
 * 
 * @example
 * ```typescript
 * throw new SubdomainConflictError('api', '/v1', ['api.example.com/v1 (service-123)']);
 * // Error message: "[SubdomainConflictError] Subdomain 'api' with base path '/v1' is already in use. Conflicting mappings: api.example.com/v1 (service-123)"
 * ```
 */
export class SubdomainConflictError extends DomainError {
  public readonly subdomain: string | null;
  public readonly basePath: string | null;
  public readonly conflicts: string[];
  public readonly availableBasePaths?: string[];

  constructor(
    subdomain: string | null,
    basePath: string | null,
    conflicts: string[],
    availableBasePaths?: string[]
  ) {
    const subdomainStr = subdomain ?? 'root';
    const pathStr = basePath ?? '/';
    const conflictList = conflicts.join(', ');
    const suggestion = availableBasePaths?.length 
      ? ` Available base paths: ${availableBasePaths.join(', ')}`
      : '';
    
    super(
      `Subdomain '${subdomainStr}' with base path '${pathStr}' is already in use. Conflicting mappings: ${conflictList}.${suggestion}`
    );
    
    this.subdomain = subdomain;
    this.basePath = basePath;
    this.conflicts = conflicts;
    this.availableBasePaths = availableBasePaths;
  }
}

/**
 * Thrown when a subdomain is not in the allowed list for a project domain.
 * 
 * @example
 * ```typescript
 * throw new SubdomainNotAllowedError('staging', ['api', 'www', 'app']);
 * // Error message: "[SubdomainNotAllowedError] Subdomain 'staging' is not allowed. Allowed subdomains: api, www, app"
 * ```
 */
export class SubdomainNotAllowedError extends DomainError {
  constructor(subdomain: string, allowedSubdomains: string[]) {
    const allowed = allowedSubdomains.length > 0 
      ? allowedSubdomains.join(', ')
      : 'none (no subdomains allowed)';
    super(`Subdomain '${subdomain}' is not allowed. Allowed subdomains: ${allowed}`);
  }
}

/**
 * Thrown when a subdomain has an invalid format.
 * 
 * @example
 * ```typescript
 * throw new InvalidSubdomainFormatError('--invalid');
 * // Error message: "[InvalidSubdomainFormatError] Invalid subdomain format: '--invalid'"
 * 
 * throw new InvalidSubdomainFormatError('--invalid', 'Subdomain must start and end with alphanumeric characters');
 * // Error message: "[InvalidSubdomainFormatError] Invalid subdomain format: '--invalid'. Subdomain must start and end with alphanumeric characters"
 * ```
 */
export class InvalidSubdomainFormatError extends DomainError {
  constructor(subdomain: string, reason?: string) {
    const message = reason
      ? `Invalid subdomain format: '${subdomain}'. ${reason}`
      : `Invalid subdomain format: '${subdomain}'`;
    super(message);
  }
}

/**
 * Thrown when a base path has an invalid format.
 * 
 * @example
 * ```typescript
 * throw new InvalidBasePathFormatError('invalid-path');
 * // Error message: "[InvalidBasePathFormatError] Invalid base path format: 'invalid-path'"
 * 
 * throw new InvalidBasePathFormatError('invalid-path', 'Base path must start with /');
 * // Error message: "[InvalidBasePathFormatError] Invalid base path format: 'invalid-path'. Base path must start with /"
 * ```
 */
export class InvalidBasePathFormatError extends DomainError {
  constructor(basePath: string, reason?: string) {
    const message = reason
      ? `Invalid base path format: '${basePath}'. ${reason}`
      : `Invalid base path format: '${basePath}'`;
    super(message);
  }
}

/**
 * Thrown when service domain mapping update fails.
 * 
 * @example
 * ```typescript
 * throw new ServiceDomainMappingUpdateError('mapping-123');
 * // Error message: "[ServiceDomainMappingUpdateError] Failed to update service domain mapping with ID 'mapping-123'"
 * ```
 */
export class ServiceDomainMappingUpdateError extends DomainError {
  constructor(mappingId: string, reason?: string) {
    const message = reason
      ? `Failed to update service domain mapping with ID '${mappingId}': ${reason}`
      : `Failed to update service domain mapping with ID '${mappingId}'`;
    super(message);
  }
}

/**
 * Thrown when service domain mapping deletion fails.
 * 
 * @example
 * ```typescript
 * throw new ServiceDomainMappingDeletionError('mapping-123');
 * // Error message: "[ServiceDomainMappingDeletionError] Failed to delete service domain mapping with ID 'mapping-123'"
 * ```
 */
export class ServiceDomainMappingDeletionError extends DomainError {
  constructor(mappingId: string, reason?: string) {
    const message = reason
      ? `Failed to delete service domain mapping with ID '${mappingId}': ${reason}`
      : `Failed to delete service domain mapping with ID '${mappingId}'`;
    super(message);
  }
}

/**
 * Thrown when setting a primary domain fails.
 * 
 * @example
 * ```typescript
 * throw new SetPrimaryDomainError('service-123', 'mapping-456');
 * // Error message: "[SetPrimaryDomainError] Failed to set mapping 'mapping-456' as primary for service 'service-123'"
 * ```
 */
export class SetPrimaryDomainError extends DomainError {
  constructor(serviceId: string, mappingId: string, reason?: string) {
    const message = reason
      ? `Failed to set mapping '${mappingId}' as primary for service '${serviceId}': ${reason}`
      : `Failed to set mapping '${mappingId}' as primary for service '${serviceId}'`;
    super(message);
  }
}
