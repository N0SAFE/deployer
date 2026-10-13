/**
 * Domain Module Error Classes
 * 
 * This module provides structured, domain-specific error classes for the domain
 * management system. All errors follow the `[ErrorClass.name] message` convention.
 * 
 * ## Error Hierarchy
 * 
 * ```
 * DomainError (base)
 * ├── DomainAlreadyExistsError
 * ├── DomainAlreadyExistsError
 * ├── InvalidDomainFormatError
 * ├── DomainNotVerifiedError
 * ├── DomainDeletionError
 * ├── GranularityViolationError
 * ├── DomainVerificationError (base for verification errors)
 * │   ├── DnsLookupError
 * │   ├── VerificationTokenMismatchError
 * │   ├── VerificationRecordNotFoundError
 * │   └── VerificationAttemptError
 * ├── ProjectDomainNotFoundError
 * ├── ProjectDomainAlreadyExistsError
 * ├── ProjectDomainUpdateError
 * ├── ProjectDomainDeletionError
 * ├── ServiceDomainMappingNotFoundError
 * ├── ServiceMappingMismatchError
 * ├── SubdomainConflictError
 * ├── SubdomainNotAllowedError
 * ├── InvalidSubdomainFormatError
 * ├── InvalidBasePathFormatError
 * ├── ServiceDomainMappingUpdateError
 * ├── ServiceDomainMappingDeletionError
 * └── SetPrimaryDomainError
 * ```
 * 
 * ## Usage Example
 * 
 * ```typescript
 * import { 
 *   ProjectDomainNotFoundError, 
 *   DomainAlreadyExistsError 
 * } from '@/core/modules/domain/errors';
 * 
 * // In a controller or service
 * const domain = await repository.findById(id);
 * if (!domain) {
 *   throw new ProjectDomainNotFoundError(id);
 * }
 * 
 * // Check for duplicates
 * const existing = await repository.findByDomain(input.domain);
 * if (existing) {
 *   throw new DomainAlreadyExistsError(input.domain);
 * }
 * ```
 * 
 * @module domain/errors
 */

// Base error
export { DomainError } from '@/core/modules/domain/errors/domain-error';

// Domain errors (project-owned, mesh-wide tenant)
export {
  DomainAlreadyExistsError,
  DomainNotVerifiedError,
} from '@/core/modules/domain/errors/domain-errors';

// Verification errors
export {
  DomainVerificationError,
  DnsLookupError,
  VerificationTokenMismatchError,
  VerificationRecordNotFoundError,
  VerificationAttemptError,
} from '@/core/modules/domain/errors/verification-errors';

// Project domain errors
export {
  ProjectDomainNotFoundError,
  ProjectDomainAlreadyExistsError,
  ProjectDomainUpdateError,
  ProjectDomainDeletionError,
} from '@/core/modules/domain/errors/project-domain-errors';

// Service domain mapping errors
export {
  ServiceDomainMappingNotFoundError,
  ServiceMappingMismatchError,
  SubdomainConflictError,
  SubdomainNotAllowedError,
  InvalidSubdomainFormatError,
  InvalidBasePathFormatError,
  ServiceDomainMappingUpdateError,
  ServiceDomainMappingDeletionError,
  SetPrimaryDomainError,
} from '@/core/modules/domain/errors/service-domain-mapping-errors';
