'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { toast } from 'sonner'

// =============================================================================
// TRAEFIK FILE MANAGEMENT HOOKS (Current Implementation)
// =============================================================================

// File system management hooks
export function useTraefikFileSystem(path?: string) {
  return useQuery(orpc.traefik.getFileSystem.queryOptions({
    input: { path },
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useTraefikProjectFileSystem(projectName: string) {
  return useQuery(orpc.traefik.getProjectFileSystem.queryOptions({
    input: { projectName },
    enabled: !!projectName,
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useTraefikFileContent(filePath: string) {
  return useQuery(orpc.traefik.getFileContent.queryOptions({
    input: { filePath },
    enabled: !!filePath,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useTraefikDownloadFile() {
  return useMutation(orpc.traefik.downloadFile.mutationOptions({
    onError: (error: Error) => {
      toast.error(`Failed to download file: ${error.message}`)
    },
  }))
}

export function useTraefikListProjects() {
  return useQuery(orpc.traefik.listProjects.queryOptions({
    input: {},
    staleTime: 1000 * 60, // 1 minute
  }))
}

// Configuration sync hooks
export function useTraefikForceSyncConfigs() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.traefik.forceSyncConfigs.mutationOptions({
    onSuccess: () => {
      // Invalidate file system queries after sync
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === 'traefik' && 
          (query.queryKey[1] === 'getFileSystem' || query.queryKey[1] === 'getProjectFileSystem')
      })
      toast.success('Traefik configurations synced successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to sync configurations: ${error.message}`)
    },
  }))
}

export function useTraefikCleanupOrphanedFiles() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.traefik.cleanupOrphanedFiles.mutationOptions({
    onSuccess: () => {
      // Invalidate file system queries after cleanup
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === 'traefik' && 
          (query.queryKey[1] === 'getFileSystem' || query.queryKey[1] === 'getProjectFileSystem')
      })
      toast.success('Orphaned files cleaned up successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to cleanup orphaned files: ${error.message}`)
    },
  }))
}

// Utility hook for Traefik file management actions
export function useTraefikFileActions() {
  const downloadFile = useTraefikDownloadFile()
  const forceSyncConfigs = useTraefikForceSyncConfigs()
  const cleanupOrphanedFiles = useTraefikCleanupOrphanedFiles()

  return {
    downloadFile: downloadFile.mutate,
    forceSyncConfigs: forceSyncConfigs.mutate,
    cleanupOrphanedFiles: cleanupOrphanedFiles.mutate,
    isLoading: {
      downloadFile: downloadFile.isPending,
      forceSyncConfigs: forceSyncConfigs.isPending,
      cleanupOrphanedFiles: cleanupOrphanedFiles.isPending,
    }
  }
}