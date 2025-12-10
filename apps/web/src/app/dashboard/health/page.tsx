'use client'

import type React from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  Link2,
  MemoryStick,
  Network,
  ShieldCheck,
  Thermometer,
} from 'lucide-react'
import { useSystemHealthOverview } from '@/hooks/useHealth'

type StatusKey = 'healthy' | 'degraded' | 'critical' | 'unknown'

const statusConfig: Record<
  StatusKey,
  {
    label: string
    color: string
    icon: React.ComponentType<{ className?: string }>
  }
> = {
  healthy: {
    label: 'Healthy',
    color: 'text-emerald-500',
    icon: CheckCircle2,
  },
  degraded: {
    label: 'Degraded',
    color: 'text-amber-500',
    icon: AlertTriangle,
  },
  critical: {
    label: 'Critical',
    color: 'text-destructive',
    icon: AlertTriangle,
  },
  unknown: {
    label: 'Unknown',
    color: 'text-muted-foreground',
    icon: Thermometer,
  },
}

function getStatusKey(value?: string): StatusKey {
  if (value && value in statusConfig) {
    return value as StatusKey
  }
  return 'unknown'
}

function StatusBadge({ value }: { value?: string }) {
  const statusKey = getStatusKey(value)
  const config = statusConfig[statusKey]
  const Icon = config.icon

  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs">
      <Icon className={`${config.color} h-3.5 w-3.5`} />
      <span className="font-medium capitalize">{config.label}</span>
    </div>
  )
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${String(days)}d ${String(hours)}h`
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`
  return `${String(minutes)}m`
}

function formatMemory(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(0)} MB`
}

export default function HealthPage() {
  const { basic, detailed, isLoading, error, refetch } = useSystemHealthOverview()

  // Extract values from the hook's actual return structure
  const status = basic.status
  const uptime = formatUptime(detailed.uptime)
  const databaseStatus = detailed.database.status
  const memoryUsed = formatMemory(detailed.memory.used)
  const memoryTotal = formatMemory(detailed.memory.total)

  const healthCards = [
    { title: 'Overall Status', icon: ShieldCheck, value: status, isStatus: true },
    { title: 'Uptime', icon: Activity, value: uptime, isStatus: false },
    { title: 'Database', icon: Database, value: databaseStatus, isStatus: true },
    { title: 'Memory', icon: MemoryStick, value: `${memoryUsed} / ${memoryTotal}`, isStatus: false },
  ]

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">System Health</h1>
        <p className="text-muted-foreground">
          Status overview for services, components, and performance signals.
        </p>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to load health data: {error.message}</p>
            <button
              onClick={() => void refetch()}
              className="mt-2 text-sm text-primary underline"
            >
              Retry
            </button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {healthCards.map((card) => {
          const Icon = card.icon

          return (
            <Card key={card.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                <Icon className="text-muted-foreground h-5 w-5" />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-3/4" />
                ) : (
                  <div className="flex items-center gap-2 text-2xl font-bold">
                    {card.isStatus ? <StatusBadge value={card.value} /> : card.value}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Database Health</CardTitle>
          <CardDescription>Database connection and performance details</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, idx) => (
                <Skeleton key={idx} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge value={detailed.database.status} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Response Time</span>
                <span className="font-medium">
                  {`${String(detailed.database.responseTime)}ms`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last Check</span>
                <span className="font-medium">
                  {new Date(detailed.database.timestamp).toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Memory Usage</CardTitle>
          <CardDescription>System memory allocation</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, idx) => (
                <Skeleton key={idx} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Used</span>
                <span className="font-medium">{formatMemory(detailed.memory.used)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Free</span>
                <span className="font-medium">{formatMemory(detailed.memory.free)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-medium">{formatMemory(detailed.memory.total)}</span>
              </div>
              <div className="mt-2">
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{
                      width: `${String(Math.min(100, (detailed.memory.used / detailed.memory.total) * 100))}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {((detailed.memory.used / detailed.memory.total) * 100).toFixed(1)}% used
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Performance Overview</CardTitle>
          <CardDescription>Aggregate signals across infrastructure</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { title: 'CPU Utilization', icon: Cpu, value: '62%', status: 'healthy' as const },
            { title: 'Memory Usage', icon: MemoryStick, value: '71%', status: 'degraded' as const },
            { title: 'Disk I/O', icon: HardDrive, value: 'Normal', status: 'healthy' as const },
            { title: 'Network Latency', icon: Network, value: '45ms', status: 'healthy' as const },
            { title: 'Error Rate', icon: AlertTriangle, value: '0.3%', status: 'healthy' as const },
            { title: 'Service Sync', icon: Link2, value: 'Up-to-date', status: 'healthy' as const },
          ].map((item) => {
            const config = statusConfig[item.status]
            return (
              <Card key={item.title} className="border-muted/60">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <StatusBadge value={item.status} />
                  </div>
                  <CardDescription>{item.value}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Resource health</span>
                    <config.icon className={`${config.color} h-4 w-4`} />
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Updated</span>
                    <span>{new Date().toLocaleTimeString()}</span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
