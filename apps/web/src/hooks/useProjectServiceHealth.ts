'use client'

import { useServices } from '@/hooks/useServices'
import { useQueries } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'

export type ProjectServiceHealthSummary = {
  totalServices: number
  healthyServices: number
  unhealthyServices: number
  unknownServices: number
  startingServices: number
  hasErrors: boolean
  overallStatus: 'healthy' | 'unhealthy' | 'unknown' | 'starting' | 'mixed'
}

/**
 * Hook to aggregate service health status for a project
 * @param projectId - The project ID to check services for
 * @returns ProjectServiceHealthSummary with aggregated health information
 */
export function useProjectServiceHealth(projectId: string): {
  data: ProjectServiceHealthSummary | undefined
  isLoading: boolean
  error: Error | null
} {
  // Get all services for the project
  const { data: servicesResponse, isLoading: servicesLoading, error: servicesError } = useServices(projectId, {
    isActive: true, // Only check active services
    limit: 100, // Reasonable limit for services per project
  })

  const services = servicesResponse?.services || []

  // Get health status for all services
  const healthQueries = useQueries({
    queries: services.map((service) => 
      orpc.service.getHealth.queryOptions({
        input: { id: service.id },
        enabled: !!service.id,
        staleTime: 1000 * 15, // 15 seconds
        retry: 1, // Don't retry too much for health checks
      })
    ),
  })

  const isLoading = servicesLoading || healthQueries.some(query => query.isLoading)
  const error = servicesError || healthQueries.find(query => query.error)?.error || null

  // Aggregate health data
  const data: ProjectServiceHealthSummary | undefined = (() => {
    if (isLoading || error) return undefined

    const totalServices = services.length
    let healthyServices = 0
    let unhealthyServices = 0
    let unknownServices = 0
    let startingServices = 0

    healthQueries.forEach((query) => {
      if (query.data) {
        switch (query.data.status) {
          case 'healthy':
            healthyServices++
            break
          case 'unhealthy':
            unhealthyServices++
            break
          case 'starting':
            startingServices++
            break
          case 'unknown':
          default:
            unknownServices++
            break
        }
      } else {
        // If no health data, consider it unknown
        unknownServices++
      }
    })

    const hasErrors = unhealthyServices > 0

    // Determine overall status
    let overallStatus: ProjectServiceHealthSummary['overallStatus']
    if (totalServices === 0) {
      overallStatus = 'unknown'
    } else if (unhealthyServices > 0) {
      overallStatus = 'unhealthy'
    } else if (startingServices > 0) {
      overallStatus = 'starting'
    } else if (healthyServices === totalServices) {
      overallStatus = 'healthy'
    } else if (healthyServices > 0 && unknownServices > 0) {
      overallStatus = 'mixed'
    } else {
      overallStatus = 'unknown'
    }

    return {
      totalServices,
      healthyServices,
      unhealthyServices,
      unknownServices,
      startingServices,
      hasErrors,
      overallStatus,
    }
  })()

  return {
    data,
    isLoading,
    error: error as Error | null,
  }
}

/**
 * Hook to get health status for multiple projects
 * @param projectIds - Array of project IDs to check
 * @returns Map of project ID to health summary
 */
export function useMultipleProjectsServiceHealth(projectIds: string[]): {
  data: Map<string, ProjectServiceHealthSummary>
  isLoading: boolean
  error: Error | null
} {
  // Get health for all projects
  const projectHealthQueries = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: ['projectServiceHealth', projectId],
      queryFn: async () => {
        // This would normally be a more complex aggregation
        // For now, we'll return a placeholder
        return { projectId, summary: { totalServices: 0, healthyServices: 0, unhealthyServices: 0, unknownServices: 0, startingServices: 0, hasErrors: false, overallStatus: 'unknown' as const } }
      },
      enabled: !!projectId,
      staleTime: 1000 * 30, // 30 seconds
    }))
  })

  const isLoading = projectHealthQueries.some(query => query.isLoading)
  const error = projectHealthQueries.find(query => query.error)?.error || null

  const data = new Map<string, ProjectServiceHealthSummary>()
  projectHealthQueries.forEach((query, index) => {
    if (query.data) {
      data.set(projectIds[index], query.data.summary)
    }
  })

  return {
    data,
    isLoading,
    error: error as Error | null,
  }
}