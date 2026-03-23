/**
 * Domain Conflict Resolution Interfaces
 *
 * Types for subdomain/path conflict detection and resolution.
 * Used when mapping services to URLs to prevent collisions.
 *
 * @module domain/interfaces/conflict
 */

// ============================================================================
// CONFLICT DETECTION
// ============================================================================

/**
 * Information about a conflicting service URL mapping
 */
export interface SubdomainConflict {
  /** ID of the service that has the conflicting mapping */
  serviceId: string;
  /** Name of the conflicting service */
  serviceName: string;
  /** Subdomain used by the conflicting service (null for root domain) */
  subdomain: string | null;
  /** Base path used by the conflicting service (null for root path) */
  basePath: string | null;
  /** Full URL representation of the conflict */
  fullUrl: string;
}

// ============================================================================
// AVAILABILITY RESULTS
// ============================================================================

/**
 * Result of checking subdomain availability
 */
export interface SubdomainAvailabilityResult {
  /** Whether the subdomain+path combination is available */
  available: boolean;
  /** List of existing mappings that may conflict */
  conflicts: SubdomainConflict[];
  /** Suggestions for resolving conflicts */
  suggestions: {
    /** Available base paths that can be used instead */
    availableBasePaths: string[];
    /** Human-readable suggestion message */
    message: string;
  };
}

// ============================================================================
// VALIDATION RESULTS
// ============================================================================

/**
 * Result of subdomain format validation
 */
export interface SubdomainValidationResult {
  /** Whether the subdomain format is valid */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
}

/**
 * Result of base path format validation
 */
export interface BasePathValidationResult {
  /** Whether the base path format is valid */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
}
