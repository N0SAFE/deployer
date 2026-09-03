import { oc } from '@orpc/contract';

/**
 * Domain management contract.
 *
 * Domains belong DIRECTLY to a project (the mesh is the single tenant — there
 * is no organization layer). A verified project domain becomes available for
 * the project's services via subdomain mappings.
 *
 * Usage:
 * ```ts
 * // 1. Add a domain to a project (triggers verification)
 * const { projectDomain, verificationInstructions } = await orpc.domain.addProjectDomain({
 *   projectId: "proj-123",
 *   domain: "example.com",
 * })
 * // 2. Verify the TXT record...
 * await orpc.domain.verifyProjectDomain({ projectId, domainId })
 * // 3. Map a service to a subdomain of the verified domain
 * await orpc.domain.addServiceDomain({ serviceId, projectDomainId, subdomain: "api" })
 * ```
 *
 * Layers:
 * - **`project`**: project-owned domains + verification
 * - **`service`**: subdomain mappings from a service to a project domain
 *
 * @see ../../MULTI-LEVEL-DOMAIN-MANAGEMENT-SPECIFICATION.md for complete specification
 * @see ../traefik/index.ts for routing configuration
 * @see ../service/index.ts for service management
 */

// Import all contract definitions
import {
    listProjectDomainsContract,
    getAvailableDomainsContract,
    getAvailableDomainsForServiceContract,
    addProjectDomainContract,
    updateProjectDomainContract,
    removeProjectDomainContract,
    verifyProjectDomainContract,
} from "./project";

import {
    checkSubdomainAvailabilityContract,
    listServiceDomainsContract,
    addServiceDomainContract,
    updateServiceDomainContract,
    setPrimaryServiceDomainContract,
    removeServiceDomainContract,
} from "./service";

// Combine into main domain contract
export const domainContract = oc.tag("Domain").prefix("/domains").router({
  // Project domain management
  listProjectDomains: listProjectDomainsContract,
  getAvailableDomains: getAvailableDomainsContract,
  getAvailableDomainsForService: getAvailableDomainsForServiceContract,
  addProjectDomain: addProjectDomainContract,
  updateProjectDomain: updateProjectDomainContract,
  removeProjectDomain: removeProjectDomainContract,
  verifyProjectDomain: verifyProjectDomainContract,

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
export * from "./project";
export * from "./service";
