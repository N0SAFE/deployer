'use client'

import { Badge } from '@repo/ui/components/shadcn/badge'
import { cn } from '@/lib/utils'

/**
 * EnvironmentBadge — the canonical environment chip.
 *
 * Environments are a CATEGORY (which lane), not a STATE, so they use a
 * deliberately quieter treatment than status badges: outline chip + colored
 * dot + label. This keeps them visually distinct from the filled/icon status
 * badges (emerald/amber/rose) even when the hues overlap.
 *
 *   production  → rose   (hot lane)
 *   staging     → amber  (pre-production)
 *   preview     → violet (ephemeral, matches brand)
 *   development → sky    (calm lane)
 */

type EnvTone = 'production' | 'staging' | 'preview' | 'development' | 'unknown'

const envToneClasses: Record<EnvTone, string> = {
  production: 'text-status-danger',
  staging: 'text-status-pending',
  preview: 'text-primary',
  development: 'text-status-busy',
  unknown: 'text-muted-foreground',
}

const envDotClasses: Record<EnvTone, string> = {
  production: 'bg-status-danger',
  staging: 'bg-status-pending',
  preview: 'bg-primary',
  development: 'bg-status-busy',
  unknown: 'bg-status-idle',
}

export function environmentTone(environment: string | null | undefined): EnvTone {
  const value = (environment ?? '').toLowerCase()
  if (value.includes('prod')) return 'production'
  if (value.includes('stag')) return 'staging'
  if (value.includes('preview') || value.includes('prev') || value === 'pr') return 'preview'
  if (value.includes('dev')) return 'development'
  return 'unknown'
}

/** Humanized environment label (sentence case). */
export function environmentLabel(environment: string | null | undefined): string {
  const value = (environment ?? '').trim()
  if (!value) return 'Production'
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function EnvironmentBadge({
  environment,
  className,
}: {
  environment: string | null | undefined
  className?: string
}) {
  const tone = environmentTone(environment)
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5 py-0.5 text-[10px] font-medium capitalize',
        envToneClasses[tone],
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', envDotClasses[tone])} aria-hidden="true" />
      {environmentLabel(environment)}
    </Badge>
  )
}
