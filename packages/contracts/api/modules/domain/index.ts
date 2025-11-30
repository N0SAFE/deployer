import { oc } from '@orpc/contract';

/**
 * Domain Management Contract - Multi-Level Domain Hierarchy
 *
 * **PURPOSE**: Complete three-level domain management system with DNS verification
 *
 * **SCOPE**: This contract provides comprehensive domain functionality including:
 * - Organization-level domain registry with DNS verification (TXT/CNAME records)
 * - Project-level domain selection with subdomain allocation
 * - Service-level domain mapping with subdomain and base path configuration
 * - Conflict detection and resolution for URL paths
 * - Auto-verification system for pending domains
 *
 * **DOMAIN HIERARCHY**:
 * ```
 * Organization (owns domains)
 *   └─> Domains (verified via DNS)
 *       └─> Projects (select domains)
 *           └─> Services (map to URLs)
 *               └─> URLs: {subdomain}.{domain}{basePath}
 * ```
 *
 * **FRONTEND INTEGRATION**: ✅ Core platform functionality
 * - Organization settings: Domain management and verification UI
 * - Project settings: Domain selection interface
 * - Service settings: Domain mapping with conflict warnings
 * - Dashboard: Domain overview and verification status
 *
 * **CONTRACT ORGANIZATION**:
 * - **Organization Domains**: Domain ownership and DNS verification
 * - **Project Domains**: Domain selection and subdomain allocation
 * - **Service Mappings**: URL configuration with conflict detection
 *
 * **RELATIONSHIP TO OTHER CONTRACTS**:
 * - **`project`**: Projects use domains from their organization
 * - **`service`**: Services map to project domains
 * - **`traefik`**: Domain mappings sync to Traefik routing configuration
 * - **`deployment`**: Deployments use service domain mappings for routing
 *
 * Routes: /domains/*, /organizations/:id/domains/*, /projects/:id/domains/*, /services/:id/domains/*
 * Status: 🟢 Production Ready - Feature-complete domain system
 * Frontend Usage: ✅ Primary domain management interface
 * Complexity: High - Multi-level hierarchy with DNS verification and conflict detection
 *
 * @example
 * // 1. Add domain to organization
 * const { organizationDomain, verificationInstructions } = await orpc.domain.addOrganizationDomain({
 *   organizationId: "org-123",
 *   domain: "example.com",
 *   verificationMethod: "txt_record"
 * });
 * // Follow verification instructions to add TXT record to DNS
 *
 * // 2. Verify domain ownership
 * const result = await orpc.domain.verifyOrganizationDomain({
 *   organizationId: "org-123",
 *   domainId: organizationDomain.id
 * });
 *
 * // 3. Add domain to project
 * const { projectDomain } = await orpc.domain.addProjectDomain({
 *   projectId: "proj-123",
 *   organizationDomainId: organizationDomain.id,
 *   allowedSubdomains: ["api", "web", "admin", "*"], // "*" = any subdomain
 *   isPrimary: true
 * });
 *
 * // 4. Map service to domain with conflict detection
 * const { mapping, warning } = await orpc.domain.addServiceDomain({
 *   serviceId: "svc-123",
 *   projectDomainId: projectDomain.id,
 *   subdomain: "api",
 *   basePath: "/v1", // Optional: for sharing subdomains
 *   isPrimary: true,
 *   sslEnabled: true
 * });
 * // Result: https://api.example.com/v1
 *
 * @see ../../MULTI-LEVEL-DOMAIN-MANAGEMENT-SPECIFICATION.md for complete specification
 * @see ../traefik/index.ts for routing configuration
 * @see ../service/index.ts for service management
 */

// Import all contract definitions
import {
  listOrganizationDomainsContract,
  addOrganizationDomainContract,
  getOrganizationDomainContract,
  verifyOrganizationDomainContract,
  deleteOrganizationDomainContract,
} from './organization-domains';

import {
  listProjectDomainsContract,
  getAvailableDomainsContract,
  getAvailableDomainsForServiceContract,
  addProjectDomainContract,
  updateProjectDomainContract,
  removeProjectDomainContract,
} from './project-domains';

import {
  checkSubdomainAvailabilityContract,
  listServiceDomainsContract,
  addServiceDomainContract,
  updateServiceDomainContract,
  setPrimaryServiceDomainContract,
  removeServiceDomainContract,
} from './service-domains';

// Combine into main domain contract
export const domainContract = oc.tag("Domain").prefix("/domains").router({
  // Organization domain management
  listOrganizationDomains: listOrganizationDomainsContract,
  addOrganizationDomain: addOrganizationDomainContract,
  getOrganizationDomain: getOrganizationDomainContract,
  verifyOrganizationDomain: verifyOrganizationDomainContract,
  deleteOrganizationDomain: deleteOrganizationDomainContract,

  // Project domain management
  listProjectDomains: listProjectDomainsContract,
  getAvailableDomains: getAvailableDomainsContract,
  getAvailableDomainsForService: getAvailableDomainsForServiceContract,
  addProjectDomain: addProjectDomainContract,
  updateProjectDomain: updateProjectDomainContract,
  removeProjectDomain: removeProjectDomainContract,

  // Service domain mappings
  checkSubdomainAvailability: checkSubdomainAvailabilityContract,
  listServiceDomains: listServiceDomainsContract,
  addServiceDomain: addServiceDomainContract,
  updateServiceDomain: updateServiceDomainContract,
  setPrimaryServiceDomain: setPrimaryServiceDomainContract,
  removeServiceDomain: removeServiceDomainContract,
});

export type DomainContract = typeof domainContract;

// Re-export everything from individual contracts
export * from './schemas';
export * from './organization-domains';
export * from './project-domains';
export * from './service-domains';
