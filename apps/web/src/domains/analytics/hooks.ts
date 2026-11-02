'use client'

import { useQuery, useMutation } from '@tanstack/react-query'

import { analyticsEndpoints } from './endpoints'

import type { TimeRange, Granularity, ResourceKind, AggregationKind } from './types'

type DeploymentTimeRange = '1d' | '3d' | '7d' | '30d' | '90d'
type StorageTimeRange = '1d' | '7d' | '30d' | '90d'
type StorageBreakdown = 'project' | 'service' | 'type' | 'user'

// ─── Real-time Metrics ───────────────────────────────────────────────

/**
 * Live metrics — SSE, not polling.
 *
 * The `…Stream` sibling takes the same input and pushes only when the payload
 * changes, so the tab holds one connection instead of refetching every 10 s
 * whether or not anything moved. No `refetchInterval`: the transport reconnects
 * and replays on its own.
 */
export function useRealTimeMetrics(services?: string[]) {
  return useQuery({
    ...analyticsEndpoints.getRealTimeMetricsStream.experimental_liveObservableOptions({
      input: { query: services ? { services } : undefined },
    }),
  })
}

// ─── Resource Metrics ────────────────────────────────────────────────

export function useResourceMetrics(timeRange: TimeRange, granularity: Granularity) {
  return useQuery({
    ...analyticsEndpoints.getResourceMetricsStream.experimental_liveObservableOptions({
      input: { query: { timeRange, granularity } },
    }),
  })
}

export function useResourceUsage(timeRange: TimeRange, resource: ResourceKind, aggregation: AggregationKind) {
  return useQuery({
    ...analyticsEndpoints.getResourceUsageStream.experimental_liveObservableOptions({
      input: { query: { timeRange, resource, aggregation } },
    }),
  })
}

// ─── Deployment Metrics ──────────────────────────────────────────────

export function useDeploymentMetrics(timeRange: TimeRange, granularity: Granularity, services?: string[]) {
  return useQuery({
    ...analyticsEndpoints.getDeploymentMetricsStream.experimental_liveObservableOptions({
      input: { query: { timeRange, granularity, services } },
    }),
  })
}

export function useDeploymentUsage(timeRange: DeploymentTimeRange, projectId?: string) {
  return useQuery({
    ...analyticsEndpoints.getDeploymentUsageStream.experimental_liveObservableOptions({
      input: { query: { timeRange, projectId } },
    }),
  })
}

// ─── Service Health ──────────────────────────────────────────────────

export function useServiceHealth(services?: string[]) {
  return useQuery({
    ...analyticsEndpoints.getServiceHealthStream.experimental_liveObservableOptions({
      input: { query: { services } },
    }),
  })
}

// ─── Application / Database (honest empty until wired) ───────────────

export function useApplicationMetrics(timeRange: TimeRange, granularity: Granularity) {
  return useQuery({
    ...analyticsEndpoints.getApplicationMetrics.queryOptions({
      input: { query: { timeRange, granularity } },
    }),
  })
}

export function useDatabaseMetrics(timeRange: TimeRange, granularity: Granularity) {
  return useQuery({
    ...analyticsEndpoints.getDatabaseMetrics.queryOptions({
      input: { query: { timeRange, granularity } },
    }),
  })
}

// ─── Storage ─────────────────────────────────────────────────────────

export function useStorageUsage(timeRange: StorageTimeRange, breakdown: StorageBreakdown) {
  return useQuery({
    ...analyticsEndpoints.getStorageUsage.queryOptions({
      input: { query: { timeRange, breakdown } },
    }),
  })
}

// ─── Reports ─────────────────────────────────────────────────────────

export function useReportList(limit = 20, offset = 0) {
  return useQuery({
    ...analyticsEndpoints.listReports.queryOptions({
      input: { query: { limit, offset } },
    }),
  })
}

export function useReport(reportId: string) {
  return useQuery({
    ...analyticsEndpoints.getReport.queryOptions({
      input: { params: { reportId } },
    }),
    enabled: !!reportId,
  })
}

export function useGenerateReport() {
  return useMutation(analyticsEndpoints.generateReport.mutationOptions())
}

export function useDeleteReport() {
  return useMutation(analyticsEndpoints.deleteReport.mutationOptions())
}

export function useDownloadReport() {
  return useMutation(analyticsEndpoints.downloadReport.mutationOptions())
}

// ─── Report Configs ──────────────────────────────────────────────────

export function useReportConfigList(limit = 20, offset = 0) {
  return useQuery({
    ...analyticsEndpoints.listReportConfigs.queryOptions({
      input: { query: { limit, offset } },
    }),
  })
}

export function useCreateReportConfig() {
  return useMutation(analyticsEndpoints.createReportConfig.mutationOptions())
}

export function useDeleteReportConfig() {
  return useMutation(analyticsEndpoints.deleteReportConfig.mutationOptions())
}
