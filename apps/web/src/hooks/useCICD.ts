'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { toast } from 'sonner'

// Pipeline Management Hooks
export function usePipelines(projectId?: string) {
  return useQuery(orpc.ciCd.pipeline.listPipelines.queryOptions({
    input: { projectId },
    staleTime: 1000 * 60 * 5, // 5 minutes
  }))
}

export function usePipeline(pipelineId: string) {
  return useQuery(orpc.ciCd.pipeline.getPipeline.queryOptions({
    input: { id: pipelineId },
    enabled: !!pipelineId,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useCreatePipeline() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.ciCd.pipeline.createPipeline.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.ciCd.pipeline.listPipelines.queryKey({ input: {} }) })
      toast.success('Pipeline created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create pipeline: ${error.message}`)
    },
  }))
}

export function useUpdatePipeline() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.ciCd.pipeline.updatePipeline.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.ciCd.pipeline.listPipelines.queryKey({ input: {} }) })
      toast.success('Pipeline updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update pipeline: ${error.message}`)
    },
  }))
}

export function useDeletePipeline() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.ciCd.pipeline.deletePipeline.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.ciCd.pipeline.listPipelines.queryKey({ input: {} }) })
      toast.success('Pipeline deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete pipeline: ${error.message}`)
    },
  }))
}

export function useTriggerPipeline() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.ciCd.pipeline.triggerPipeline.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.ciCd.pipeline.listPipelines.queryKey({ input: {} }) })
      queryClient.invalidateQueries({ queryKey: orpc.ciCd.build.listBuilds.queryKey({ input: {} }) })
      toast.success('Pipeline triggered successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to trigger pipeline: ${error.message}`)
    },
  }))
}

export function useStopPipeline() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.ciCd.pipeline.cancelPipeline.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.ciCd.build.listBuilds.queryKey({ input: {} }) })
      toast.success('Pipeline cancelled successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to stop pipeline: ${error.message}`)
    },
  }))
}

// Build Management hooks (previously called Pipeline Runs)
export function usePipelineRuns(options?: {
  pipelineId?: string
  limit?: number
  offset?: number
  status?: string
}) {
  const params = {
    limit: options?.limit || 20,
    offset: options?.offset || 0,
    ...(options?.pipelineId && { pipelineId: options.pipelineId }),
    ...(options?.status && { status: options.status }),
  }

  return useQuery(orpc.ciCd.build.listBuilds.queryOptions({
    input: params,
    staleTime: 1000 * 15, // 15 seconds
    refetchInterval: 5000, // Poll every 5 seconds for active runs
  }))
}

export function usePipelineRun(runId: string) {
  return useQuery(orpc.ciCd.build.getBuild.queryOptions({
    input: { id: runId },
    enabled: !!runId,
    staleTime: 1000 * 15, // 15 seconds
    refetchInterval: 3000, // Poll every 3 seconds if run is active
  }))
}

export function useRetryPipelineRun() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.ciCd.build.retryBuild.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.ciCd.build.listBuilds.queryKey({ input: {} }) })
      toast.success('Pipeline run retried successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to retry pipeline run: ${error.message}`)
    },
  }))
}

export function useCancelPipelineRun() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.ciCd.build.cancelBuild.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.ciCd.build.listBuilds.queryKey({ input: {} }) })
      toast.success('Pipeline run cancelled successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to cancel pipeline run: ${error.message}`)
    },
  }))
}

// Build Management hooks
export function useBuilds(options?: {
  limit?: number
  offset?: number
  status?: string
}) {
  const params = {
    limit: options?.limit || 20,
    offset: options?.offset || 0,
    ...(options?.status && { status: options.status }),
  }

  return useQuery(orpc.ciCd.build.listBuilds.queryOptions({
    input: params,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useBuild(buildId: string) {
  return useQuery(orpc.ciCd.build.getBuild.queryOptions({
    input: { id: buildId },
    enabled: !!buildId,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useTriggerBuild() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.ciCd.build.createBuild.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.ciCd.build.listBuilds.queryKey({ input: {} }) })
      toast.success('Build triggered successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to trigger build: ${error.message}`)
    },
  }))
}

export function useStopBuild() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.ciCd.build.cancelBuild.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.ciCd.build.listBuilds.queryKey({ input: {} }) })
      toast.success('Build stopped successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to stop build: ${error.message}`)
    },
  }))
}

