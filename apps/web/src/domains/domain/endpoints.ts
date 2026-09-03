import { orpc } from '@/lib/orpc'

export const domainEndpoints = {
  // Project domain management
  listProjectDomains: orpc.domain.listProjectDomains,
  getAvailableDomains: orpc.domain.getAvailableDomains,
  getAvailableDomainsForService: orpc.domain.getAvailableDomainsForService,
  addProjectDomain: orpc.domain.addProjectDomain,
  updateProjectDomain: orpc.domain.updateProjectDomain,
  removeProjectDomain: orpc.domain.removeProjectDomain,
  verifyProjectDomain: orpc.domain.verifyProjectDomain,

  // Service domain mappings
  checkSubdomainAvailability: orpc.domain.checkSubdomainAvailability,
  listServiceDomains: orpc.domain.listServiceDomains,
  addServiceDomain: orpc.domain.addServiceDomain,
  updateServiceDomain: orpc.domain.updateServiceDomain,
  setPrimaryServiceDomain: orpc.domain.setPrimaryServiceDomain,
  removeServiceDomain: orpc.domain.removeServiceDomain,
}

export const domainEndpointOperations = {
  listProjectDomains: domainEndpoints.listProjectDomains,
  addProjectDomain: domainEndpoints.addProjectDomain,
  removeProjectDomain: domainEndpoints.removeProjectDomain,
  verifyProjectDomain: domainEndpoints.verifyProjectDomain,
  listServiceDomains: domainEndpoints.listServiceDomains,
  addServiceDomain: domainEndpoints.addServiceDomain,
  removeServiceDomain: domainEndpoints.removeServiceDomain,
}
