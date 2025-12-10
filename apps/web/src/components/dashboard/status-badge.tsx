'use client'

import type { JSX } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type DeploymentStatus =
  | 'pending'
  | 'building'
  | 'deploying'
  | 'running'
  | 'succeeded'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'unknown'

export type HealthStatus = 'healthy' | 'degraded' | 'critical' | 'unknown'

interface StatusConfig {
  label: string
  variant: 'default' | 'secondary' | 'outline' | 'destructive'
  className: string
  icon: LucideIcon
}

const deploymentStatusConfig: Record<DeploymentStatus, StatusConfig> = {
  pending: {
    label: 'Pending',
    variant: 'outline',
    className: 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400',
    icon: Clock3,
  },
  building: {
    label: 'Building',
    variant: 'secondary',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
    icon: Loader2,
  },
  deploying: {
    label: 'Deploying',
    variant: 'secondary',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
    icon: Activity,
  },
  running: {
    label: 'Running',
    variant: 'default',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
    icon: Activity,
  },
  succeeded: {
    label: 'Succeeded',
    variant: 'default',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
    icon: CheckCircle2,
  },
  success: {
    label: 'Success',
    variant: 'default',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
    icon: CheckCircle2,
  },
  failed: {
    label: 'Failed',
    variant: 'destructive',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
    icon: XCircle,
  },
  cancelled: {
    label: 'Cancelled',
    variant: 'outline',
    className: 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400',
    icon: XCircle,
  },
  unknown: {
    label: 'Unknown',
    variant: 'outline',
    className: 'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400',
    icon: AlertTriangle,
  },
}

const healthStatusConfig: Record<HealthStatus, StatusConfig> = {
  healthy: {
    label: 'Healthy',
    variant: 'default',
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
    icon: CheckCircle2,
  },
  degraded: {
    label: 'Degraded',
    variant: 'secondary',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
    icon: AlertTriangle,
  },
  critical: {
    label: 'Critical',
    variant: 'destructive',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
    icon: XCircle,
  },
  unknown: {
    label: 'Unknown',
    variant: 'outline',
    className: 'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400',
    icon: AlertTriangle,
  },
}

interface DeploymentStatusBadgeProps {
  status: string
  showIcon?: boolean
  className?: string
}

export function DeploymentStatusBadge({
  status,
  showIcon = false,
  className,
}: DeploymentStatusBadgeProps): JSX.Element {
  const normalizedStatus = status.toLowerCase() as DeploymentStatus
  const config =
    normalizedStatus in deploymentStatusConfig
      ? deploymentStatusConfig[normalizedStatus]
      : deploymentStatusConfig.unknown
  const Icon = config.icon

  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {showIcon && (
        <Icon
          className={cn('mr-1 h-3 w-3', normalizedStatus === 'building' && 'animate-spin')}
        />
      )}
      {config.label}
    </Badge>
  )
}

interface HealthStatusBadgeProps {
  status: string
  showIcon?: boolean
  className?: string
}

export function HealthStatusBadge({
  status,
  showIcon = true,
  className,
}: HealthStatusBadgeProps): JSX.Element {
  const normalizedStatus = status.toLowerCase() as HealthStatus
  const config =
    normalizedStatus in healthStatusConfig
      ? healthStatusConfig[normalizedStatus]
      : healthStatusConfig.unknown
  const Icon = config.icon

  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {showIcon && <Icon className="mr-1 h-3 w-3" />}
      {config.label}
    </Badge>
  )
}
