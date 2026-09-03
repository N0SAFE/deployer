import { DomainError } from './domain-error';

/**
 * Thrown when a project already owns a domain with the same name.
 *
 * @example
 * ```typescript
 * throw new DomainAlreadyExistsError('project-123', 'example.com');
 * ```
 */
export class DomainAlreadyExistsError extends DomainError {
  constructor(projectId: string, domain: string) {
    super(`Project '${projectId}' already owns domain '${domain}'`);
  }
}

/**
 * Thrown when an operation requires a verified domain.
 */
export class DomainNotVerifiedError extends DomainError {
  constructor(domain: string) {
    super(`Domain '${domain}' is not verified`);
  }
}