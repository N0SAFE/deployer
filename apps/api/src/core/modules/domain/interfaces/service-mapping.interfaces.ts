/**
 * Service Domain Mapping Interfaces
 *
 * Types for mapping services to domains with subdomain and path routing.
 * Supports computed URLs and SSL configuration.
 *
 * @module domain/interfaces/service-mapping
 */

import type { serviceDomainMappings } from '@/config/drizzle/global/schema';

// ============================================================================
// DATABASE TYPES (re-exports for convenience)
// ============================================================================

/**
 * Service domain mapping entity from database
 */
export type ServiceDomainMapping = typeof serviceDomainMappings.$inferSelect;

/**
 * Input type for creating a service domain mapping
 */
export type InsertServiceDomainMapping = typeof serviceDomainMappings.$inferInsert;

// ============================================================================
// EXTENDED TYPES
// ============================================================================

/**
 * Service domain mapping with computed URLs
 */
export interface ServiceDomainMappingWithUrls extends ServiceDomainMapping {
  /** Full external URL (e.g., `https://api.example.com/v1`) */
  fullUrl: string;
  /** Internal URL for container-to-container communication (optional) */
  internalUrl?: string;
}

// ============================================================================
// SSL CONFIGURATION
// ============================================================================

/**
 * SSL provider types for domain mappings
 */
export type SSLProvider = 'letsencrypt' | 'custom' | 'none';

/**
 * SSL configuration for a domain mapping
 */
export interface SSLConfig {
  /** Whether SSL is enabled */
  enabled: boolean;
  /** SSL certificate provider */
  provider: SSLProvider;
  /** Custom certificate data (only for 'custom' provider) */
  customCert?: {
    /** PEM-encoded certificate */
    certificate: string;
    /** PEM-encoded private key */
    privateKey: string;
  };
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query result for service mappings with service names
 */
export interface ServiceMappingWithServiceName {
  /** Service ID */
  serviceId: string;
  /** Service name for display */
  serviceName: string;
  /** Subdomain (null for root) */
  subdomain: string | null;
  /** Base path (null for root) */
  basePath: string | null;
}
