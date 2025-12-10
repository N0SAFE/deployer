'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authClient } from '@/lib/auth/options'

/**
 * Team hooks using Better Auth organization plugin with teams enabled
 *
 * These hooks wrap the Better Auth organization client team methods
 * to provide a consistent API for team management.
 *
 * Note: Teams are managed under the organization namespace in Better Auth.
 * Teams must be enabled in both server and client organization plugins.
 *
 * API Endpoints (when teams are enabled):
 * - GET  /organization/list-teams        -> listTeams
 * - GET  /organization/list-user-teams   -> listUserTeams
 * - POST /organization/list-team-members -> listTeamMembers
 * - POST /organization/create-team       -> createTeam
 * - POST /organization/update-team       -> updateTeam
 * - POST /organization/remove-team       -> removeTeam
 * - POST /organization/set-active-team   -> setActiveTeam
 * - POST /organization/add-team-member   -> addTeamMember
 * - POST /organization/remove-team-member -> removeTeamMember
 */

// Query keys for cache management
export const teamKeys = {
  all: ['teams'] as const,
  lists: () => [...teamKeys.all, 'list'] as const,
  byOrganization: (organizationId: string | undefined) =>
    [...teamKeys.lists(), { organizationId }] as const,
  userTeams: () => [...teamKeys.all, 'user'] as const,
  details: () => [...teamKeys.all, 'detail'] as const,
  detail: (teamId: string) => [...teamKeys.details(), teamId] as const,
  members: (teamId: string) => [...teamKeys.detail(teamId), 'members'] as const,
  active: () => [...teamKeys.all, 'active'] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Hook to fetch all teams in an organization
 * Uses Better Auth's listTeams method (GET /organization/list-teams)
 */
export function useTeams(organizationId?: string) {
  return useQuery({
    queryKey: teamKeys.byOrganization(organizationId),
    queryFn: async () => {
      // listTeams is the client method for GET /organization/list-teams
      const result = await authClient.organization.listTeams({
        query: {
          organizationId,
        },
      })
      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to fetch teams')
      }
      return result.data
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
  })
}

/**
 * Hook to fetch all teams the current user is a member of
 * Uses Better Auth's listUserTeams method (GET /organization/list-user-teams)
 */
export function useUserTeams() {
  return useQuery({
    queryKey: teamKeys.userTeams(),
    queryFn: async () => {
      const result = await authClient.organization.listUserTeams()
      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to fetch user teams')
      }
      return result.data
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
  })
}

/**
 * Hook to fetch team members
 * Uses Better Auth's listTeamMembers method (POST /organization/list-team-members)
 */
export function useTeamMembers(teamId?: string) {
  return useQuery({
    queryKey: teamKeys.members(teamId ?? ''),
    queryFn: async () => {
      if (!teamId) throw new Error('Team ID is required')
      const result = await authClient.organization.listTeamMembers({
        query: { teamId },
      })
      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to fetch team members')
      }
      return result.data
    },
    enabled: !!teamId,
    staleTime: 1000 * 60, // 1 minute
  })
}

// ============================================================================
// Async Functions (for server components or direct use)
// ============================================================================

/**
 * Async function to get organization teams
 */
export async function getOrganizationTeams(organizationId?: string) {
  const result = await authClient.organization.listTeams({
    query: {
      organizationId,
    },
  })
  if (result.error) {
    throw new Error(result.error.message ?? 'Failed to fetch teams')
  }
  return result.data
}

/**
 * Async function to get user teams
 */
export async function getUserTeams() {
  const result = await authClient.organization.listUserTeams()
  if (result.error) {
    throw new Error(result.error.message ?? 'Failed to fetch user teams')
  }
  return result.data
}

/**
 * Async function to get team members
 */
export async function getTeamMembers(teamId: string) {
  const result = await authClient.organization.listTeamMembers({
    query: { teamId },
  })
  if (result.error) {
    throw new Error(result.error.message ?? 'Failed to fetch team members')
  }
  return result.data
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to create a new team
 * Uses Better Auth's createTeam method (POST /organization/create-team)
 */
export function useCreateTeam() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { name: string; organizationId?: string }) => {
      const result = await authClient.organization.createTeam({
        name: data.name,
        organizationId: data.organizationId,
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to create team')
      }

      return result.data
    },
    onSuccess: (_, variables) => {
      // Invalidate team lists
      void queryClient.invalidateQueries({ queryKey: teamKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: teamKeys.userTeams() })
      if (variables.organizationId) {
        void queryClient.invalidateQueries({
          queryKey: teamKeys.byOrganization(variables.organizationId),
        })
      }
    },
  })
}

/**
 * Hook to update a team
 * Uses Better Auth's updateTeam method (POST /organization/update-team)
 */
