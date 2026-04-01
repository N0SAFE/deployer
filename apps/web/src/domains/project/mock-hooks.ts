/**
 * Mock Project Hooks
 *
 * Drop-in replacements for live project domain hooks using mock data.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMockData } from '@/lib/mock-data-service'

// ============================================================================
// QUERY KEYS
// ============================================================================

const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (filters?: Record<string, any>) =>
    [...projectKeys.lists(), { ...filters }] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
}

// ============================================================================
// QUERY HOOKS
// ============================================================================

export function useProjectList() {
  const mockData = useMockData()

  return useQuery({
    queryKey: projectKeys.lists(),
    queryFn: async () => {
      return mockData.projects.list()
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useProject(projectId: string) {
  const mockData = useMockData()

  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: async () => {
      const project = await mockData.projects.getById(projectId)
      if (!project) {
        throw new Error(`Project ${projectId} not found`)
      }
      return project
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!projectId,
  })
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) => {
      const newProject = {
        id: `proj-${Date.now()}`,
        name: input.name,
        description: input.description || '',
        organizationId: 'org-mock',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      return newProject
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() })
    },
  })
}

export function useUpdateProject(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: Partial<{ name: string; description: string }>) => {
      return input
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() })
    },
  })
}

export function useDeleteProject(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      return { success: true }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() })
      queryClient.removeQueries({ queryKey: projectKeys.detail(projectId) })
    },
  })
}
