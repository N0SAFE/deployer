'use client'

import { authClient } from '@/lib/auth/options'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

/**
 * Organization hooks using Better Auth organization plugin
 *
 * These hooks wrap the Better Auth organization client methods
 * to provide a consistent API for organization management.
 */

// Query keys for cache management
export const organizationKeys = {
  all: ['organizations'] as const,
  lists: () => [...organizationKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) =>
    [...organizationKeys.lists(), filters] as const,
  details: () => [...organizationKeys.all, 'detail'] as const,
  detail: (id: string) => [...organizationKeys.details(), id] as const,
  members: (id: string) => [...organizationKeys.detail(id), 'members'] as const,
  active: () => [...organizationKeys.all, 'active'] as const,
  full: (id: string) => [...organizationKeys.detail(id), 'full'] as const,
  invitations: (id: string) =>
    [...organizationKeys.detail(id), 'invitations'] as const,
}

// ============================================================================
// Query Hooks (using Better Auth's built-in React hooks)
// ============================================================================

/**
 * Hook to fetch all organizations for the current user
 * Uses Better Auth's built-in useListOrganizations hook
 */
export function useOrganizations() {
  return authClient.useListOrganizations()
}

/**
 * Hook to get the active organization
 * Uses Better Auth's built-in useActiveOrganization hook
 */
export function useActiveOrganization() {
  return authClient.useActiveOrganization()
}

/**
 * Hook to fetch a single organization with full details (including members)
 * Uses React Query to wrap the Better Auth getFullOrganization method
 */
export function useOrganization(organizationId: string | undefined) {
  return useQuery({
    queryKey: organizationKeys.full(organizationId ?? ''),
    queryFn: async () => {
      if (!organizationId) throw new Error('Organization ID is required')
      const result = await authClient.organization.getFullOrganization({
        query: {
          organizationId,
        },
      })
      if (result.error) {
        throw new Error(
          result.error.message ?? 'Failed to fetch organization'
        )
      }
      return result.data
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  })
}

/**
 * Hook to fetch organization members with pagination
 */
export function useOrganizationMembers(
  organizationId: string | undefined,
  options?: {
    limit?: number
    offset?: number
    sortBy?: 'createdAt'
    sortDirection?: 'asc' | 'desc'
  }
) {
  return useQuery({
    queryKey: [
      ...organizationKeys.members(organizationId ?? ''),
      options,
    ] as const,
    queryFn: async () => {
      if (!organizationId) throw new Error('Organization ID is required')
      const result = await authClient.organization.listMembers({
        query: {
          organizationId,
          limit: options?.limit,
          offset: options?.offset,
          sortBy: options?.sortBy,
          sortDirection: options?.sortDirection,
        },
      })
      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to fetch members')
      }
      return result.data
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60, // 1 minute
  })
}

/**
 * Hook to fetch organization invitations
 */
export function useOrganizationInvitations(organizationId?: string) {
  return useQuery({
    queryKey: organizationKeys.invitations(organizationId ?? 'active'),
    queryFn: async () => {
      const result = await authClient.organization.listInvitations({
        query: {
          organizationId,
        },
      })
      if (result.error) {
        throw new Error(
          result.error.message ?? 'Failed to fetch invitations'
        )
      }
      return result.data
    },
    staleTime: 1000 * 60, // 1 minute
  })
}

// ============================================================================
// Async Functions (for server components or direct use)
// ============================================================================

/**
 * Async function to get full organization details
 * Use this in server components or with React Query's useQuery
 */
export async function getFullOrganization(organizationId?: string) {
  const result = await authClient.organization.getFullOrganization({
    query: {
      organizationId,
    },
  })
  if (result.error) {
    throw new Error(result.error.message ?? 'Failed to fetch organization')
  }
  return result.data
}

/**
 * Async function to list organization members
 */
export async function getOrganizationMembers(
  organizationId: string,
  options?: {
    limit?: number
    offset?: number
    sortBy?: 'createdAt'
    sortDirection?: 'asc' | 'desc'
  }
) {
  const result = await authClient.organization.listMembers({
    query: {
      organizationId,
      limit: options?.limit,
      offset: options?.offset,
      sortBy: options?.sortBy,
      sortDirection: options?.sortDirection,
    },
  })
  if (result.error) {
    throw new Error(result.error.message ?? 'Failed to fetch members')
  }
  return result.data
}

/**
 * Async function to list organization invitations
 */
export async function getOrganizationInvitations(organizationId?: string) {
  const result = await authClient.organization.listInvitations({
    query: {
      organizationId,
    },
  })
  if (result.error) {
    throw new Error(result.error.message ?? 'Failed to fetch invitations')
  }
  return result.data
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to create a new organization
 */
export function useCreateOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      name: string
      slug: string
      logo?: string
      metadata?: Record<string, unknown>
    }) => {
      const result = await authClient.organization.create({
        name: data.name,
        slug: data.slug,
        logo: data.logo,
        metadata: data.metadata,
      })

      if (result.error) {
        throw new Error(
          result.error.message ?? 'Failed to create organization'
        )
      }

      return result.data
    },
    onSuccess: () => {
      // Invalidate organization list cache
      void queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
    },
  })
}

/**
 * Hook to set the active organization
 */
