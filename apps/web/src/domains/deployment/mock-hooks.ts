/**
 * Mock Deployment Hooks
 *
 * Drop-in replacements for live deployment domain hooks using mock data.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMockData } from '@/lib/mock-data-service'

// ============================================================================
// QUERY KEYS
// ============================================================================

const deploymentKeys = {
  all: ['deployments'] as const,
  lists: () => [...deploymentKeys.all, 'list'] as const,
  list: (filters?: Record<string, any>) =>
    [...deploymentKeys.lists(), { ...filters }] as const,
  details: () => [...deploymentKeys.all, 'detail'] as const,
  detail: (id: string) => [...deploymentKeys.details(), id] as const,
}

// ============================================================================
// QUERY HOOKS
// ============================================================================

export function useDeploymentList(projectId?: string) {
  const mockData = useMockData()

  return useQuery({
    queryKey: deploymentKeys.list(projectId ? { projectId } : undefined),
    queryFn: async () => {
      return mockData.deployments.list(projectId)
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useDeployment(deploymentId: string) {
  const mockData = useMockData()

  return useQuery({
    queryKey: deploymentKeys.detail(deploymentId),
    queryFn: async () => {
      const deployments = await mockData.deployments.list()
      const deployment = deployments.find((d) => d.id === deploymentId)
      if (!deployment) {
        throw new Error(`Deployment ${deploymentId} not found`)
      }
      return deployment
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!deploymentId,
  })
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useTriggerDeployment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { projectId: string; serviceId: string }) => {
      return {
        id: `deploy-${Date.now()}`,
        projectId: input.projectId,
        serviceId: input.serviceId,
        status: 'in_progress',
        createdAt: new Date().toISOString(),
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deploymentKeys.lists() })
    },
  })
}
