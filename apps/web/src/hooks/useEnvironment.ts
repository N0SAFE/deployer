'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { toast } from 'sonner'

// Environment Management Hooks
export function useEnvironments(options?: {
  projectId?: string
  type?: 'production' | 'staging' | 'preview'
  search?: string
  limit?: number
  offset?: number
  sortBy?: 'name' | 'type' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}) {
  const params = {
    limit: options?.limit || 20,
    offset: options?.offset || 0,
    ...(options?.projectId && { projectId: options.projectId }),
    ...(options?.type && { type: options.type }),
    ...(options?.search && { search: options.search }),
    ...(options?.sortBy && { sortBy: options.sortBy }),
    ...(options?.sortOrder && { sortOrder: options.sortOrder }),
  }

  return useQuery(orpc.environment.list.queryOptions({
    input: params,
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useEnvironment(environmentId: string) {
  return useQuery(orpc.environment.get.queryOptions({
    input: { id: environmentId },
    enabled: !!environmentId,
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useCreateEnvironment() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.environment.create.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.environment.list.queryKey({ input: {} }) })
      toast.success('Environment created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create environment: ${error.message}`)
    },
  }))
}

export function useUpdateEnvironment() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.environment.update.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.environment.list.queryKey({ input: {} }) })
      toast.success('Environment updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update environment: ${error.message}`)
    },
  }))
}

export function useDeleteEnvironment() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.environment.delete.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.environment.list.queryKey({ input: {} }) })
      toast.success('Environment deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete environment: ${error.message}`)
    },
  }))
}

// Environment Variables Hooks
export function useEnvironmentVariables(environmentId: string) {
  return useQuery(orpc.environment.getVariables.queryOptions({
    input: { environmentId },
    enabled: !!environmentId,
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useUpdateEnvironmentVariables() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.environment.updateVariables.mutationOptions({
    onSuccess: (_data, variables) => {
      if ('environmentId' in variables && typeof variables.environmentId === 'string') {
        queryClient.invalidateQueries({ 
          queryKey: orpc.environment.getVariables.queryKey({ 
            input: { environmentId: variables.environmentId } 
          }) 
        })
      }
      toast.success('Environment variables updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update variables: ${error.message}`)
    },
  }))
}

export function useResolveEnvironmentVariables() {
  return useMutation(orpc.environment.resolveVariables.mutationOptions({
    onSuccess: () => {
      toast.success('Variables resolved successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to resolve variables: ${error.message}`)
    },
  }))
}

export function useBulkUpdateEnvironmentVariables() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.environment.bulkUpdateVariables.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.environment.list.queryKey({ input: {} }) })
      toast.success('Environment variables updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update variables: ${error.message}`)
    },
  }))
}

// Preview Environments Hooks
export function usePreviewEnvironments(options: {
  projectId: string
  branch?: string
  status?: 'active' | 'expired' | 'all'
  limit?: number
  offset?: number
}) {
  const params = {
    projectId: options.projectId,
    limit: options.limit || 20,
    offset: options.offset || 0,
    ...(options.branch && { branch: options.branch }),
    ...(options.status && { status: options.status }),
  }

  return useQuery(orpc.environment.listPreviewEnvironments.queryOptions({
    input: params,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useCreatePreviewEnvironment() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.environment.createPreview.mutationOptions({
    onSuccess: (_data, variables) => {
      if ('projectId' in variables && typeof variables.projectId === 'string') {
        queryClient.invalidateQueries({ 
          queryKey: orpc.environment.listPreviewEnvironments.queryKey({ 
            input: { projectId: variables.projectId } 
          }) 
        })
      }
      toast.success('Preview environment created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create preview environment: ${error.message}`)
    },
  }))
}

export function useDeletePreviewEnvironment() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.environment.delete.mutationOptions({
    onSuccess: () => {
      // Invalidate all preview environment queries since we don't know which project
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          Array.isArray(query.queryKey) && 
          query.queryKey.includes('listPreviewEnvironments')
      })
      toast.success('Preview environment deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete preview environment: ${error.message}`)
    },
  }))
}

export function useCleanupExpiredPreviews() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.environment.cleanupPreviewEnvironments.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => 
          Array.isArray(query.queryKey) && 
          query.queryKey.includes('listPreviewEnvironments')
      })
      toast.success('Expired preview environments cleaned up successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to cleanup preview environments: ${error.message}`)
    },
  }))
}

// Template Resolution Hooks
export function useParseTemplate() {
  return useMutation(orpc.environment.parseTemplate.mutationOptions({
    onSuccess: () => {
      toast.success('Template parsed successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to parse template: ${error.message}`)
    },
  }))
}

export function useResolveTemplate() {
  return useMutation(orpc.environment.resolveTemplate.mutationOptions({
    onSuccess: () => {
      toast.success('Template resolved successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to resolve template: ${error.message}`)
    },
  }))
}

export function useResolveVariablesAdvanced() {
  return useMutation(orpc.environment.resolveVariablesAdvanced.mutationOptions({
    onSuccess: () => {
      toast.success('Variables resolved successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to resolve variables: ${error.message}`)
    },
  }))
}

export function useGetResolutionHistory(environmentId: string) {
  return useQuery(orpc.environment.getResolutionHistory.queryOptions({
    input: { 
      environmentId,
      id: environmentId, // Add required id parameter
      limit: 50,
      offset: 0
    },
    enabled: !!environmentId,
    staleTime: 1000 * 60, // 1 minute
  }))
}

// Environment Validation and Utilities
export function useValidateEnvironment() {
  return useMutation(orpc.environment.validate.mutationOptions({
    onSuccess: () => {
      toast.success('Environment validation completed')
    },
    onError: (error: Error) => {
      toast.error(`Environment validation failed: ${error.message}`)
    },
  }))
}

export function useCompareEnvironments() {
  return useMutation(orpc.environment.compare.mutationOptions({
    onSuccess: () => {
      toast.success('Environment comparison completed')
    },
    onError: (error: Error) => {
      toast.error(`Environment comparison failed: ${error.message}`)
    },
  }))
}

export function useBulkDeleteEnvironments() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.environment.bulkDelete.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.environment.list.queryKey({ input: {} }) })
      toast.success('Environments deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete environments: ${error.message}`)
    },
  }))
}

