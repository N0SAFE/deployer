'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useMemo, useState } from 'react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@repo/ui/components/shadcn/chart'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { Activity, AlertTriangle, CheckCircle2, Cpu, Database, HardDrive, Network, RefreshCw, Rocket, Server, XCircle } from 'lucide-react'
import { PageHeader, PageLoadingState, PageErrorState, StatStrip, StatStripItem } from '@/components/dashboard'
import type { TimeRange, Granularity } from '@/domains/analytics/types'
import {
  useRealTimeMetrics,
  useResourceMetrics,
  useDeploymentMetrics,
  useServiceHealth,
  useDeploymentUsage,
} from '@/domains/analytics/hooks'

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  '1h': 'Last hour',
  '6h': 'Last 6 hours',
  '12h': 'Last 12 hours',
  '1d': 'Last 24 hours',
  '3d': 'Last 3 days',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '1y': 'Last year',
}

const resourceChartConfig = {
  cpu: { label: 'CPU %', color: 'var(--chart-1)' },
  memory: { label: 'Memory %', color: 'var(--chart-2)' },
  disk: { label: 'Disk %', color: 'var(--chart-3)' },
} satisfies ChartConfig

const deploymentChartConfig = {
  deployments: { label: 'Deployments', color: 'var(--chart-1)' },
  rollbacks: { label: 'Rollbacks', color: 'var(--chart-4)' },
  successRate: { label: 'Success Rate %', color: 'var(--chart-2)' },
} satisfies ChartConfig

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

function DataSourceBadge({ source }: { source: string }) {
  if (source === 'unavailable') {
    return <Badge variant="outline" className="text-muted-foreground border-dashed">No data source</Badge>
  }
  return <Badge variant="secondary">{source}</Badge>
}

