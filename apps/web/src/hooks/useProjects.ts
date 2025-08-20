'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import type { projectWithStatsSchema } from '@repo/api-contracts'
import type { z } from 'zod'

// Infer the actual API return types from the schema
type ProjectWithStats = z.infer<typeof projectWithStatsSchema>
type ProjectsListResponse = {
  projects: ProjectWithStats[]
  total: number
  hasMore: boolean
}

// For backward compatibility, export the Project type
export type Project = ProjectWithStats

// No transformation needed - use API data directly
const transformProject = (apiProject: ProjectWithStats): Project => apiProject

// Main hook to get all projects
export function useProjects(options?: {
  limit?: number
  offset?: number
  search?: string
  sortBy?: 'name' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}) {
  return useQuery(orpc.project.list.queryOptions({
    input: options || {},
    select: (data: ProjectsListResponse) => ({
      ...data,
      projects: data.projects.map(transformProject)
    }),
    staleTime: 1000 * 60 * 5, // 5 minutes
  }))
}

// Hook to get a specific project by ID
export function useProject(id: string) {
  return useQuery(orpc.project.getById.queryOptions({
    input: { id },
    select: transformProject,
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: !!id,
  }))
}

// Hook to create a new project
export function useCreateProject() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.create.mutationOptions({
    onSuccess: () => {
      // Invalidate projects list to refresh data
      queryClient.invalidateQueries({ queryKey: orpc.project.list.queryKey() })
    }
  }))
}

// Hook to update a project
export function useUpdateProject() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.update.mutationOptions({
    onSuccess: (_, variables: { id: string }) => {
      // Invalidate both the project list and the specific project
      queryClient.invalidateQueries({ queryKey: orpc.project.list.queryKey() })
      queryClient.invalidateQueries({ queryKey: orpc.project.getById.queryKey({ input: { id: variables.id } }) })
    }
  }))
}

// Hook to delete a project
export function useDeleteProject() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.delete.mutationOptions({
    onSuccess: () => {
      // Invalidate projects list to refresh data
      queryClient.invalidateQueries({ queryKey: orpc.project.list.queryKey() })
    }
  }))
}

// Hook to get project collaborators
export function useProjectCollaborators(projectId: string) {
  return useQuery(orpc.project.getCollaborators.queryOptions({
    input: { id: projectId },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  }))
}

// Hook to invite a collaborator
export function useInviteCollaborator() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.inviteCollaborator.mutationOptions({
    onSuccess: (_, variables: { id: string }) => {
      // Invalidate collaborators for this project
      queryClient.invalidateQueries({ queryKey: orpc.project.getCollaborators.queryKey({ input: { id: variables.id } }) })
    }
  }))
}

// Hook to update a collaborator
export function useUpdateCollaborator() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.updateCollaborator.mutationOptions({
    onSuccess: (_, variables: { id: string }) => {
      // Invalidate collaborators for this project
      queryClient.invalidateQueries({ queryKey: orpc.project.getCollaborators.queryKey({ input: { id: variables.id } }) })
    }
  }))
}

// Hook to remove a collaborator
export function useRemoveCollaborator() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.project.removeCollaborator.mutationOptions({
    onSuccess: (_, variables: { id: string }) => {
      // Invalidate collaborators for this project
      queryClient.invalidateQueries({ queryKey: orpc.project.getCollaborators.queryKey({ input: { id: variables.id } }) })
    }
  }))
}