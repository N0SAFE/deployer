'use client'

import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import type { z } from 'zod'
import type { 
  UserActivitySchema,
  ActivitySummarySchema,
  GetActivityInputSchema
} from '@repo/api-contracts'

// Type inference from ORPC contracts
type UserActivity = z.infer<typeof UserActivitySchema>
type ActivitySummary = z.infer<typeof ActivitySummarySchema>
type GetActivityInput = z.infer<typeof GetActivityInputSchema>

// Hook to get user activity logs
export function useUserActivity(options?: GetActivityInput) {
  return useQuery(orpc.analytics.getUserActivity.queryOptions({
    input: options,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

// Hook to get activity summary
export function useActivitySummary(options?: {
  period?: 'hour' | 'day' | 'week' | 'month'
  granularity?: 'hour' | 'day' | 'week'  
  limit?: number
}) {
  return useQuery(orpc.analytics.getActivitySummary.queryOptions({
    input: options,
    staleTime: 1000 * 60, // 1 minute
  }))
}

// Hook to get project activity (filtered by project)
export function useProjectActivity(projectId: string, options?: Omit<GetActivityInput, 'resource'>) {
  const activityOptions = {
    ...options,
    resource: `project:${projectId}`, // Filter by project resource
    limit: options?.limit || 10,
  }

  return useQuery(orpc.analytics.getUserActivity.queryOptions({
    input: activityOptions,
    enabled: !!projectId,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

// Hook to get recent activity for dashboard
export function useRecentActivity(limit = 5) {
  return useQuery(orpc.analytics.getUserActivity.queryOptions({
    input: {
      timeRange: '1d',
      limit,
      offset: 0,
    },
    staleTime: 1000 * 30, // 30 seconds
  }))
}

// Hook to get user activity for a specific user
export function useUserActivityById(userId: string, options?: Omit<GetActivityInput, 'userId'>) {
  return useQuery(orpc.analytics.getUserActivity.queryOptions({
    input: {
      ...options,
      userId,
      limit: options?.limit || 20,
    },
    enabled: !!userId,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

// Hook to get activity for specific actions
export function useActivityByAction(action: string, options?: Omit<GetActivityInput, 'action'>) {
  return useQuery(orpc.analytics.getUserActivity.queryOptions({
    input: {
      ...options,
      action,
      limit: options?.limit || 20,
    },
    enabled: !!action,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

// Hook to get deployment activity
export function useDeploymentActivity(options?: Omit<GetActivityInput, 'action'>) {
  return useQuery(orpc.analytics.getUserActivity.queryOptions({
    input: {
      ...options,
      action: 'deployment',
      limit: options?.limit || 20,
    },
    staleTime: 1000 * 30, // 30 seconds
  }))
}

// Utility hook for activity feed with real-time updates
export function useActivityFeed(options?: {
  projectId?: string
  userId?: string
  limit?: number
  autoRefresh?: boolean
}) {
  const { projectId, userId, limit = 10, autoRefresh = true } = options || {}

  const queryOptions = {
    timeRange: '7d' as const,
    limit,
    offset: 0,
    ...(projectId && { resource: `project:${projectId}` }),
    ...(userId && { userId }),
  }

  return useQuery(orpc.analytics.getUserActivity.queryOptions({
    input: queryOptions,
    staleTime: autoRefresh ? 1000 * 15 : 1000 * 60, // 15s if auto-refresh, 1m otherwise
    refetchInterval: autoRefresh ? 15000 : false, // Auto-refresh every 15 seconds if enabled
  }))
}

// Export types for use in components
export type { UserActivity, ActivitySummary, GetActivityInput }