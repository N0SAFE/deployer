'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { toast } from 'sonner'

// Storage File Management hooks
export function useFiles(path: string = '/') {
  return useQuery(orpc.storage.listFiles.queryOptions({
    input: { path },
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useFileContent(filePath: string) {
  return useQuery(orpc.storage.getFile.queryOptions({
    input: { path: filePath },
    enabled: !!filePath,
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useUploadFile() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.storage.uploadFile.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.storage.listFiles.queryKey({ input: {} }) })
      toast.success('File uploaded successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to upload file: ${error.message}`)
    },
  }))
}

export function useMoveFile() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.storage.moveFile.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.storage.listFiles.queryKey({ input: {} }) })
      toast.success('File moved successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to move file: ${error.message}`)
    },
  }))
}

export function useCopyFile() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.storage.copyFile.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.storage.listFiles.queryKey({ input: {} }) })
      toast.success('File copied successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to copy file: ${error.message}`)
    },
  }))
}

export function useDeleteFile() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.storage.deleteFile.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.storage.listFiles.queryKey({ input: {} }) })
      toast.success('File deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete file: ${error.message}`)
    },
  }))
}

export function useCreateFolder() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.storage.createDirectory.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.storage.listFiles.queryKey({ input: {} }) })
      toast.success('Folder created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create folder: ${error.message}`)
    },
  }))
}

export function useDownloadFile() {
  return useMutation(orpc.storage.getFile.mutationOptions({
    onSuccess: () => {
      toast.success('File download started')
    },
    onError: (error: Error) => {
      toast.error(`Failed to download file: ${error.message}`)
    },
  }))
}

// Storage Backup Management hooks
export function useBackups(options?: {
  databaseName?: string
  limit?: number
  offset?: number
  status?: 'in-progress' | 'completed' | 'failed' | 'cancelled'
}) {
  const params = {
    limit: options?.limit || 20,
    offset: options?.offset || 0,
    ...(options?.status && { status: options.status }),
  }

  return useQuery(orpc.storage.listBackups.queryOptions({
    input: params,
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useBackup(backupId: string) {
  return useQuery(orpc.storage.getBackup.queryOptions({
    input: { backupId },
    enabled: !!backupId,
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useCreateBackup() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.storage.createBackup.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.storage.listBackups.queryKey({ input: {} }) })
      toast.success('Backup created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create backup: ${error.message}`)
    },
  }))
}

export function useRestoreBackup() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.storage.restoreBackup.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.storage.listBackups.queryKey({ input: {} }) })
      queryClient.invalidateQueries({ queryKey: orpc.storage.listFiles.queryKey({ input: {} }) })
      toast.success('Backup restore initiated')
    },
    onError: (error: Error) => {
      toast.error(`Failed to restore backup: ${error.message}`)
    },
  }))
}

export function useDeleteBackup() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.storage.deleteBackup.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.storage.listBackups.queryKey({ input: {} }) })
      toast.success('Backup deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete backup: ${error.message}`)
    },
  }))
}

export function useDownloadBackup() {
  return useMutation(orpc.storage.downloadBackup.mutationOptions({
    onSuccess: () => {
      toast.success('Backup download started')
    },
    onError: (error: Error) => {
      toast.error(`Failed to download backup: ${error.message}`)
    },
  }))
}

// Storage Monitoring hooks
export function useStorageUsage() {
  return useQuery(orpc.storage.getUsage.queryOptions({
    input: {},
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useStorageMetrics() {
  return useQuery(orpc.storage.getMetrics.queryOptions({
    input: {},
    staleTime: 1000 * 30, // 30 seconds
  }))
}

// Storage Quota Management hooks  
export function useStorageQuotas() {
  return useQuery(orpc.storage.listQuotas.queryOptions({
    input: {},
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useCreateQuota() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.storage.createQuota.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.storage.listQuotas.queryKey({ input: {} }) })
      toast.success('Storage quota created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create storage quota: ${error.message}`)
    },
  }))
}

export function useUpdateQuota() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.storage.updateQuota.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.storage.listQuotas.queryKey({ input: {} }) })
      toast.success('Storage quota updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update storage quota: ${error.message}`)
    },
  }))
}

export function useDeleteQuota() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.storage.deleteQuota.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.storage.listQuotas.queryKey({ input: {} }) })
      toast.success('Storage quota deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete storage quota: ${error.message}`)
    },
  }))
}

// Cleanup Operations hooks
export function useCleanupTempFiles() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.storage.cleanup.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.storage.getUsage.queryKey({ input: {} }) })
      queryClient.invalidateQueries({ queryKey: orpc.storage.getMetrics.queryKey({ input: {} }) })
      toast.success('Temporary files cleaned up successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to cleanup temporary files: ${error.message}`)
    },
  }))
}

// Utility hooks for storage actions
export function useStorageActions() {
  const uploadFile = useUploadFile()
  const moveFile = useMoveFile()
  const copyFile = useCopyFile()
  const deleteFile = useDeleteFile()
  const createFolder = useCreateFolder()
  const downloadFile = useDownloadFile()
  const createBackup = useCreateBackup()
  const restoreBackup = useRestoreBackup()
  const deleteBackup = useDeleteBackup()
  const downloadBackup = useDownloadBackup()
  const createQuota = useCreateQuota()
  const updateQuota = useUpdateQuota()
  const deleteQuota = useDeleteQuota()
  const cleanupTempFiles = useCleanupTempFiles()

  return {
    uploadFile: uploadFile.mutate,
    moveFile: moveFile.mutate,
    copyFile: copyFile.mutate,
    deleteFile: deleteFile.mutate,
    createFolder: createFolder.mutate,
    downloadFile: downloadFile.mutate,
    createBackup: createBackup.mutate,
    restoreBackup: restoreBackup.mutate,
    deleteBackup: deleteBackup.mutate,
    downloadBackup: downloadBackup.mutate,
    createQuota: createQuota.mutate,
    updateQuota: updateQuota.mutate,
    deleteQuota: deleteQuota.mutate,
    cleanupTempFiles: cleanupTempFiles.mutate,
    isLoading: {
      uploadFile: uploadFile.isPending,
      moveFile: moveFile.isPending,
      copyFile: copyFile.isPending,
      deleteFile: deleteFile.isPending,
      createFolder: createFolder.isPending,
      downloadFile: downloadFile.isPending,
      createBackup: createBackup.isPending,
      restoreBackup: restoreBackup.isPending,
      deleteBackup: deleteBackup.isPending,
      downloadBackup: downloadBackup.isPending,
      createQuota: createQuota.isPending,
      updateQuota: updateQuota.isPending,
      deleteQuota: deleteQuota.isPending,
      cleanupTempFiles: cleanupTempFiles.isPending,
    }
  }
}

// File browser hook that combines file operations
export function useFileBrowser(initialPath: string = '/') {
  const [currentPath, setCurrentPath] = useState(initialPath)
  const filesQuery = useFiles(currentPath)
  const storageActions = useStorageActions()

  const navigateTo = (path: string) => {
    setCurrentPath(path)
  }

  const navigateUp = () => {
    const parts = currentPath.split('/').filter(Boolean)
    if (parts.length > 0) {
      parts.pop()
      setCurrentPath('/' + parts.join('/'))
    }
  }

  return {
    currentPath,
    files: filesQuery.data,
    isLoading: filesQuery.isLoading,
    error: filesQuery.error,
    navigateTo,
    navigateUp,
    refresh: filesQuery.refetch,
    actions: storageActions,
  }
}