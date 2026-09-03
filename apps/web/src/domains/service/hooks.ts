"use client";

/**
 * Service Domain - Client Hooks
 *
 * React hooks for service management with automatic cache invalidation.
 */

import { useQuery, useMutation } from '@tanstack/react-query'
import { serviceEndpointOperations, serviceEndpoints } from './endpoints'
import { serviceInvalidations } from './invalidations'
import { wrapWithInvalidations } from '../shared/helpers'

const enhancedService = wrapWithInvalidations(serviceEndpointOperations, serviceInvalidations)

// ============================================================================
// QUERY HOOKS
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** A service id is only fetchable when it's a real UUID (never a `:id` template placeholder). */
function isServiceIdUsable(serviceId: string | undefined | null): serviceId is string {
  return typeof serviceId === 'string' && UUID_RE.test(serviceId)
}

export function useServiceList(
  input: Parameters<typeof serviceEndpoints.crud.list.call>[0],
) {
  return useQuery(serviceEndpoints.crud.list.queryOptions({ input }))
}

export function useService(serviceId: string) {
  return useQuery({
    ...serviceEndpoints.crud.findById.queryOptions({ input: { params: { id: serviceId } } }),
    enabled: isServiceIdUsable(serviceId),
  })
}

export function useServiceDependencies(serviceId: string) {
  return useQuery({
    ...serviceEndpoints.dependencies.list.queryOptions({ input: { params: { id: serviceId } } }),
    enabled: isServiceIdUsable(serviceId),
  })
}

/** Direct children (sub-services) of a service. */
export function useServiceChildren(serviceId: string) {
  return useQuery({
    ...serviceEndpoints.crud.children.queryOptions({ input: { params: { id: serviceId } } }),
    enabled: isServiceIdUsable(serviceId),
  })
}

/** Whole descendant subtree of a service (nested tree read-model). */
export function useServiceSubtree(serviceId: string) {
  return useQuery({
    ...serviceEndpoints.crud.subtree.queryOptions({ input: { params: { id: serviceId } } }),
    enabled: isServiceIdUsable(serviceId),
  })
}

/** Provider-backed network config + resolved zone records for a service. */
export function useServiceNetwork(serviceId: string) {
  return useQuery({
    ...serviceEndpoints.network.get.queryOptions({ input: { params: { id: serviceId } } }),
    enabled: isServiceIdUsable(serviceId),
  })
}

export function useUpdateServiceNetwork() {
  return useMutation(
    serviceEndpoints.network.update.mutationOptions({
      onSuccess: enhancedService.updateNetwork.withInvalidationOnSuccess(),
    }),
  )
}

export function useProvisionServiceDnsRecord() {
  return useMutation(
    serviceEndpoints.network.provisionRecord.mutationOptions({
      onSuccess: enhancedService.provisionRecord.withInvalidationOnSuccess(),
    }),
  )
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useCreateService() {
  return useMutation(
    serviceEndpoints.crud.create.mutationOptions({
      onSuccess: enhancedService.create.withInvalidationOnSuccess(),
    }),
  )
}

export function useUpdateService() {
  return useMutation(
    serviceEndpoints.crud.update.mutationOptions({
      onSuccess: enhancedService.update.withInvalidationOnSuccess(),
    }),
  )
}

export function useDeleteService() {
  return useMutation(
    serviceEndpoints.crud.delete.mutationOptions({
      onSuccess: enhancedService.delete.withInvalidationOnSuccess(),
    }),
  )
}

export function useToggleServiceActive() {
  return useMutation(
    serviceEndpoints.lifecycle.toggleActive.mutationOptions({
      onSuccess: enhancedService.toggleActive.withInvalidationOnSuccess(),
    }),
  )
}

export function useAddServiceDependency() {
  return useMutation(
    serviceEndpoints.dependencies.add.mutationOptions({
      onSuccess: enhancedService.addDependency.withInvalidationOnSuccess(),
    }),
  )
}

export function useRemoveServiceDependency() {
  return useMutation(
    serviceEndpoints.dependencies.remove.mutationOptions({
      onSuccess: enhancedService.removeDependency.withInvalidationOnSuccess(),
    }),
  )
}
