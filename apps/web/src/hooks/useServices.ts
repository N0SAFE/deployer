'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import type { z } from 'zod'
import type {
  serviceSchema,
  serviceWithStatsSchema,
  createServiceSchema,
  updateServiceSchema,
  getProjectDependencyGraphOutput,
} from '@repo/api-contracts/modules/service'

/**
 * Service hooks following ORPC Client Hooks Pattern
 *
 * These hooks provide type-safe access to service operations
 * using the centralized oRPC client.
 *
 * @see .docs/core-concepts/11-ORPC-CLIENT-HOOKS-PATTERN.md
 */

// Types
export type Service = z.infer<typeof serviceSchema>
export type ServiceWithStats = z.infer<typeof serviceWithStatsSchema>
export type CreateServiceInput = z.infer<typeof createServiceSchema>
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>
export type DependencyGraph = z.infer<typeof getProjectDependencyGraphOutput>

// Query keys for cache management
export const serviceKeys = {
  all: ['services'] as const,
  lists: () => [...serviceKeys.all, 'list'] as const,
  byProject: (projectId: string) => [...serviceKeys.lists(), { projectId }] as const,
  details: () => [...serviceKeys.all, 'detail'] as const,
  detail: (serviceId: string) => [...serviceKeys.details(), serviceId] as const,
  deployments: (serviceId: string) => [...serviceKeys.detail(serviceId), 'deployments'] as const,
  dependencies: (serviceId: string) => [...serviceKeys.detail(serviceId), 'dependencies'] as const,
  logs: (serviceId: string) => [...serviceKeys.detail(serviceId), 'logs'] as const,
  metrics: (serviceId: string) => [...serviceKeys.detail(serviceId), 'metrics'] as const,
  health: (serviceId: string) => [...serviceKeys.detail(serviceId), 'health'] as const,
  dependencyGraph: (projectId: string) => [...serviceKeys.all, 'graph', projectId] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Hook to fetch services by project
 */
export function useServices(projectId: string, options?: { enabled?: boolean }) {
  return useQuery(
    orpc.service.listByProject.queryOptions({
      input: { projectId },
      context: undefined,
      enabled: (options?.enabled ?? true) && !!projectId,
      staleTime: 1000 * 60, // 1 minute
      gcTime: 1000 * 60 * 5, // 5 minutes
    })
  )
}

/**
 * Hook to fetch a single service by ID
 */
export function useService(serviceId: string, options?: { enabled?: boolean }) {
  return useQuery(
    orpc.service.getById.queryOptions({
      input: { id: serviceId },
      context: undefined,
      enabled: (options?.enabled ?? true) && !!serviceId,
      staleTime: 1000 * 60, // 1 minute
      gcTime: 1000 * 60 * 5, // 5 minutes
    })
  )
}

/**
 * Hook to fetch service deployments
 */
export function useServiceDeployments(
  serviceId: string,
  options?: {
    limit?: number
    offset?: number
    status?: 'pending' | 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled'
    environment?: 'production' | 'staging' | 'preview' | 'development'
    enabled?: boolean
  }
) {
  return useQuery(
    orpc.service.getDeployments.queryOptions({
      input: {
        id: serviceId,
        limit: options?.limit ?? 10,
        offset: options?.offset ?? 0,
        status: options?.status,
        environment: options?.environment,
      },
      context: undefined,
      enabled: (options?.enabled ?? true) && !!serviceId,
      staleTime: 1000 * 30, // 30 seconds
      gcTime: 1000 * 60 * 2, // 2 minutes
    })
  )
}

/**
 * Hook to fetch service dependencies
 */
export function useServiceDependencies(serviceId: string, options?: { enabled?: boolean }) {
  return useQuery(
    orpc.service.getDependencies.queryOptions({
      input: { id: serviceId },
      context: undefined,
      enabled: (options?.enabled ?? true) && !!serviceId,
      staleTime: 1000 * 60 * 2, // 2 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes
    })
  )
}

/**
 * Hook to fetch service logs
 */
export function useServiceLogs(
  serviceId: string,
  options?: {
    limit?: number
    offset?: number
    level?: 'info' | 'warn' | 'error' | 'debug'
    since?: Date
    until?: Date
    enabled?: boolean
  }
) {
  return useQuery(
    orpc.service.getLogs.queryOptions({
      input: {
        id: serviceId,
        limit: options?.limit ?? 100,
        offset: options?.offset ?? 0,
        level: options?.level,
        since: options?.since,
        until: options?.until,
      },
      context: undefined,
      enabled: (options?.enabled ?? true) && !!serviceId,
      staleTime: 1000 * 10, // 10 seconds
      gcTime: 1000 * 60, // 1 minute
    })
  )
}

/**
 * Hook to fetch service metrics
 */
export function useServiceMetrics(
  serviceId: string,
  options?: {
    period?: '5m' | '1h' | '24h' | '7d'
    granularity?: '1m' | '5m' | '1h'
    enabled?: boolean
  }
) {
  return useQuery(
    orpc.service.getMetrics.queryOptions({
      input: {
        id: serviceId,
        period: options?.period ?? '1h',
        granularity: options?.granularity ?? '5m',
      },
      context: undefined,
      enabled: (options?.enabled ?? true) && !!serviceId,
      staleTime: 1000 * 30, // 30 seconds
      gcTime: 1000 * 60 * 2, // 2 minutes
    })
  )
}

/**
 * Hook to fetch service health
 */
export function useServiceHealth(serviceId: string, options?: { enabled?: boolean }) {
  return useQuery(
    orpc.service.getHealth.queryOptions({
      input: { id: serviceId },
      context: undefined,
      enabled: (options?.enabled ?? true) && !!serviceId,
      staleTime: 1000 * 15, // 15 seconds
      gcTime: 1000 * 60, // 1 minute
    })
  )
}

/**
 * Hook to fetch project dependency graph
 */
export function useProjectDependencyGraph(projectId: string, options?: { enabled?: boolean }) {
  return useQuery(
    orpc.service.getProjectDependencyGraph.queryOptions({
      input: { projectId },
      context: undefined,
      enabled: (options?.enabled ?? true) && !!projectId,
      staleTime: 1000 * 60, // 1 minute
      gcTime: 1000 * 60 * 5, // 5 minutes
    })
  )
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to create a new service
 */
export function useCreateService() {
  const queryClient = useQueryClient()

  return useMutation(
    orpc.service.create.mutationOptions({
      onSuccess: (_, variables) => {
        // Invalidate service lists
        void queryClient.invalidateQueries({ queryKey: serviceKeys.lists() })
        void queryClient.invalidateQueries({
          queryKey: serviceKeys.byProject(variables.projectId),
        })
        // Invalidate dependency graph
        void queryClient.invalidateQueries({
          queryKey: serviceKeys.dependencyGraph(variables.projectId),
        })
      },
    })
  )
}

/**
 * Hook to update a service
 */
export function useUpdateService() {
  const queryClient = useQueryClient()

  return useMutation(
    orpc.service.update.mutationOptions({
      onSuccess: (data, variables) => {
        // Invalidate service detail
        void queryClient.invalidateQueries({
          queryKey: serviceKeys.detail(variables.id),
        })
        // Invalidate service lists
        void queryClient.invalidateQueries({ queryKey: serviceKeys.lists() })
      },
    })
  )
}

/**
 * Hook to delete a service
 */
export function useDeleteService() {
  const queryClient = useQueryClient()

  return useMutation(
    orpc.service.delete.mutationOptions({
      onSuccess: (_, variables) => {
        // Remove from cache
        queryClient.removeQueries({
          queryKey: serviceKeys.detail(variables.id),
        })
        // Invalidate lists
        void queryClient.invalidateQueries({ queryKey: serviceKeys.lists() })
      },
    })
  )
}

/**
 * Hook to toggle service active state
 */
export function useToggleServiceActive() {
  const queryClient = useQueryClient()

  return useMutation(
    orpc.service.toggleActive.mutationOptions({
      onSuccess: (_, variables) => {
        void queryClient.invalidateQueries({
          queryKey: serviceKeys.detail(variables.id),
        })
        void queryClient.invalidateQueries({ queryKey: serviceKeys.lists() })
      },
    })
  )
}

/**
 * Hook to add a service dependency
 */
export function useAddServiceDependency() {
  const queryClient = useQueryClient()

  return useMutation(
    orpc.service.addDependency.mutationOptions({
      onSuccess: (_, variables) => {
        void queryClient.invalidateQueries({
          queryKey: serviceKeys.dependencies(variables.serviceId),
        })
        void queryClient.invalidateQueries({ queryKey: serviceKeys.all })
      },
    })
  )
}

/**
 * Hook to remove a service dependency
 */
export function useRemoveServiceDependency() {
  const queryClient = useQueryClient()

  return useMutation(
    orpc.service.removeDependency.mutationOptions({
      onSuccess: (_, variables) => {
        void queryClient.invalidateQueries({
          queryKey: serviceKeys.dependencies(variables.serviceId),
        })
        void queryClient.invalidateQueries({ queryKey: serviceKeys.all })
      },
    })
  )
}

// ============================================================================
// Async Functions (for server components or direct use)
// ============================================================================

/**
 * Get services by project
 */
export async function getServices(projectId: string) {
  return orpc.service.listByProject.call({ projectId })
}

/**
 * Get service by ID
 */
export async function getService(serviceId: string) {
  return orpc.service.getById.call({ id: serviceId })
}

/**
 * Get project dependency graph
 */
export async function getProjectDependencyGraph(projectId: string) {
  return orpc.service.getProjectDependencyGraph.call({ projectId })
}

// ============================================================================
// Composite Utility Hooks
// ============================================================================

/**
 * Hook that provides all service actions for convenience
 */
export function useServiceActions() {
  const createService = useCreateService()
  const updateService = useUpdateService()
  const deleteService = useDeleteService()
  const toggleActive = useToggleServiceActive()
  const addDependency = useAddServiceDependency()
  const removeDependency = useRemoveServiceDependency()

  return {
    // Mutations
    createService: createService.mutate,
    createServiceAsync: createService.mutateAsync,
    updateService: updateService.mutate,
    updateServiceAsync: updateService.mutateAsync,
    deleteService: deleteService.mutate,
    deleteServiceAsync: deleteService.mutateAsync,
    toggleActive: toggleActive.mutate,
    toggleActiveAsync: toggleActive.mutateAsync,
    addDependency: addDependency.mutate,
    addDependencyAsync: addDependency.mutateAsync,
    removeDependency: removeDependency.mutate,
    removeDependencyAsync: removeDependency.mutateAsync,

    // Loading states
    isLoading: {
      create: createService.isPending,
      update: updateService.isPending,
      delete: deleteService.isPending,
      toggle: toggleActive.isPending,
      addDep: addDependency.isPending,
      removeDep: removeDependency.isPending,
    },

    // Error states
    errors: {
      create: createService.error,
      update: updateService.error,
      delete: deleteService.error,
      toggle: toggleActive.error,
      addDep: addDependency.error,
      removeDep: removeDependency.error,
    },
  }
}

/**
 * Hook that provides service administration capabilities
 */
export function useServiceAdministration(projectId: string) {
  const services = useServices(projectId)
  const dependencyGraph = useProjectDependencyGraph(projectId)
  const serviceActions = useServiceActions()

  return {
    // Query data
    services: services.data ?? [],
    graph: dependencyGraph.data ?? { nodes: [], edges: [], project: { id: '', name: '', baseDomain: null } },

    // Loading states
    isLoading: services.isLoading || dependencyGraph.isLoading,
    isRefreshing: services.isFetching,

    // Error states
    error: services.error ?? dependencyGraph.error,

    // Actions
    ...serviceActions,

    // Refresh function
    refresh: () => {
      void services.refetch()
      void dependencyGraph.refetch()
    },
  }
}
