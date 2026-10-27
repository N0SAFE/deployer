import { DomainError } from './domain-error';

/**
 * Thrown when a project domain is not found.
 * 
 * @example
 * ```typescript
 * throw new ProjectDomainNotFoundError('pdomain-123');
 * // Error message: "[ProjectDomainNotFoundError] Project domain with ID 'pdomain-123' not found"
 * ```
 */
export class ProjectDomainNotFoundError extends DomainError {
  constructor(identifier: string) {
    super(`Project domain with ID '${identifier}' not found`);
  }
}

/**
 * Thrown when a project already has a specific domain assigned.
 * 
 * @example
 * ```typescript
 * throw new ProjectDomainAlreadyExistsError('project-123', 'example.com');
 * // Error message: "[ProjectDomainAlreadyExistsError] Project 'project-123' already uses domain 'example.com'"
 * ```
 */
export class ProjectDomainAlreadyExistsError extends DomainError {
  constructor(projectId: string, domain: string) {
    super(`Project '${projectId}' already uses domain '${domain}'`);
  }
}

/**
 * Thrown when project domain update fails.
 * 
 * @example
 * ```typescript
 * throw new ProjectDomainUpdateError('pdomain-123');
 * // Error message: "[ProjectDomainUpdateError] Failed to update project domain with ID 'pdomain-123'"
 * 
 * throw new ProjectDomainUpdateError('pdomain-123', 'Invalid subdomain configuration');
 * // Error message: "[ProjectDomainUpdateError] Failed to update project domain with ID 'pdomain-123': Invalid subdomain configuration"
 * ```
 */
export class ProjectDomainUpdateError extends DomainError {
  constructor(domainId: string, reason?: string) {
    const message = reason
      ? `Failed to update project domain with ID '${domainId}': ${reason}`
      : `Failed to update project domain with ID '${domainId}'`;
    super(message);
  }
}

/**
 * Thrown when project domain deletion fails.
 * 
 * @example
 * ```typescript
 * throw new ProjectDomainDeletionError('pdomain-123');
 * // Error message: "[ProjectDomainDeletionError] Failed to delete project domain with ID 'pdomain-123'"
 * 
 * throw new ProjectDomainDeletionError('pdomain-123', 'Domain has active service mappings');
 * // Error message: "[ProjectDomainDeletionError] Failed to delete project domain with ID 'pdomain-123': Domain has active service mappings"
 * ```
 */
export class ProjectDomainDeletionError extends DomainError {
  constructor(domainId: string, reason?: string) {
    const message = reason
      ? `Failed to delete project domain with ID '${domainId}': ${reason}`
      : `Failed to delete project domain with ID '${domainId}'`;
    super(message);
  }
}
