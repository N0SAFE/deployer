"use client";

/**
 * Service Domain - Client Hooks
 *
 * React hooks for service management with automatic cache invalidation.
 */

import { useQuery, useMutation } from '@tanstack/react-query'
import { serviceEndpoints } from './endpoints'
import { serviceInvalidations } from './invalidations'
import { wrapWithInvalidations } from '../shared/helpers'

const enhancedService = wrapWithInvalidations(serviceEndpoints, serviceInvalidations)

// ============================================================================
// QUERY HOOKS
// ============================================================================

export function useServiceList(
  input: Parameters<typeof serviceEndpoints.list.call>[0],
) {
  return useQuery(serviceEndpoints.list.queryOptions({ input }))
}

export function useService(serviceId: string) {
  return useQuery(
    serviceEndpoints.findById.queryOptions({ input: { params: { id: serviceId }, id: serviceId } }),
  )
}

export function useServiceDependencies(serviceId: string) {
  return useQuery(
    serviceEndpoints.getDependencies.queryOptions({ input: { params: { id: serviceId }, id: serviceId } }),
  )
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useCreateService() {
  return useMutation(
    serviceEndpoints.create.mutationOptions({
      onSuccess: enhancedService.create.withInvalidationOnSuccess(),
    }),
  )
}

export function useUpdateService() {
  return useMutation(
    serviceEndpoints.update.mutationOptions({
      onSuccess: enhancedService.update.withInvalidationOnSuccess(),
    }),
  )
}

export function useDeleteService() {
  return useMutation(
    serviceEndpoints.delete.mutationOptions({
      onSuccess: enhancedService.delete.withInvalidationOnSuccess(),
    }),
  )
}

export function useToggleServiceActive() {
  return useMutation(
    serviceEndpoints.toggleActive.mutationOptions({
      onSuccess: enhancedService.toggleActive.withInvalidationOnSuccess(),
    }),
  )
}

export function useAddServiceDependency() {
  return useMutation(
    serviceEndpoints.addDependency.mutationOptions({
      onSuccess: enhancedService.addDependency.withInvalidationOnSuccess(),
    }),
  )
}

export function useRemoveServiceDependency() {
  return useMutation(
    serviceEndpoints.removeDependency.mutationOptions({
      onSuccess: enhancedService.removeDependency.withInvalidationOnSuccess(),
    }),
  )
}
