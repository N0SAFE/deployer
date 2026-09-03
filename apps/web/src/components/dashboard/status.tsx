'use client'

import { Badge } from '@repo/ui/components/shadcn/badge'
import { cn } from '@/lib/utils'
import {
  CircleCheck,
  CircleX,
  Loader2,
  Pause,
  CircleHelp,
  TriangleAlert,
  Rocket,
  type LucideIcon,
} from 'lucide-react'

/**
 * Unified live-status system — the SINGLE source of truth for status
 * rendering across the operator console (services, containers, deployments,
 * streams, domains).
 *
 * Status vocabulary:
 *   live (emerald)      → healthy, running, connected, verified, synced
 *   pending (amber)     → degraded, queued, pending, warning
 *   danger (rose)       → failed, error, down, dead, unhealthy
 *   busy (sky, animate) → building, deploying, syncing, connecting
 *   neutral (muted)     → stopped, paused, inactive, unknown
 *
 * A11y rule — never color alone: `StatusBadge` always carries an icon + text
 * label. Use the ONE meaningful live region (`role="status"`) per page, not a
 * wall of competing announcements.
 */

export type StatusTone = 'live' | 'pending' | 'danger' | 'busy' | 'neutral'

export const statusToneClasses: Record<StatusTone, string> = {
  live: 'bg-emerald-500 dark:bg-emerald-400',
  pending: 'bg-amber-500 dark:bg-amber-400',
  danger: 'bg-rose-500 dark:bg-rose-400',
  busy: 'bg-sky-500 dark:bg-sky-400',
  neutral: 'bg-muted-foreground',
}

/** Derive a tone from a raw status string (docker, service, deployment, stream). */
export function statusToneFrom(status: string | null | undefined): StatusTone {
  const value = (status ?? '').toLowerCase()
  if (
    value === 'live' || value === 'healthy' || value === 'running' || value === 'active'
    || value === 'connected' || value === 'success' || value === 'verified'
    || value === 'synced' || value === 'ready' || value === 'deployed' || value === 'ok'
  ) {
    return 'live'
  }
  if (
    value === 'pending' || value === 'queued' || value === 'building' || value === 'deploying'
    || value === 'connecting' || value === 'starting' || value === 'syncing' || value === 'restarting'
    || value === 'initializing' || value === 'degraded' || value === 'at-risk' || value === 'warning'
  ) {
    return value === 'degraded' || value === 'at-risk' || value === 'warning' ? 'pending' : 'busy'
  }
  if (
    value === 'failed' || value === 'error' || value === 'down' || value === 'dead'
    || value === 'exited' || value === 'disconnected' || value === 'cancelled'
    || value === 'canceled' || value === 'unhealthy' || value === 'crashloop'
  ) {
    return 'danger'
  }
  return 'neutral'
}

interface StatusMeta {
  variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'outline' | 'default'
  icon: LucideIcon
  dotClass: string
  animate?: boolean
}

const SUCCESS: StatusMeta = { variant: 'success', icon: CircleCheck, dotClass: 'bg-emerald-500' }
const WARNING: StatusMeta = { variant: 'warning', icon: TriangleAlert, dotClass: 'bg-amber-500' }
const DESTRUCTIVE: StatusMeta = { variant: 'destructive', icon: CircleX, dotClass: 'bg-rose-500' }
const INFO: StatusMeta = { variant: 'default', icon: Rocket, dotClass: 'bg-sky-500', animate: true }
const NEUTRAL: StatusMeta = { variant: 'secondary', icon: Pause, dotClass: 'bg-muted-foreground' }
const UNKNOWN: StatusMeta = { variant: 'outline', icon: CircleHelp, dotClass: 'bg-muted' }

