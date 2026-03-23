/**
 * Organization Domain Interfaces
 *
 * Types for organization-level domain registration and verification.
 * Organizations can register root domains or subdomains for multi-org collaboration.
 *
 * @module domain/interfaces/organization-domain
 */

import type {
  organizationDomains,
  verificationStatusEnum,
  verificationMethodEnum,
} from '@/config/drizzle/schema/domain';

// ============================================================================
// DATABASE TYPES (re-exports for convenience)
// ============================================================================

/**
 * Organization domain entity from database
 */
export type OrganizationDomain = typeof organizationDomains.$inferSelect;

/**
 * Input type for creating an organization domain
 */
export type InsertOrganizationDomain = typeof organizationDomains.$inferInsert;

// ============================================================================
// ENUM TYPES
// ============================================================================

/**
 * Verification status values
 */
export type VerificationStatus = (typeof verificationStatusEnum.enumValues)[number];

/**
 * Verification method values
 */
export type VerificationMethodType = (typeof verificationMethodEnum.enumValues)[number];

// ============================================================================
// DOMAIN REGISTRATION
// ============================================================================

/**
 * Input for registering a new organization domain
 */
export interface RegisterDomainInput {
  /** Organization ID that will own the domain */
  organizationId: string;
  /** Domain or subdomain to register (e.g., `example.com` or `api.example.com`) */
  domain: string;
  /** Verification method preference */
  verificationMethod: VerificationMethodType;
}

/**
 * Response after domain registration
 */
export interface RegisterDomainResponse {
  /** Created domain entity */
  domain: OrganizationDomain;
  /** Verification instructions for the user */
  verificationInstructions: {
    method: VerificationMethodType;
    recordName: string;
    recordValue: string;
    instructions: string;
  };
}

// ============================================================================
// DOMAIN QUERIES
// ============================================================================

/**
 * Options for listing organization domains
 */
export interface ListDomainsOptions {
  /** Filter by organization ID */
  organizationId: string;
  /** Filter by verification status */
  status?: VerificationStatus;
  /** Include only domains available for assignment */
  availableOnly?: boolean;
}
