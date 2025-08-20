'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { toast } from 'sonner'

// Re-export service types for backward compatibility
// Note: We'll use the service contract types directly for now
export type Service = {
  id: string
  projectId: string
  name: string
  type: string
  dockerfilePath: string
  buildContext: string
  port: number | null
  healthCheckPath: string
  environmentVariables: Record<string, string> | null
  buildArguments: Record<string, string> | null
  resourceLimits: {
    memory?: string
    cpu?: string
    storage?: string
  } | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export type ServiceDependency = {
  id: string
  serviceId: string
  dependsOnServiceId: string
  isRequired: boolean
  createdAt: Date
  dependsOnService: {
    id: string
    name: string
    type: string
  }
}

// Service hooks
export function useServices(projectId: string, options?: {
  limit?: number
  offset?: number
  search?: string
  type?: string
  isActive?: boolean
}) {
  const params = {
    projectId,
    limit: options?.limit || 20,
    offset: options?.offset || 0,
    ...(options?.search && { search: options.search }),
    ...(options?.type && { type: options.type }),
    ...(options?.isActive !== undefined && { isActive: options.isActive }),
  }

  return useQuery(orpc.service.listByProject.queryOptions({
    input: params,
    enabled: !!projectId,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useService(serviceId: string) {
  return useQuery(orpc.service.getById.queryOptions({
    input: { id: serviceId },
    enabled: !!serviceId,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useServiceDependencies(serviceId: string) {
  return useQuery(orpc.service.getDependencies.queryOptions({
    input: { id: serviceId },
    enabled: !!serviceId,
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useServiceDeployments(serviceId: string, options?: {
  limit?: number
  offset?: number
  environment?: 'production' | 'staging' | 'preview' | 'development'
  status?: 'pending' | 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled'
}) {
  const params = {
    id: serviceId,
    limit: options?.limit || 20,
    offset: options?.offset || 0,
    ...(options?.environment && { environment: options.environment }),
    ...(options?.status && { status: options.status }),
  }

  return useQuery(orpc.service.getDeployments.queryOptions({
    input: params,
    enabled: !!serviceId,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

// Service mutations
export function useCreateService() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.service.create.mutationOptions({
    onSuccess: (data, variables) => {
      // Invalidate and refetch services for the project
      queryClient.invalidateQueries({
        queryKey: orpc.service.listByProject.queryKey({ 
          input: { projectId: variables.projectId } 
        })
      })
      toast.success('Service created successfully')
    },
    onError: (error: Error) => {
      console.error('Error creating service:', error)
      toast.error('Failed to create service')
    },
  }))
}

export function useUpdateService() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.service.update.mutationOptions({
    onSuccess: (data, variables) => {
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: orpc.service.listByProject.queryKey({ 
          input: { projectId: data.projectId } 
        })
      })
      queryClient.invalidateQueries({
        queryKey: orpc.service.getById.queryKey({ 
          input: { id: variables.id } 
        })
      })
      toast.success('Service updated successfully')
    },
    onError: (error: Error) => {
      console.error('Error updating service:', error)
      toast.error('Failed to update service')
    },
  }))
}

export function useDeleteService() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.service.delete.mutationOptions({
    onSuccess: (data, variables) => {
      // Invalidate services list for all projects
      queryClient.invalidateQueries({ queryKey: ['service', 'listByProject'] })
      queryClient.removeQueries({
        queryKey: orpc.service.getById.queryKey({ 
          input: { id: variables.id } 
        })
      })
      toast.success('Service deleted successfully')
    },
    onError: (error: Error) => {
      console.error('Error deleting service:', error)
      toast.error('Failed to delete service')
    },
  }))
}

export function useToggleServiceActive() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.service.toggleActive.mutationOptions({
    onSuccess: (data, variables) => {
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: orpc.service.listByProject.queryKey({ 
          input: { projectId: data.projectId } 
        })
      })
      queryClient.invalidateQueries({
        queryKey: orpc.service.getById.queryKey({ 
          input: { id: variables.id } 
        })
      })
      toast.success(`Service ${data.isActive ? 'activated' : 'deactivated'}`)
    },
    onError: (error: Error) => {
      console.error('Error toggling service:', error)
      toast.error('Failed to toggle service status')
    },
  }))
}

export function useAddServiceDependency() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.service.addDependency.mutationOptions({
    onSuccess: (data, variables) => {
      // Invalidate service dependencies
      queryClient.invalidateQueries({
        queryKey: orpc.service.getDependencies.queryKey({ 
          input: { id: variables.id } 
        })
      })
      toast.success('Service dependency added')
    },
    onError: (error: Error) => {
      console.error('Error adding service dependency:', error)
      toast.error('Failed to add service dependency')
    },
  }))
}

export function useRemoveServiceDependency() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.service.removeDependency.mutationOptions({
    onSuccess: (data, variables) => {
      // Invalidate service dependencies
      queryClient.invalidateQueries({
        queryKey: orpc.service.getDependencies.queryKey({ 
          input: { id: variables.id } 
        })
      })
      toast.success('Service dependency removed')
    },
    onError: (error: Error) => {
      console.error('Error removing service dependency:', error)
      toast.error('Failed to remove service dependency')
    },
  }))
}