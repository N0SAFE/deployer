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

export function useServiceList(
  input: Parameters<typeof serviceEndpoints.crud.list.call>[0],
) {
  return useQuery(serviceEndpoints.crud.list.queryOptions({ input }))
}

export function useService(serviceId: string) {
  return useQuery(
    serviceEndpoints.crud.findById.queryOptions({ input: { params: { id: serviceId }, id: serviceId } }),
  )
}

export function useServiceDependencies(serviceId: string) {
  return useQuery(
    serviceEndpoints.dependencies.list.queryOptions({ input: { params: { id: serviceId }, id: serviceId } }),
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