const STATUS_META: Record<string, StatusMeta> = {
  // success / emerald
  running: SUCCESS, healthy: SUCCESS, ready: SUCCESS, success: SUCCESS,
  active: SUCCESS, deployed: SUCCESS, live: SUCCESS, connected: SUCCESS,
  verified: SUCCESS, synced: SUCCESS, ok: SUCCESS,
  // warning / amber
  degraded: WARNING, 'at-risk': WARNING, warning: WARNING, queued: WARNING,
  pending: WARNING, starting: WARNING, restarting: WARNING,
  // destructive / rose
  error: DESTRUCTIVE, failed: DESTRUCTIVE, down: DESTRUCTIVE, dead: DESTRUCTIVE,
  unhealthy: DESTRUCTIVE, crashloop: DESTRUCTIVE, disconnected: DESTRUCTIVE,
  cancelled: DESTRUCTIVE, canceled: DESTRUCTIVE,
  // busy / sky (animated)
  building: INFO, deploying: INFO, syncing: INFO, initializing: INFO,
  connecting: INFO,
  // neutral
  stopped: NEUTRAL, paused: NEUTRAL, inactive: NEUTRAL,
  exited: NEUTRAL, created: NEUTRAL, idle: NEUTRAL,
}

export function statusMeta(status: string | null | undefined): StatusMeta {
  if (!status) return UNKNOWN
  return STATUS_META[status.toLowerCase()] ?? UNKNOWN
}

/** Humanized label (sentence case, no underscores). */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown'
  return status
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * StatusDot — a compact status indicator. Accepts a raw status string
 * (tone auto-derived) or an explicit tone. `pulse` implies motion; honor
 * reduced motion. Icon-free — pair with a label when not decorative.
 */
export function StatusDot({
  status,
  tone,
  pulse = false,
  className,
  label,
}: {
  status?: string | null
  tone?: StatusTone
  pulse?: boolean
  className?: string
  label?: string
}) {
  const resolvedTone = tone ?? statusToneFrom(status)
  const animating = pulse || (status ? statusMeta(status).animate : false)
  return (
    <span
      className={cn('relative inline-flex size-2 shrink-0', className)}
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <span
        className={cn(
          'absolute inline-flex size-full rounded-full',
          animating && resolvedTone !== 'neutral' && 'animate-ping opacity-60 motion-reduce:animate-none',
          statusToneClasses[resolvedTone],
        )}
      />
      <span className={cn('relative inline-flex size-2 rounded-full', statusToneClasses[resolvedTone])} />
    </span>
  )
}

/**
 * StatusBadge — the canonical status chip: dot + icon + label.
 * Never color alone (a11y). The single component for services, containers,
 * deployments, domains, and stream states across the console.
 */
export function StatusBadge({
  status,
  className,
  showDot = true,
  pulse,
  children,
}: {
  status: string | null | undefined
  className?: string
  showDot?: boolean
  pulse?: boolean
  /** Optional custom label (defaults to the humanized status). */
  children?: React.ReactNode
}) {
  const meta = statusMeta(status)
  const Icon = meta.icon
  const animating = pulse || meta.animate
  return (
    <Badge variant={meta.variant} className={cn('gap-1 capitalize', className)}>
      {showDot ? (
        <StatusDot status={status} pulse={animating} />
      ) : null}
      <Icon className={cn('size-3', meta.animate && !pulse && 'animate-spin motion-reduce:animate-none')} />
      {children ?? statusLabel(status)}
    </Badge>
  )
}

/** StatusMetric — a compact live-metric tile for bento panels: label + value + dot. */
export function StatusMetric({
  label,
  value,
  status,
  tone = 'neutral',
  pulse = false,
  icon: Icon,
  hint,
  loading = false,
  className,
}: {
  label: string
  value: React.ReactNode
  status?: string | null
  tone?: StatusTone
  pulse?: boolean
  icon?: LucideIcon
  hint?: string
  loading?: boolean
  className?: string
}) {
  const resolvedTone = tone ?? statusToneFrom(status)
  return (
    <div
      className={cn(
        'rounded-xl border border-border/60 bg-card/40 px-3.5 py-3 backdrop-blur-xl',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div className="flex items-center gap-1.5">
          {Icon ? <Icon className={cn('size-3.5', statusToneClasses[resolvedTone])} /> : null}
          <StatusDot status={status} tone={resolvedTone} pulse={pulse} />
        </div>
      </div>
      {loading ? (
        <Loader2 className="mt-2 size-5 animate-spin text-muted-foreground" />
      ) : (
        <p className="mt-1.5 text-xl font-semibold tracking-tight tabular-nums">{value}</p>
      )}
      {hint ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