export function useSetActiveOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      organizationId?: string | null
      organizationSlug?: string
    }) => {
      const result = await authClient.organization.setActive({
        organizationId: data.organizationId,
        organizationSlug: data.organizationSlug,
      })

      if (result.error) {
        throw new Error(
          result.error.message ?? 'Failed to set active organization'
        )
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: organizationKeys.active() })
    },
  })
}

/**
 * Hook to update member role in an organization
 */
export function useUpdateMemberRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      organizationId?: string
      memberId: string
      role: string | string[]
    }) => {
      const result = await authClient.organization.updateMemberRole({
        memberId: data.memberId,
        role: data.role,
        organizationId: data.organizationId,
      })

      if (result.error) {
        throw new Error(
          result.error.message ?? 'Failed to update member role'
        )
      }

      return result.data
    },
    onSuccess: (_, variables) => {
      if (variables.organizationId) {
        void queryClient.invalidateQueries({
          queryKey: organizationKeys.members(variables.organizationId),
        })
        void queryClient.invalidateQueries({
          queryKey: organizationKeys.full(variables.organizationId),
        })
      }
    },
  })
}

/**
 * Hook to invite a member to an organization
 */
export function useInviteMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      organizationId?: string
      email: string
      role: 'owner' | 'admin' | 'member'
      teamId?: string
      resend?: boolean
    }) => {
      const result = await authClient.organization.inviteMember({
        email: data.email,
        role: data.role,
        organizationId: data.organizationId,
        resend: data.resend,
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to invite member')
      }

      return result.data
    },
    onSuccess: (_, variables) => {
      if (variables.organizationId) {
        void queryClient.invalidateQueries({
          queryKey: organizationKeys.invitations(variables.organizationId),
        })
      }
    },
  })
}

/**
 * Hook to accept an organization invitation
 */
export function useAcceptInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { invitationId: string }) => {
      const result = await authClient.organization.acceptInvitation({
        invitationId: data.invitationId,
      })

      if (result.error) {
        throw new Error(
          result.error.message ?? 'Failed to accept invitation'
        )
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
    },
  })
}

/**
 * Hook to reject an organization invitation
 */
export function useRejectInvitation() {
  return useMutation({
    mutationFn: async (data: { invitationId: string }) => {
      const result = await authClient.organization.rejectInvitation({
        invitationId: data.invitationId,
      })

      if (result.error) {
        throw new Error(
          result.error.message ?? 'Failed to reject invitation'
        )
      }

      return result.data
    },
  })
}

/**
 * Hook to cancel an organization invitation
 */
export function useCancelInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      invitationId: string
      organizationId?: string
    }) => {
      const result = await authClient.organization.cancelInvitation({
        invitationId: data.invitationId,
      })

      if (result.error) {
        throw new Error(
          result.error.message ?? 'Failed to cancel invitation'
        )
      }

      return result.data
    },
    onSuccess: (_, variables) => {
      if (variables.organizationId) {
        void queryClient.invalidateQueries({
          queryKey: organizationKeys.invitations(variables.organizationId),
        })
      }
    },
  })
}

/**
 * Hook to remove a member from an organization
 */
export function useRemoveMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      organizationId?: string
      memberIdOrEmail: string
    }) => {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail: data.memberIdOrEmail,
        organizationId: data.organizationId,
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to remove member')
      }

      return result.data
    },
    onSuccess: (_, variables) => {
      if (variables.organizationId) {
        void queryClient.invalidateQueries({
          queryKey: organizationKeys.members(variables.organizationId),
        })
        void queryClient.invalidateQueries({
          queryKey: organizationKeys.full(variables.organizationId),
        })
        void queryClient.invalidateQueries({
          queryKey: organizationKeys.detail(variables.organizationId),
        })
      }
    },
  })
}

/**
 * Hook to leave an organization
 */
export function useLeaveOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { organizationId: string }) => {
      const result = await authClient.organization.leave({
        organizationId: data.organizationId,
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to leave organization')
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: organizationKeys.active() })
    },
  })
}

/**
 * Hook to delete an organization
 */
export function useDeleteOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { organizationId: string }) => {
      const result = await authClient.organization.delete({
        organizationId: data.organizationId,
      })

      if (result.error) {
        throw new Error(
          result.error.message ?? 'Failed to delete organization'
        )
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: organizationKeys.active() })
    },
  })
}

/**
 * Hook to update an organization
 */
export function useUpdateOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      organizationId?: string
      data: {
        name?: string
        slug?: string
        logo?: string
        metadata?: Record<string, unknown>
      }
    }) => {
      const result = await authClient.organization.update({
        organizationId: data.organizationId,
        data: data.data,
      })

      if (result.error) {
        throw new Error(
          result.error.message ?? 'Failed to update organization'
        )
      }

      return result.data
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
      if (variables.organizationId) {
        void queryClient.invalidateQueries({
          queryKey: organizationKeys.detail(variables.organizationId),
        })
        void queryClient.invalidateQueries({
          queryKey: organizationKeys.full(variables.organizationId),
        })
      }
    },
  })
}

// ============================================================================
// Type Re-exports (from Better Auth)
// ============================================================================

// Re-export types from Better Auth for convenience
export type { Organization, Member } from 'better-auth/plugins'