function HealthDot({ status }: { status: string }) {
  if (status === 'healthy') return <CheckCircle2 className="size-4 text-green-500" />
  if (status === 'degraded') return <AlertTriangle className="size-4 text-yellow-500" />
  if (status === 'unhealthy') return <XCircle className="size-4 text-red-500" />
  return <Server className="size-4 text-muted-foreground" />
}

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('1d')
  const [granularity, setGranularity] = useState<Granularity>('hour')

  const realTime = useRealTimeMetrics()
  const resourceMetrics = useResourceMetrics(timeRange, granularity)
  const deploymentMetrics = useDeploymentMetrics(timeRange, granularity)
  const serviceHealth = useServiceHealth()
  const deploymentTimeRange = ['1d', '3d', '7d', '30d', '90d'].includes(timeRange) ? (timeRange as '1d' | '3d' | '7d' | '30d' | '90d') : '30d'
  const deploymentUsage = useDeploymentUsage(deploymentTimeRange)

  const isLoading = realTime.isLoading || resourceMetrics.isLoading || deploymentMetrics.isLoading
  const error = realTime.error || resourceMetrics.error || deploymentMetrics.error

  /**
   * One definition of "refresh everything".
   *
   * The toolbar button refreshed four queries while the error retry refreshed
   * three — the same intent expressed twice, so they drifted. `serviceHealth`
   * was the one left out, which meant recovering from an error could leave the
   * health column showing the state that failed.
   */
  const refreshAll = () => {
    void realTime.refetch()
    void resourceMetrics.refetch()
    void deploymentMetrics.refetch()
    void serviceHealth.refetch()
  }

  /** Any in-flight refresh — the button reports it instead of looking inert. */
  const isRefreshing =
    realTime.isFetching ||
    resourceMetrics.isFetching ||
    deploymentMetrics.isFetching ||
    serviceHealth.isFetching

  // ── ALL hooks must be called before any early return ──────────────────
  const rt = realTime.data
  const rm = resourceMetrics.data
  const dm = deploymentMetrics.data
  const health = serviceHealth.data
  const usage = deploymentUsage.data

  const resourceData = useMemo(() => {
    if (!rm?.data?.length) return []
    return rm.data.map((d) => ({
      timestamp: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      cpu: d.cpu.usage,
      memory: d.memory.percentage,
      disk: d.disk.percentage,
    }))
  }, [rm])

  const deploymentData = useMemo(() => {
    if (!dm?.data?.length) return []
    return dm.data.map((d) => ({
      timestamp: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      deployments: d.deploymentsCount,
      rollbacks: d.rollbackCount,
      successRate: d.successRate,
    }))
  }, [dm])

  const summary = usage?.summary

  if (isLoading) return <PageLoadingState />
  if (error) return <PageErrorState title="Failed to load analytics" message={isDefinedORPCError(error) ? getErrorMessage(error, "Failed to load analytics") : UNKNOWN_ORPC_ERROR_MESSAGE} onRetry={refreshAll} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Analytics" description="Platform resource usage and deployment metrics" />
        <div className="flex items-center gap-2">
          <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
            <SelectTrigger className="w-[160px]" aria-label="Time range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TIME_RANGE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
            <SelectTrigger className="w-[120px]" aria-label="Granularity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minute">Minute</SelectItem>
              <SelectItem value="hour">Hour</SelectItem>
              <SelectItem value="day">Day</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            onClick={refreshAll}
            aria-label="Refresh analytics"
            title="Refresh analytics"
          >
            <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* ─── Live System Strip ──────────────────────────────────────── */}
      <StatStrip>
        <StatStripItem
          icon={Cpu}
          label="CPU"
          value={rt ? `${rt.system.cpu.toFixed(1)}%` : '—'}
          hint={rt?.dataSource === 'docker' ? `${rt.services.length} services` : 'No data'}
        />
        <StatStripItem
          icon={HardDrive}
          label="Memory"
          value={rt ? `${rt.system.memory.toFixed(1)}%` : '—'}
          hint={rt ? `${rt.system.disk.toFixed(1)}% disk` : undefined}
        />
        <StatStripItem
          icon={Network}
          label="Inbound"
          value={rt ? formatBytes(rt.system.network.inbound) : '—'}
          hint={rt ? `↑ ${formatBytes(rt.system.network.outbound)}` : undefined}
        />
        <StatStripItem
          icon={Rocket}
          label="Deployments"
          value={String(summary?.totalDeployments ?? dm?.data?.reduce((s, b) => s + b.deploymentsCount, 0) ?? 0)}
          hint={`${summary?.successRate ?? dm?.data?.[0]?.successRate ?? 0}% success`}
        />
      </StatStrip>

      {/* ─── Resource Metrics Chart ─────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base">Resource Usage</CardTitle>
            <CardDescription>CPU, memory, and disk utilization over time</CardDescription>
          </div>
          <DataSourceBadge source={rm?.dataSource ?? 'unavailable'} />
        </CardHeader>
        <CardContent>
          {resourceData.length > 0 ? (
            <ChartContainer config={resourceChartConfig} className="h-75 w-full">
              <AreaChart data={resourceData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="timestamp" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="cpu" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} strokeWidth={2} />
                <Area type="monotone" dataKey="memory" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.15} strokeWidth={2} />
                <Area type="monotone" dataKey="disk" stroke="var(--chart-3)" fill="var(--chart-3)" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ChartContainer>
          ) : (
            <div className="flex items-center justify-center h-75 text-muted-foreground text-sm">
              No resource data available for this time range
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Deployment Metrics Chart ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">Deployment Activity</CardTitle>
              <CardDescription>Deployments and rollbacks per bucket</CardDescription>
            </div>
            <DataSourceBadge source={dm?.dataSource ?? 'unavailable'} />
          </CardHeader>
          <CardContent>
            {deploymentData.length > 0 ? (
              <ChartContainer config={deploymentChartConfig} className="h-62.5 w-full">
                <BarChart data={deploymentData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="timestamp" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="deployments" fill="var(--chart-1)" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="rollbacks" fill="var(--chart-4)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex items-center justify-center h-62.5 text-muted-foreground text-sm">
                No deployment data for this time range
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─── Service Health ──────────────────────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">Service Health</CardTitle>
              <CardDescription>Latest deployment status per service</CardDescription>
            </div>
            <DataSourceBadge source={health?.dataSource ?? 'unavailable'} />
          </CardHeader>
          <CardContent>
            {health?.data?.length ? (
              <div className="space-y-3">
                {health.data.map((svc) => (
                  <div key={svc.serviceName} className="flex items-center justify-between py-1.5 border-b last:border-0">
                    <div className="flex items-center gap-2">
                      <HealthDot status={svc.status} />
                      <span className="text-sm font-medium">{svc.serviceName}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>up {formatUptime(svc.uptime)}</span>
                      <Badge variant={svc.status === 'healthy' ? 'default' : svc.status === 'degraded' ? 'secondary' : 'destructive'} className="text-[10px] px-1.5">
                        {svc.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-62.5 text-muted-foreground text-sm">
                No services registered
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Deployment Usage Summary ──────────────────────────────── */}
      {summary && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Deployment Summary</CardTitle>
            <CardDescription>Aggregated over {TIME_RANGE_LABELS[timeRange] ?? timeRange}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-lg font-semibold">{summary.totalDeployments}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Success Rate</p>
                <p className="text-lg font-semibold">{summary.successRate}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Deploy Time</p>
                <p className="text-lg font-semibold">{summary.averageDeployTime > 0 ? `${Math.round(summary.averageDeployTime / 1000)}s` : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Most Active Service</p>
                <p className="text-lg font-semibold">{summary.mostActiveProjects?.[0]?.projectName ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Data Source</p>
                <p className="text-lg font-semibold">{usage?.dataSource ?? '—'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
