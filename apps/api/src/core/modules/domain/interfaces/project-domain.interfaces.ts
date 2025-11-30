/**
 * Project Domain Interfaces
 *
 * Types for assigning domains to projects with subdomain granularity rules.
 * Projects can only use subdomains at or below their registered domain level.
 *
 * @module domain/interfaces/project-domain
 */

import type { projectDomains } from '@/config/drizzle/schema/domain';

// ============================================================================
// DATABASE TYPES (re-exports for convenience)
// ============================================================================

/**
 * Project domain entity from database
 */
export type ProjectDomain = typeof projectDomains.$inferSelect;

/**
 * Input type for creating a project domain
 */
export type InsertProjectDomain = typeof projectDomains.$inferInsert;

// ============================================================================
// DOMAIN ASSIGNMENT
// ============================================================================

/**
 * Input for assigning a domain to a project
 */
export interface AssignDomainInput {
  /** Project ID to assign the domain to */
  projectId: string;
  /** Organization domain ID (must be verified) */
  organizationDomainId: string;
  /** Allowed subdomain patterns (e.g., ['staging', 'api', '*']) */
  allowedSubdomains?: string[];
}

/**
 * Response after domain assignment
 */
export interface AssignDomainResponse {
  /** Created project domain entity */
  projectDomain: ProjectDomain;
  /** The underlying organization domain */
  organizationDomain: {
    id: string;
    domain: string;
    verificationStatus: string;
  };
}

// ============================================================================
// AVAILABLE DOMAINS
// ============================================================================

/**
 * A verified domain available for project assignment
 */
export interface AvailableDomain {
  /** Organization domain ID */
  organizationDomainId: string;
  /** Domain name */
  domain: string;
  /** Organization ID that owns the domain */
  organizationId: string;
}

// ============================================================================
// GRANULARITY RULES
// ============================================================================

/**
 * Result of checking subdomain granularity
 */
export interface GranularityCheckResult {
  /** Whether the subdomain respects granularity rules */
  allowed: boolean;
  /** Registered domain level */
  registeredDomain: string;
  /** Requested subdomain */
  requestedSubdomain: string;
  /** Error message if not allowed */
  error?: string;
}