export function useDownloadBuildArtifacts() {
  return useMutation(orpc.ciCd.build.downloadArtifact.mutationOptions({
    onSuccess: () => {
      toast.success('Build artifacts download started')
    },
    onError: (error: Error) => {
      toast.error(`Failed to download build artifacts: ${error.message}`)
    },
  }))
}

// Deployment Management hooks
export function useDeployments(options: {
  serviceId: string
  limit?: number
  offset?: number
  environment?: string
  status?: 'pending' | 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled'
}) {
  const params = {
    serviceId: options.serviceId,
    limit: options?.limit || 20,
    offset: options?.offset || 0,
    ...(options?.status && { status: options.status }),
  }

  return useQuery(orpc.deployment.list.queryOptions({
    input: params,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useDeployment(deploymentId: string) {
  return useQuery(orpc.deployment.getStatus.queryOptions({
    input: { deploymentId },
    enabled: !!deploymentId,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useTriggerDeployment() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.deployment.trigger.mutationOptions({
    onSuccess: (_data, variables) => {
      // Invalidate with the serviceId from the variables
      if ('serviceId' in variables) {
        queryClient.invalidateQueries({ 
          queryKey: orpc.deployment.list.queryKey({ 
            input: { serviceId: variables.serviceId, limit: 20, offset: 0 } 
          }) 
        })
      }
      toast.success('Deployment triggered successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to trigger deployment: ${error.message}`)
    },
  }))
}

export function useStopDeployment() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.deployment.cancel.mutationOptions({
    onSuccess: () => {
      // Invalidate all deployment lists since we don't know which service
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === 'deployment' && query.queryKey[1] === 'list'
      })
      toast.success('Deployment stopped successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to stop deployment: ${error.message}`)
    },
  }))
}

export function useRollbackDeployment() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.deployment.rollback.mutationOptions({
    onSuccess: () => {
      // Invalidate all deployment lists since we don't know which service
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === 'deployment' && query.queryKey[1] === 'list'
      })
      toast.success('Deployment rolled back successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to rollback deployment: ${error.message}`)
    },
  }))
}

// Webhook Management hooks
export function useWebhooks(options?: {
  limit?: number
  offset?: number
}) {
  const params = {
    limit: options?.limit || 20,
    offset: options?.offset || 0,
  }

  return useQuery(orpc.ciCd.webhook.listWebhooks.queryOptions({
    input: params,
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useWebhook(webhookId: string) {
  return useQuery(orpc.ciCd.webhook.getWebhook.queryOptions({
    input: { id: webhookId },
    enabled: !!webhookId,
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useCreateWebhook() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.ciCd.webhook.createWebhook.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.ciCd.webhook.listWebhooks.queryKey({ input: {} }) })
      toast.success('Webhook created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create webhook: ${error.message}`)
    },
  }))
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.ciCd.webhook.updateWebhook.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.ciCd.webhook.listWebhooks.queryKey({ input: {} }) })
      toast.success('Webhook updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update webhook: ${error.message}`)
    },
  }))
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.ciCd.webhook.deleteWebhook.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.ciCd.webhook.listWebhooks.queryKey({ input: {} }) })
      toast.success('Webhook deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete webhook: ${error.message}`)
    },
  }))
}

export function useTestWebhook() {
  return useMutation(orpc.ciCd.webhook.testWebhook.mutationOptions({
    onSuccess: () => {
      toast.success('Webhook test completed')
    },
    onError: (error: Error) => {
      toast.error(`Webhook test failed: ${error.message}`)
    },
  }))
}

// CI/CD Overview hook
export function useCICDOverview(options?: {
  projectId?: string
  timeRange?: 'day' | 'week' | 'month' | 'quarter'
}) {
  const params = {
    ...(options?.projectId && { projectId: options.projectId }),
    timeRange: options?.timeRange || 'week',
  }

  return useQuery(orpc.ciCd.getOverview.queryOptions({
    input: params,
    staleTime: 1000 * 60 * 5, // 5 minutes
  }))
}

