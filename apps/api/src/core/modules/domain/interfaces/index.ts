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
} from './verification.interfaces';

// ============================================================================
// CONFLICT RESOLUTION TYPES
// ============================================================================
export type {
  SubdomainConflict,
  SubdomainAvailabilityResult,
  SubdomainValidationResult,
  BasePathValidationResult,
} from './conflict.interfaces';

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
} from './service-mapping.interfaces';

// ============================================================================
// ORGANIZATION DOMAIN TYPES
// ============================================================================
export type {
  OrganizationDomain,
  InsertOrganizationDomain,
  VerificationStatus,
  VerificationMethodType,
  RegisterDomainInput,
  RegisterDomainResponse,
  ListDomainsOptions,
} from './organization-domain.interfaces';

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
} from './project-domain.interfaces';
