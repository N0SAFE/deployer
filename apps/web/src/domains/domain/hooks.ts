import { useQuery, useMutation } from '@tanstack/react-query'
import { domainEndpoints, domainEndpointOperations } from './endpoints'
import { wrapWithInvalidations } from '../shared/helpers'
import { domainInvalidations } from './invalidations'

const enhancedDomain = wrapWithInvalidations(domainEndpointOperations, domainInvalidations as never)

// ─── Query Hooks ───

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isIdUsable(id: string | undefined | null): id is string {
  return typeof id === 'string' && UUID_RE.test(id)
}

export function useProjectDomains(projectId: string) {
  return useQuery({
    ...domainEndpoints.listProjectDomains.queryOptions({ input: { params: { projectId } } }),
    enabled: isIdUsable(projectId),
  })
}

export function useAvailableDomains(projectId: string) {
  return useQuery({
    ...domainEndpoints.getAvailableDomains.queryOptions({ input: { params: { projectId } } }),
    enabled: isIdUsable(projectId),
  })
}

export function useAvailableDomainsForService(projectId: string, serviceId?: string) {
  return useQuery({
    ...domainEndpoints.getAvailableDomainsForService.queryOptions({ input: { params: { projectId }, query: { serviceId } } }),
    enabled: isIdUsable(projectId) && isIdUsable(serviceId),
  })
}

export function useServiceDomains(serviceId: string) {
  return useQuery({
    ...domainEndpoints.listServiceDomains.queryOptions({ input: { params: { serviceId } } }),
    enabled: isIdUsable(serviceId),
  })
}

/** Check whether a subdomain+basePath is available on a project domain (conflict detection). */
export function useCheckSubdomainAvailability() {
  return useMutation(domainEndpoints.checkSubdomainAvailability.mutationOptions())
}

// ─── Mutation Hooks ───

export function useAddProjectDomain() {
  return useMutation(
    domainEndpoints.addProjectDomain.mutationOptions({
      onSuccess: enhancedDomain.addProjectDomain.withInvalidationOnSuccess(),
    }),
  )
}

export function useRemoveProjectDomain() {
  return useMutation(
    domainEndpoints.removeProjectDomain.mutationOptions({
      onSuccess: enhancedDomain.removeProjectDomain.withInvalidationOnSuccess(),
    }),
  )
}

export function useVerifyProjectDomain() {
  return useMutation(
    domainEndpoints.verifyProjectDomain.mutationOptions({
      onSuccess: enhancedDomain.verifyProjectDomain.withInvalidationOnSuccess(),
    }),
  )
}

export function useAddServiceDomain() {
  return useMutation(
    domainEndpoints.addServiceDomain.mutationOptions({
      onSuccess: enhancedDomain.addServiceDomain.withInvalidationOnSuccess(),
    }),
  )
}

export function useRemoveServiceDomain() {
  return useMutation(
    domainEndpoints.removeServiceDomain.mutationOptions({
      onSuccess: enhancedDomain.removeServiceDomain.withInvalidationOnSuccess(),
    }),
  )
}
