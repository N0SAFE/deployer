'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { toast } from 'sonner'

// Analytics Metrics hooks
export function useResourceMetrics(timeRange: '1h' | '1d' | '7d' | '30d' = '1d') {
  return useQuery(orpc.analytics.getResourceMetrics.queryOptions({
    input: {
      timeRange,
      granularity: 'hour',
    },
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useApplicationMetrics(timeRange: '1h' | '1d' | '7d' | '30d' = '1d') {
  return useQuery(orpc.analytics.getApplicationMetrics.queryOptions({
    input: {
      timeRange,
      granularity: 'hour',
    },
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useDatabaseMetrics(timeRange: '1h' | '1d' | '7d' | '30d' = '1d') {
  return useQuery(orpc.analytics.getDatabaseMetrics.queryOptions({
    input: {
      timeRange,
      granularity: 'hour',
    },
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useDeploymentMetrics(timeRange: '1h' | '1d' | '7d' | '30d' = '1d') {
  return useQuery(orpc.analytics.getDeploymentMetrics.queryOptions({
    input: {
      timeRange,
      granularity: 'hour',
    },
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useServiceHealthAnalytics(serviceId?: string) {
  return useQuery(orpc.analytics.getServiceHealth.queryOptions({
    input: {
      serviceId: serviceId || '',
      timeRange: '24h',
    },
    enabled: !!serviceId,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useRealTimeMetrics() {
  return useQuery(orpc.analytics.getRealTimeMetrics.queryOptions({
    input: {},
    refetchInterval: 5000, // Poll every 5 seconds
    staleTime: 0, // Always fresh
  }))
}

// Analytics Usage hooks
export function useResourceUsage(timeRange: '1h' | '1d' | '7d' | '30d' = '1d') {
  return useQuery(orpc.analytics.getResourceUsage.queryOptions({
    input: {
      timeRange,
    },
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useUserActivity(timeRange: '1h' | '1d' | '7d' | '30d' = '1d') {
  return useQuery(orpc.analytics.getUserActivity.queryOptions({
    input: {
      timeRange,
    },
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useActivitySummary(timeRange: '1h' | '1d' | '7d' | '30d' = '1d') {
  return useQuery(orpc.analytics.getActivitySummary.queryOptions({
    input: {
      timeRange,
    },
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useApiUsage(timeRange: '1h' | '1d' | '7d' | '30d' = '1d') {
  return useQuery(orpc.analytics.getApiUsage.queryOptions({
    input: {
      timeRange,
    },
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useDeploymentUsage(timeRange: '1d' | '7d' | '30d' = '1d') {
  return useQuery(orpc.analytics.getDeploymentUsage.queryOptions({
    input: {
      timeRange,
    },
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useStorageUsageAnalytics(timeRange: '1d' | '7d' | '30d' = '1d') {
  return useQuery(orpc.analytics.getStorageUsage.queryOptions({
    input: {
      timeRange,
    },
    staleTime: 1000 * 60, // 1 minute
  }))
}

// Analytics Reports hooks
export function useAnalyticsReports(options?: {
  limit?: number
  offset?: number
  type?: string
  status?: "pending" | "failed" | "completed" | "generating"
}) {
  const params = {
    limit: options?.limit || 20,
    offset: options?.offset || 0,
    ...(options?.type && { type: options.type }),
    ...(options?.status && { status: options.status }),
  }

  return useQuery(orpc.analytics.listReports.queryOptions({
    input: params,
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useAnalyticsReport(reportId: string) {
  return useQuery(orpc.analytics.getReport.queryOptions({
    input: { reportId },
    enabled: !!reportId,
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useGenerateAnalyticsReport() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.analytics.generateReport.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.analytics.listReports.queryKey({ input: {} }) })
      toast.success('Analytics report generation started')
    },
    onError: (error: Error) => {
      toast.error(`Failed to generate report: ${error.message}`)
    },
  }))
}

export function useDeleteAnalyticsReport() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.analytics.deleteReport.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.analytics.listReports.queryKey({ input: {} }) })
      toast.success('Analytics report deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete report: ${error.message}`)
    },
  }))
}

export function useDownloadAnalyticsReport() {
  return useMutation(orpc.analytics.downloadReport.mutationOptions({
    onSuccess: () => {
      toast.success('Report download started')
    },
    onError: (error: Error) => {
      toast.error(`Failed to download report: ${error.message}`)
    },
  }))
}

// Report Configuration hooks
export function useReportConfigs() {
  return useQuery(orpc.analytics.listReportConfigs.queryOptions({
    input: {},
    staleTime: 1000 * 60, // 1 minute
  }))
}

export function useCreateReportConfig() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.analytics.createReportConfig.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.analytics.listReportConfigs.queryKey({ input: {} }) })
      toast.success('Report configuration created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create report configuration: ${error.message}`)
    },
  }))
}

export function useUpdateReportConfig() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.analytics.updateReportConfig.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.analytics.listReportConfigs.queryKey({ input: {} }) })
      toast.success('Report configuration updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update report configuration: ${error.message}`)
    },
  }))
}

export function useDeleteReportConfig() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.analytics.deleteReportConfig.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.analytics.listReportConfigs.queryKey({ input: {} }) })
      toast.success('Report configuration deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete report configuration: ${error.message}`)
    },
  }))
}

// Utility hooks for analytics actions
export function useAnalyticsActions() {
  const generateReport = useGenerateAnalyticsReport()
  const deleteReport = useDeleteAnalyticsReport()
  const downloadReport = useDownloadAnalyticsReport()
  const createReportConfig = useCreateReportConfig()
  const updateReportConfig = useUpdateReportConfig()
  const deleteReportConfig = useDeleteReportConfig()

  return {
    generateReport: generateReport.mutate,
    deleteReport: deleteReport.mutate,
    downloadReport: downloadReport.mutate,
    createReportConfig: createReportConfig.mutate,
    updateReportConfig: updateReportConfig.mutate,
    deleteReportConfig: deleteReportConfig.mutate,
    isLoading: {
      generateReport: generateReport.isPending,
      deleteReport: deleteReport.isPending,
      downloadReport: downloadReport.isPending,
      createReportConfig: createReportConfig.isPending,
      updateReportConfig: updateReportConfig.isPending,
      deleteReportConfig: deleteReportConfig.isPending,
    }
  }
}

// Dashboard summary hook that combines multiple metrics
export function useAnalyticsDashboard(timeRange: '1h' | '1d' | '7d' | '30d' = '1d') {
  const resourceMetrics = useResourceMetrics(timeRange)
  const applicationMetrics = useApplicationMetrics(timeRange)
  const databaseMetrics = useDatabaseMetrics(timeRange)
  const deploymentMetrics = useDeploymentMetrics(timeRange)
  const userActivity = useUserActivity(timeRange)
  const apiUsage = useApiUsage(timeRange)

  const isLoading = resourceMetrics.isLoading || applicationMetrics.isLoading || 
                   databaseMetrics.isLoading || deploymentMetrics.isLoading || 
                   userActivity.isLoading || apiUsage.isLoading

  const hasError = resourceMetrics.error || applicationMetrics.error || 
                  databaseMetrics.error || deploymentMetrics.error || 
                  userActivity.error || apiUsage.error

  return {
    data: {
      resourceMetrics: resourceMetrics.data,
      applicationMetrics: applicationMetrics.data,
      databaseMetrics: databaseMetrics.data,
      deploymentMetrics: deploymentMetrics.data,
      userActivity: userActivity.data,
      apiUsage: apiUsage.data,
    },
    isLoading,
    error: hasError,
    refetch: () => {
      resourceMetrics.refetch()
      applicationMetrics.refetch()
      databaseMetrics.refetch()
      deploymentMetrics.refetch()
      userActivity.refetch()
      apiUsage.refetch()
    }
  }
}