/**
 * Mock Service Hooks
 *
 * Drop-in replacements for live service domain hooks using mock data.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMockData } from '@/lib/mock-data-service'

// ============================================================================
// QUERY KEYS
// ============================================================================

const serviceKeys = {
  all: ['services'] as const,
  byProject: (projectId: string) => [...serviceKeys.all, 'project', projectId] as const,
  lists: () => [...serviceKeys.all, 'list'] as const,
  list: (projectId: string) => [...serviceKeys.byProject(projectId), 'list'] as const,
  details: () => [...serviceKeys.all, 'detail'] as const,
  detail: (projectId: string, serviceId: string) =>
    [...serviceKeys.details(), projectId, serviceId] as const,
  dependencies: (projectId: string, serviceId: string) =>
    [...serviceKeys.detail(projectId, serviceId), 'dependencies'] as const,
}

// ============================================================================
// QUERY HOOKS
// ============================================================================

export function useServiceList(projectId: string) {
  const mockData = useMockData()

  return useQuery({
    queryKey: serviceKeys.list(projectId),
    queryFn: async () => {
      return mockData.services.list(projectId)
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!projectId,
  })
}

export function useService(projectId: string, serviceId: string) {
  const mockData = useMockData()

  return useQuery({
    queryKey: serviceKeys.detail(projectId, serviceId),
    queryFn: async () => {
      const service = await mockData.services.getById(projectId, serviceId)
      if (!service) {
        throw new Error(`Service ${serviceId} not found`)
      }
      return service
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!projectId && !!serviceId,
  })
}

export function useServiceDependencies(projectId: string, serviceId: string) {
  const mockData = useMockData()

  return useQuery({
    queryKey: serviceKeys.dependencies(projectId, serviceId),
    queryFn: async () => {
      const deps = await mockData.dependencies.getByProject(projectId)
      return deps.filter((d) => d.serviceId === serviceId)
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!projectId && !!serviceId,
  })
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useCreateService(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) => {
      return {
        id: `svc-${Date.now()}`,
        projectId,
        name: input.name,
        description: input.description || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.list(projectId) })
    },
  })
}

export function useUpdateService(projectId: string, serviceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: Partial<{ name: string; description: string }>) => {
      return input
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.detail(projectId, serviceId) })
      queryClient.invalidateQueries({ queryKey: serviceKeys.list(projectId) })
    },
  })
}

export function useDeleteService(projectId: string, serviceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      return { success: true }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.list(projectId) })
      queryClient.removeQueries({ queryKey: serviceKeys.detail(projectId, serviceId) })
    },
  })
}

export function useToggleServiceActive(projectId: string, serviceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (isActive: boolean) => {
      return { success: true, isActive }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.detail(projectId, serviceId) })
    },
  })
}
