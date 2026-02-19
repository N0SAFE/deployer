'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'

/**
 * Health monitoring hooks for system health checking and diagnostics
 * 
 * These hooks provide comprehensive health monitoring capabilities:
 * - Basic health checks for availability monitoring
 * - Detailed system diagnostics with dependency status
 * - Real-time health status updates
 */

// Basic health check hook
export function useHealthCheck(options?: {
  refetchInterval?: number
  enabled?: boolean
}) {
  return useQuery(orpc.health.check.queryOptions({
    input: {},
    refetchInterval: options?.refetchInterval ?? 30000, // Default: 30 seconds
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 10, // 10 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
  }))
}

// Detailed health check hook with comprehensive system information
export function useDetailedHealth(options?: {
  refetchInterval?: number
  enabled?: boolean
}) {
  return useQuery(orpc.health.detailed.queryOptions({
    input: {},
    refetchInterval: options?.refetchInterval ?? 60000, // Default: 1 minute
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 15, // 15 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
  }))
}

// Hook for dashboard health overview
export function useSystemHealthOverview() {
  const basicHealth = useHealthCheck({ refetchInterval: 15000 }) // 15 seconds
  const detailedHealth = useDetailedHealth({ refetchInterval: 30000 }) // 30 seconds
  
  return {
    basic: basicHealth.data,
    detailed: detailedHealth.data,
    isLoading: basicHealth.isLoading || detailedHealth.isLoading,
    isError: basicHealth.isError || detailedHealth.isError,
    error: basicHealth.error || detailedHealth.error,
    lastUpdated: Math.max(
      basicHealth.dataUpdatedAt || 0,
      detailedHealth.dataUpdatedAt || 0
    ),
    refetch: () => {
      basicHealth.refetch()
      detailedHealth.refetch()
    }
  }
}

// Hook for monitoring critical system components
export function useSystemHealthMonitoring(options?: {
  onHealthChange?: (isHealthy: boolean) => void
  enableNotifications?: boolean
}) {
  const health = useDetailedHealth({
    refetchInterval: 10000, // 10 seconds for monitoring
  })

  // Monitor health status changes
  if (health.data && options?.onHealthChange) {
    const isHealthy = health.data.status === 'healthy' && 
                     health.data.database.status === 'healthy'
    options.onHealthChange(isHealthy)
  }

  return {
    status: health.data?.status || 'unknown',
    database: health.data?.database || { status: 'unknown', timestamp: '', responseTime: 0 },
    memory: health.data?.memory || { used: 0, free: 0, total: 0 },
    uptime: health.data?.uptime || 0,
    timestamp: health.data?.timestamp || '',
    service: health.data?.service || 'unknown',
    isLoading: health.isLoading,
    isError: health.isError,
    error: health.error,
    refetch: health.refetch,
    // Computed health indicators
    isHealthy: health.data?.status === 'healthy' && 
               health.data?.database?.status === 'healthy',
    memoryUsagePercent: health.data?.memory ? 
      Math.round((health.data.memory.used / health.data.memory.total) * 100) : 0,
    isDatabaseHealthy: health.data?.database?.status === 'healthy',
    databaseResponseTime: health.data?.database?.responseTime || 0,
  }
}

// Hook for health status indicators in UI components
export function useHealthIndicators() {
  const health = useHealthCheck({ refetchInterval: 20000 })
  
  return {
    status: health.data?.status || 'unknown',
    isOnline: health.data?.status === 'healthy',
    lastCheck: health.dataUpdatedAt,
    isChecking: health.isFetching,
    hasError: health.isError,
    timestamp: health.data?.timestamp,
    service: health.data?.service,
    // Visual indicator helpers
    statusColor: health.data?.status === 'healthy' ? 'green' : 
                health.isError ? 'red' : 'yellow',
    statusIcon: health.data?.status === 'healthy' ? 'check-circle' : 
               health.isError ? 'x-circle' : 'clock',
    statusText: health.data?.status === 'healthy' ? 'Healthy' :
               health.isError ? 'Error' : 'Checking...',
  }
}

// Utility hook for triggering manual health checks
export function useHealthActions() {
  const queryClient = useQueryClient()
  
  const refreshHealth = () => {
    // Invalidate both health endpoints
    queryClient.invalidateQueries({ 
      queryKey: orpc.health.check.queryKey({ input: {} }) 
    })
    queryClient.invalidateQueries({ 
      queryKey: orpc.health.detailed.queryKey({ input: {} }) 
    })
  }

  const resetHealthCache = () => {
    // Remove health data from cache to force fresh requests
    queryClient.removeQueries({ 
      queryKey: orpc.health.check.queryKey({ input: {} }) 
    })
    queryClient.removeQueries({ 
      queryKey: orpc.health.detailed.queryKey({ input: {} }) 
    })
  }

  return {
    refreshHealth,
    resetHealthCache,
  }
}

// Hook for health-based conditional rendering
export function useHealthGate(options?: {
  requireHealthy?: boolean
  fallbackComponent?: React.ComponentType
}) {
  const health = useHealthCheck()
  
  const isHealthy = health.data?.status === 'healthy'
  const shouldRender = options?.requireHealthy ? isHealthy : true
  
  return {
    shouldRender,
    isHealthy,
    isLoading: health.isLoading,
    isError: health.isError,
    health: health.data,
    fallbackComponent: options?.fallbackComponent,
  }
}

// Comprehensive health dashboard hook
export function useHealthDashboard() {
  const basicHealth = useHealthCheck({ refetchInterval: 15000 })
  const detailedHealth = useDetailedHealth({ refetchInterval: 30000 })
  
  const isLoading = basicHealth.isLoading || detailedHealth.isLoading
  const hasError = basicHealth.isError || detailedHealth.isError
  const error = basicHealth.error || detailedHealth.error

  return {
    data: {
      basic: basicHealth.data,
      detailed: detailedHealth.data,
    },
    isLoading,
    error: hasError ? error : null,
    // Computed dashboard metrics
    systemStatus: detailedHealth.data?.status || 'unknown',
    uptime: detailedHealth.data?.uptime || 0,
    memoryUsage: detailedHealth.data?.memory,
    databaseHealth: detailedHealth.data?.database,
    lastHealthCheck: Math.max(
      basicHealth.dataUpdatedAt || 0,
      detailedHealth.dataUpdatedAt || 0
    ),
    // Dashboard actions
    refresh: () => {
      basicHealth.refetch()
      detailedHealth.refetch()
    },
    // Health summary for quick overview
    summary: {
      isSystemHealthy: detailedHealth.data?.status === 'healthy',
      isDatabaseHealthy: detailedHealth.data?.database?.status === 'healthy',
      memoryUsagePercent: detailedHealth.data?.memory ? 
        Math.round((detailedHealth.data.memory.used / detailedHealth.data.memory.total) * 100) : 0,
      uptimeHours: detailedHealth.data?.uptime ? 
        Math.round(detailedHealth.data.uptime / 3600) : 0,
      databaseResponseTime: detailedHealth.data?.database?.responseTime || 0,
    }
  }
}

// Export types for use in components
export type HealthStatus = 'healthy' | 'unhealthy' | 'degraded' | 'unknown'
export type SystemHealth = ReturnType<typeof useSystemHealthOverview>
export type HealthDashboard = ReturnType<typeof useHealthDashboard>
export type HealthIndicators = ReturnType<typeof useHealthIndicators>