// Utility hooks for CI/CD actions
export function useCICDActions() {
  const createPipeline = useCreatePipeline()
  const updatePipeline = useUpdatePipeline()
  const deletePipeline = useDeletePipeline()
  const triggerPipeline = useTriggerPipeline()
  const stopPipeline = useStopPipeline()
  
  const retryPipelineRun = useRetryPipelineRun()
  const cancelPipelineRun = useCancelPipelineRun()
  
  const triggerBuild = useTriggerBuild()
  const stopBuild = useStopBuild()
  const downloadBuildArtifacts = useDownloadBuildArtifacts()
  
  const triggerDeployment = useTriggerDeployment()
  const stopDeployment = useStopDeployment()
  const rollbackDeployment = useRollbackDeployment()
  
  const createWebhook = useCreateWebhook()
  const updateWebhook = useUpdateWebhook()
  const deleteWebhook = useDeleteWebhook()
  const testWebhook = useTestWebhook()

  return {
    // Pipeline actions
    createPipeline: createPipeline.mutate,
    updatePipeline: updatePipeline.mutate,
    deletePipeline: deletePipeline.mutate,
    triggerPipeline: triggerPipeline.mutate,
    stopPipeline: stopPipeline.mutate,
    
    // Pipeline run actions
    retryPipelineRun: retryPipelineRun.mutate,
    cancelPipelineRun: cancelPipelineRun.mutate,
    
    // Build actions
    triggerBuild: triggerBuild.mutate,
    stopBuild: stopBuild.mutate,
    downloadBuildArtifacts: downloadBuildArtifacts.mutate,
    
    // Deployment actions
    triggerDeployment: triggerDeployment.mutate,
    stopDeployment: stopDeployment.mutate,
    rollbackDeployment: rollbackDeployment.mutate,
    
    // Webhook actions
    createWebhook: createWebhook.mutate,
    updateWebhook: updateWebhook.mutate,
    deleteWebhook: deleteWebhook.mutate,
    testWebhook: testWebhook.mutate,
    
    isLoading: {
      createPipeline: createPipeline.isPending,
      updatePipeline: updatePipeline.isPending,
      deletePipeline: deletePipeline.isPending,
      triggerPipeline: triggerPipeline.isPending,
      stopPipeline: stopPipeline.isPending,
      
      retryPipelineRun: retryPipelineRun.isPending,
      cancelPipelineRun: cancelPipelineRun.isPending,
      
      triggerBuild: triggerBuild.isPending,
      stopBuild: stopBuild.isPending,
      downloadBuildArtifacts: downloadBuildArtifacts.isPending,
      
      triggerDeployment: triggerDeployment.isPending,
      stopDeployment: stopDeployment.isPending,
      rollbackDeployment: rollbackDeployment.isPending,
      
      createWebhook: createWebhook.isPending,
      updateWebhook: updateWebhook.isPending,
      deleteWebhook: deleteWebhook.isPending,
      testWebhook: testWebhook.isPending,
    }
  }
}

// Comprehensive CI/CD dashboard hook
export function useCICDDashboard(options?: { serviceId?: string }) {
  const pipelines = usePipelines()
  const pipelineRuns = usePipelineRuns({ limit: 10 })
  const builds = useBuilds({ limit: 10 })
  const deployments = options?.serviceId ? useDeployments({ serviceId: options.serviceId, limit: 10 }) : null
  const webhooks = useWebhooks()
  const overview = useCICDOverview()

  const isLoading = pipelines.isLoading || pipelineRuns.isLoading || 
                   builds.isLoading || webhooks.isLoading || overview.isLoading ||
                   (deployments ? deployments.isLoading : false)

  const hasError = pipelines.error || pipelineRuns.error || 
                  builds.error || webhooks.error || overview.error ||
                  (deployments ? deployments.error : false)

  return {
    data: {
      pipelines: pipelines.data,
      pipelineRuns: pipelineRuns.data,
      builds: builds.data,
      deployments: deployments?.data,
      webhooks: webhooks.data,
      overview: overview.data,
    },
    isLoading,
    error: hasError,
    refetch: () => {
      pipelines.refetch()
      pipelineRuns.refetch()
      builds.refetch()
      deployments?.refetch()
      webhooks.refetch()
      overview.refetch()
    }
  }
}