// Utility hooks for environment actions
export function useEnvironmentActions() {
  const createEnvironment = useCreateEnvironment()
  const updateEnvironment = useUpdateEnvironment()
  const deleteEnvironment = useDeleteEnvironment()
  
  const updateVariables = useUpdateEnvironmentVariables()
  const bulkUpdateVariables = useBulkUpdateEnvironmentVariables()
  
  const createPreview = useCreatePreviewEnvironment()
  const deletePreview = useDeletePreviewEnvironment()
  const cleanupExpiredPreviews = useCleanupExpiredPreviews()
  
  const parseTemplate = useParseTemplate()
  const resolveTemplate = useResolveTemplate()
  const resolveVariablesAdvanced = useResolveVariablesAdvanced()
  
  const validateEnvironment = useValidateEnvironment()
  const compareEnvironments = useCompareEnvironments()
  const bulkDeleteEnvironments = useBulkDeleteEnvironments()

  return {
    // Environment actions
    createEnvironment: createEnvironment.mutate,
    updateEnvironment: updateEnvironment.mutate,
    deleteEnvironment: deleteEnvironment.mutate,
    
    // Variable actions
    updateVariables: updateVariables.mutate,
    bulkUpdateVariables: bulkUpdateVariables.mutate,
    
    // Preview environment actions
    createPreview: createPreview.mutate,
    deletePreview: deletePreview.mutate,
    cleanupExpiredPreviews: cleanupExpiredPreviews.mutate,
    
    // Template actions
    parseTemplate: parseTemplate.mutate,
    resolveTemplate: resolveTemplate.mutate,
    resolveVariablesAdvanced: resolveVariablesAdvanced.mutate,
    
    // Utility actions
    validateEnvironment: validateEnvironment.mutate,
    compareEnvironments: compareEnvironments.mutate,
    bulkDeleteEnvironments: bulkDeleteEnvironments.mutate,
    
    isLoading: {
      createEnvironment: createEnvironment.isPending,
      updateEnvironment: updateEnvironment.isPending,
      deleteEnvironment: deleteEnvironment.isPending,
      
      updateVariables: updateVariables.isPending,
      bulkUpdateVariables: bulkUpdateVariables.isPending,
      
      createPreview: createPreview.isPending,
      deletePreview: deletePreview.isPending,
      cleanupExpiredPreviews: cleanupExpiredPreviews.isPending,
      
      parseTemplate: parseTemplate.isPending,
      resolveTemplate: resolveTemplate.isPending,
      resolveVariablesAdvanced: resolveVariablesAdvanced.isPending,
      
      validateEnvironment: validateEnvironment.isPending,
      compareEnvironments: compareEnvironments.isPending,
      bulkDeleteEnvironments: bulkDeleteEnvironments.isPending,
    }
  }
}

// Comprehensive environment management hook
export function useEnvironmentDashboard(projectId?: string) {
  const environments = useEnvironments(projectId ? { projectId } : undefined)
  const previewEnvironments = projectId ? usePreviewEnvironments({ projectId, limit: 10 }) : null

  const isLoading = environments.isLoading || (previewEnvironments ? previewEnvironments.isLoading : false)
  const hasError = environments.error || (previewEnvironments ? previewEnvironments.error : false)

  return {
    data: {
      environments: environments.data,
      previewEnvironments: previewEnvironments?.data,
    },
    isLoading,
    error: hasError,
    refetch: () => {
      environments.refetch()
      previewEnvironments?.refetch()
    }
  }
}

// Legacy compatibility functions for EnvironmentDashboard (stub implementations)
export function useCreateEnvironmentVariable() {
  return { mutate: () => {}, mutateAsync: () => Promise.resolve(), isPending: false }
}

export function useUpdateEnvironmentVariable() {
  return { mutate: () => {}, mutateAsync: () => Promise.resolve(), isPending: false }
}

export function useDeleteEnvironmentVariable() {
  return { mutate: () => {}, mutateAsync: () => Promise.resolve(), isPending: false }
}

export function useEnvironmentTemplates() {
  return { data: { items: [] }, isLoading: false, error: null }
}

export function useCreateEnvironmentTemplate() {
  return { mutate: () => {}, mutateAsync: () => Promise.resolve(), isPending: false }
}

export function useUpdateEnvironmentTemplate() {
  return { mutate: () => {}, mutateAsync: () => Promise.resolve(), isPending: false }
}

export function useDeleteEnvironmentTemplate() {
  return { mutate: () => {}, mutateAsync: () => Promise.resolve(), isPending: false }
}