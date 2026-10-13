/**
 * Domain Module Interfaces Barrel Export
 *
 * Central export point for all Domain module interfaces and types.
 * Import from here to avoid circular dependencies and ensure consistency.
 *
 * @module domain/interfaces
 */

// ============================================================================
// VERIFICATION TYPES
// ============================================================================
export type {
  VerificationMethod,
  VerificationInstructions,
  VerifyDomainResult,
} from '@/core/modules/domain/interfaces/verification.interfaces';

// ============================================================================
// CONFLICT RESOLUTION TYPES
// ============================================================================
export type {
  SubdomainConflict,
  SubdomainAvailabilityResult,
  SubdomainValidationResult,
  BasePathValidationResult,
} from '@/core/modules/domain/interfaces/conflict.interfaces';

// ============================================================================
// SERVICE MAPPING TYPES
// ============================================================================
export type {
  ServiceDomainMapping,
  InsertServiceDomainMapping,
  ServiceDomainMappingWithUrls,
  SSLProvider,
  SSLConfig,
  ServiceMappingWithServiceName,
} from '@/core/modules/domain/interfaces/service-mapping.interfaces';

// ============================================================================
// PROJECT DOMAIN TYPES
// ============================================================================
export type {
  ProjectDomain,
  InsertProjectDomain,
  AssignDomainInput,
  AssignDomainResponse,
  AvailableDomain,
  GranularityCheckResult,
} from '@/core/modules/domain/interfaces/project-domain.interfaces';
