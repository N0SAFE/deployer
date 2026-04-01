/**
 * Mock Organization Hooks
 *
 * Drop-in replacements for live organization domain hooks using mock data.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMockData } from '@/lib/mock-data-service'
import type { QueryKey } from '@tanstack/react-query'

// ============================================================================
// QUERY KEYS
// ============================================================================

const organizationKeys = {
  all: ['organizations'] as const,
  lists: () => [...organizationKeys.all, 'list'] as const,
  list: (filters?: Record<string, any>) =>
    [...organizationKeys.lists(), { ...filters }] as const,
  details: () => [...organizationKeys.all, 'detail'] as const,
  detail: (id: string) => [...organizationKeys.details(), id] as const,
  members: (id: string) => [...organizationKeys.detail(id), 'members'] as const,
}

// ============================================================================
// QUERY HOOKS
// ============================================================================

export function useOrganizations() {
  const mockData = useMockData()

  return useQuery({
    queryKey: organizationKeys.lists(),
    queryFn: async () => {
      return mockData.organizations.list()
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}

export function useOrganization(organizationId: string) {
  const mockData = useMockData()

  return useQuery({
    queryKey: organizationKeys.detail(organizationId),
    queryFn: async () => {
      const org = await mockData.organizations.getById(organizationId)
      if (!org) {
        throw new Error(`Organization ${organizationId} not found`)
      }
      return org
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!organizationId,
  })
}

export function useOrganizationMembers(organizationId: string) {
  // Mock data: included in organization object
  return useQuery({
    queryKey: organizationKeys.members(organizationId),
    queryFn: async () => {
      // Mock organizations include members array
      return []
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!organizationId,
  })
}

export function useAllOrganizationPendingInvitations() {
  // Mock data: no pending invitations in mock
  return useQuery({
    queryKey: [...organizationKeys.all, 'pending-invitations'],
    queryFn: async () => {
      return []
    },
  })
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useCreateOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { name: string; description?: string; slug: string }) => {
      // Mock: return new organization
      const newOrg = {
        id: `org-${Date.now()}`,
        name: input.name,
        slug: input.slug,
        description: input.description || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      return newOrg
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
    },
  })
}

export function useUpdateOrganization(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      input: Partial<{ name: string; description: string; slug: string }>,
    ) => {
      // Mock: return updated organization
      return input
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(organizationId) })
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
    },
  })
}

export function useDeleteOrganization(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      // Mock: just return success
      return { success: true }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      queryClient.removeQueries({ queryKey: organizationKeys.detail(organizationId) })
    },
  })
}
