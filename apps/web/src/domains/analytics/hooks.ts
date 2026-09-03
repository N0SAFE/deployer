'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { analyticsEndpoints } from './endpoints'
import type { TimeRange, Granularity, ResourceKind, AggregationKind } from './types'

type DeploymentTimeRange = '1d' | '3d' | '7d' | '30d' | '90d'
type StorageTimeRange = '1d' | '7d' | '30d' | '90d'
type StorageBreakdown = 'project' | 'service' | 'type' | 'user'

// ─── Real-time Metrics ───────────────────────────────────────────────

export function useRealTimeMetrics(services?: string[]) {
  return useQuery({
    ...analyticsEndpoints.getRealTimeMetrics.queryOptions({
      input: { query: services ? { services } : undefined },
    }),
    refetchInterval: 10_000,
  })
}

// ─── Resource Metrics ────────────────────────────────────────────────

export function useResourceMetrics(timeRange: TimeRange, granularity: Granularity) {
  return useQuery({
    ...analyticsEndpoints.getResourceMetrics.queryOptions({
      input: { query: { timeRange, granularity } },
    }),
    refetchInterval: 30_000,
  })
}

export function useResourceUsage(timeRange: TimeRange, resource: ResourceKind, aggregation: AggregationKind) {
  return useQuery({
    ...analyticsEndpoints.getResourceUsage.queryOptions({
      input: { query: { timeRange, resource, aggregation } },
    }),
    refetchInterval: 30_000,
  })
}

// ─── Deployment Metrics ──────────────────────────────────────────────

export function useDeploymentMetrics(timeRange: TimeRange, granularity: Granularity, services?: string[]) {
  return useQuery({
    ...analyticsEndpoints.getDeploymentMetrics.queryOptions({
      input: { query: { timeRange, granularity, services } },
    }),
    refetchInterval: 60_000,
  })
}

export function useDeploymentUsage(timeRange: DeploymentTimeRange, projectId?: string) {
  return useQuery({
    ...analyticsEndpoints.getDeploymentUsage.queryOptions({
      input: { query: { timeRange, projectId } },
    }),
    refetchInterval: 60_000,
  })
}

// ─── Service Health ──────────────────────────────────────────────────

export function useServiceHealth(services?: string[]) {
  return useQuery({
    ...analyticsEndpoints.getServiceHealth.queryOptions({
      input: { query: { services } },
    }),
    refetchInterval: 15_000,
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
