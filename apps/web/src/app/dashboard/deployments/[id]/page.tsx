'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useState, useRef, useEffect } from 'react'
import {
  ArrowLeft,
  Clock,
  GitBranch,
  GitCommit,
  Globe,
  ExternalLink,
  MoreHorizontal,
  RotateCcw,
  XCircle,
  RefreshCw,
  Terminal,
  ChevronDown,
  ChevronUp,
  Cpu,
  HardDrive,
  Activity,
  AlertTriangle,
  Timer,
  Server,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@repo/ui/components/shadcn/collapsible'
import { useDeploymentDetail, type DeploymentLog } from '@/hooks/useDeploymentDetail'
import { formatRelativeTime, formatDuration, formatCommitHash, formatPercent } from '@/lib/format'
import { StatCard, DeploymentStatusBadge, SimpleBarChart } from '@/components/dashboard'

export default function DeploymentDetailPage() {
  const params = useParams()
  const deploymentId = params.id as string
  const { data: deployment, isLoading, error } = useDeploymentDetail(deploymentId)
  const [logsExpanded, setLogsExpanded] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll logs when new entries appear
  useEffect(() => {
    if (logsExpanded && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [deployment?.logs, logsExpanded])

  if (isLoading) {
    return <DeploymentDetailSkeleton />
  }

  if (error || !deployment) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/deployments">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Deployments
            </Button>
          </Link>
        </div>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">
              Failed to load deployment. It may not exist or you don&apos;t have access.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const isInProgress = ['pending', 'building', 'deploying'].includes(deployment.status)

  const logLevelColors: Record<string, string> = {
    info: 'text-blue-400',
    warn: 'text-yellow-400',
    error: 'text-red-400',
    debug: 'text-muted-foreground',
  }

  const metricsData = [
    { label: 'CPU', value: deployment.metrics.cpuUsage ?? 0, color: '#3b82f6' },
    { label: 'Memory', value: Math.min((deployment.metrics.memoryUsage ?? 0) / 5, 100), color: '#10b981' },
    { label: 'Errors', value: (deployment.metrics.errorRate ?? 0) * 100, color: '#ef4444' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <Link href="/dashboard/deployments">
            <Button variant="ghost" size="icon" className="mt-1">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">
                {deployment.service.name}
              </h1>
              <DeploymentStatusBadge status={deployment.status} />
              {isInProgress && (
                <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <Link
                href={`/dashboard/projects/${deployment.projectId}`}
                className="hover:text-foreground transition-colors"
              >
                {deployment.project.name}
              </Link>
              <span>•</span>
              <Badge variant="outline">{deployment.environment}</Badge>
              {deployment.version && (
                <>
                  <span>•</span>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                    {deployment.version}
                  </code>
                </>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                Started {formatRelativeTime(deployment.createdAt)}
              </span>
              {deployment.deployedBy && (
                <>
                  <span>•</span>
                  <span>by {deployment.deployedBy}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-12 md:ml-0">
          {deployment.url && (
            <a href={deployment.url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                <Globe className="h-4 w-4 mr-2" />
                Preview
                <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </a>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Actions
                <MoreHorizontal className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <RefreshCw className="h-4 w-4 mr-2" />
                Redeploy
              </DropdownMenuItem>
              <DropdownMenuItem>
                <RotateCcw className="h-4 w-4 mr-2" />
                Rollback
              </DropdownMenuItem>
              {isInProgress && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive">
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel Deployment
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Build Duration"
          value={deployment.buildDuration ? formatDuration(deployment.buildDuration) : '-'}
          icon={Timer}
        />
        <StatCard
          title="Deploy Duration"
          value={deployment.deployDuration ? formatDuration(deployment.deployDuration) : '-'}
          icon={Server}
        />
        <StatCard
          title="Total Duration"
          value={deployment.totalDuration ? formatDuration(deployment.totalDuration) : '-'}
          icon={Clock}
        />
        <StatCard
          title="Cluster"
          value={deployment.cluster ?? 'Default'}
          icon={Globe}
        />
      </div>

      {/* Source Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Source</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
              <GitBranch className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Branch</p>
                <p className="font-medium">{deployment.sourceRef ?? 'main'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
              <GitCommit className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Commit</p>
                <code className="text-sm font-medium">
                  {formatCommitHash(deployment.commitHash)}
                </code>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
              <Terminal className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Message</p>
                <p className="font-medium truncate">{deployment.commitMessage ?? '-'}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Metrics (if available and succeeded) */}
      {deployment.status === 'succeeded' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Runtime Metrics</CardTitle>
            <CardDescription>Current performance metrics for this deployment</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="grid gap-4 grid-cols-2">
                <div className="p-4 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <Cpu className="h-4 w-4" />
                    <span className="text-sm">CPU Usage</span>
                  </div>
                  <p className="text-2xl font-bold">{formatPercent(deployment.metrics.cpuUsage)}</p>
                </div>
                <div className="p-4 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <HardDrive className="h-4 w-4" />
                    <span className="text-sm">Memory</span>
                  </div>
                  <p className="text-2xl font-bold">{deployment.metrics.memoryUsage?.toFixed(1)} MB</p>
                </div>
                <div className="p-4 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <Activity className="h-4 w-4" />
                    <span className="text-sm">Requests</span>
                  </div>
                  <p className="text-2xl font-bold">
                    {(deployment.metrics.requestCount ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="p-4 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm">Error Rate</span>
                  </div>
                  <p className="text-2xl font-bold">
                    {formatPercent(deployment.metrics.errorRate)}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-center">
                <SimpleBarChart data={metricsData} height={150} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Build Config */}
      {(
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Build Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-sm text-muted-foreground">Build Command</p>
                <code className="text-sm bg-muted px-2 py-1 rounded mt-1 block">
                  {deployment.buildConfig.command ?? '-'}
                </code>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Output Directory</p>
                <code className="text-sm bg-muted px-2 py-1 rounded mt-1 block">
                  {deployment.buildConfig.outputDir ?? '-'}
                </code>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Node Version</p>
                <code className="text-sm bg-muted px-2 py-1 rounded mt-1 block">
                  {deployment.buildConfig.nodeVersion ?? '-'}
                </code>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Environment Variables</p>
                <p className="text-sm font-medium mt-1">
                  {Object.keys(deployment.buildConfig.envVars).length} defined
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Logs */}
      <Card>
        <Collapsible open={logsExpanded} onOpenChange={setLogsExpanded}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <div className="flex items-center justify-between cursor-pointer">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  <CardTitle className="text-base">Build Logs</CardTitle>
                  <Badge variant="outline" className="ml-2">
                    {deployment.logs.length} entries
                  </Badge>
                </div>
                <Button variant="ghost" size="sm">
                  {logsExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <div className="bg-zinc-950 rounded-lg p-4 font-mono text-sm max-h-96 overflow-y-auto">
                {deployment.logs.length === 0 ? (
                  <p className="text-muted-foreground">No logs available yet...</p>
                ) : (
                  deployment.logs.map((log) => (
                    <LogLine key={log.id} log={log} levelColors={logLevelColors} />
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  )
}

function LogLine({
  log,
  levelColors,
}: {
  log: DeploymentLog
  levelColors: Record<string, string>
}) {
  const timestamp = new Date(log.timestamp).toLocaleTimeString()
  
  return (
    <div className="flex gap-2 py-0.5 hover:bg-zinc-900/50">
      <span className="text-zinc-500 select-none">{timestamp}</span>
      <span className={`w-12 ${levelColors[log.level] ?? 'text-zinc-400'}`}>
        [{log.level.toUpperCase().padEnd(5)}]
      </span>
      {log.source && (
        <span className="text-zinc-500">[{log.source}]</span>
      )}
      <span className="text-zinc-200">{log.message}</span>
    </div>
  )
}

function DeploymentDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Skeleton className="h-10 w-10" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}