export function useUpdateTeam() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      teamId: string
      data: {
        name?: string
      }
    }) => {
      const result = await authClient.organization.updateTeam({
        teamId: data.teamId,
        data: data.data,
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to update team')
      }

      return result.data
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: teamKeys.detail(variables.teamId),
      })
      void queryClient.invalidateQueries({ queryKey: teamKeys.lists() })
    },
  })
}

/**
 * Hook to delete/remove a team
 * Uses Better Auth's removeTeam method (POST /organization/remove-team)
 */
export function useDeleteTeam() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { teamId: string; organizationId?: string }) => {
      const result = await authClient.organization.removeTeam({
        teamId: data.teamId,
        organizationId: data.organizationId,
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to delete team')
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: teamKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: teamKeys.userTeams() })
    },
  })
}

/**
 * Hook to set active team
 * Uses Better Auth's setActiveTeam method (POST /organization/set-active-team)
 */
export function useSetActiveTeam() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { teamId: string | null }) => {
      const result = await authClient.organization.setActiveTeam({
        teamId: data.teamId,
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to set active team')
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: teamKeys.active() })
    },
  })
}

/**
 * Hook to add a member to a team
 * Uses Better Auth's addTeamMember method (POST /organization/add-team-member)
 */
export function useAddTeamMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { teamId: string; userId: string }) => {
      const result = await authClient.organization.addTeamMember({
        teamId: data.teamId,
        userId: data.userId,
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to add team member')
      }

      return result.data
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: teamKeys.members(variables.teamId),
      })
      void queryClient.invalidateQueries({
        queryKey: teamKeys.detail(variables.teamId),
      })
    },
  })
}

/**
 * Hook to remove a member from a team
 * Uses Better Auth's removeTeamMember method (POST /organization/remove-team-member)
 */
export function useRemoveTeamMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { teamId: string; userId: string }) => {
      const result = await authClient.organization.removeTeamMember({
        teamId: data.teamId,
        userId: data.userId,
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to remove team member')
      }

      return result.data
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: teamKeys.members(variables.teamId),
      })
      void queryClient.invalidateQueries({
        queryKey: teamKeys.detail(variables.teamId),
      })
    },
  })
}

// ============================================================================
// Combined Hooks for Complex Operations
// ============================================================================

/**
 * Hook that provides all team actions for convenience
 */
export function useTeamActions() {
  const createTeam = useCreateTeam()
  const updateTeam = useUpdateTeam()
  const deleteTeam = useDeleteTeam()
  const setActiveTeam = useSetActiveTeam()
  const addTeamMember = useAddTeamMember()
  const removeTeamMember = useRemoveTeamMember()

  return {
    // Mutations
    createTeam: createTeam.mutate,
    createTeamAsync: createTeam.mutateAsync,
    updateTeam: updateTeam.mutate,
    updateTeamAsync: updateTeam.mutateAsync,
    deleteTeam: deleteTeam.mutate,
    deleteTeamAsync: deleteTeam.mutateAsync,
    setActiveTeam: setActiveTeam.mutate,
    setActiveTeamAsync: setActiveTeam.mutateAsync,
    addTeamMember: addTeamMember.mutate,
    addTeamMemberAsync: addTeamMember.mutateAsync,
    removeTeamMember: removeTeamMember.mutate,
    removeTeamMemberAsync: removeTeamMember.mutateAsync,

    // Loading states
    isCreating: createTeam.isPending,
    isUpdating: updateTeam.isPending,
    isDeleting: deleteTeam.isPending,
    isSettingActive: setActiveTeam.isPending,
    isAddingMember: addTeamMember.isPending,
    isRemovingMember: removeTeamMember.isPending,

    // Error states
    errors: {
      create: createTeam.error,
      update: updateTeam.error,
      delete: deleteTeam.error,
      setActive: setActiveTeam.error,
      addMember: addTeamMember.error,
      removeMember: removeTeamMember.error,
    },
  }
}

/**
 * Hook that provides team administration capabilities
 * Combines team listing with management actions
 */
export function useTeamAdministration(organizationId?: string) {
  const teams = useTeams(organizationId)
  const userTeams = useUserTeams()
  const teamActions = useTeamActions()

  return {
    // Query data
    teams: teams.data ?? [],
    userTeams: userTeams.data ?? [],

    // Loading states
    isLoading: teams.isLoading || userTeams.isLoading,
    isRefreshing: teams.isFetching,

    // Error states
    error: teams.error ?? userTeams.error,

    // Actions
    ...teamActions,

    // Refresh function
    refresh: () => {
      void teams.refetch()
      void userTeams.refetch()
    },
  }
}

// ============================================================================
// Type exports
// ============================================================================

// Export the team type from Better Auth if available
// These types may vary based on your Better Auth configuration
export interface Team {
  id: string
  name: string
  organizationId: string
  createdAt: Date
  updatedAt: Date
}

export interface TeamMember {
  id: string
  email: string
  name: string
}
