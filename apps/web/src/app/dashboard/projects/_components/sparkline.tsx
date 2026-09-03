'use client'

import { useId } from 'react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/utils'

/**
 * Minimal sparkline — fixed geometry (reserved box, no layout shift), no
 * animation (perf rule for live feeds), no axes/tooltip/legend. Threshold
 * color is applied to the VALUE text elsewhere; the line stays neutral with a
 * soft gradient fill. Feed via props, keep the mount stable.
 */
export function Sparkline({
  data,
  dataKey = 'value',
  width = '100%',
  height = 32,
  color = 'var(--primary)',
  fill = true,
  className,
}: {
  data: Array<{ value: number }> | number[]
  dataKey?: string
  width?: string | number
  height?: number
  color?: string
  fill?: boolean
  className?: string
}) {
  const gradientId = useId()
  const points = data.map((d, i) => (typeof d === 'number' ? { value: d } : d))

  if (points.length === 0) {
    return <div className={cn('w-full rounded bg-muted/40', className)} style={{ height }} aria-hidden />
  }

  return (
    <div className={cn('w-full', className)} style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            fill={fill ? `url(#${gradientId})` : 'none'}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Build a rolling-window series from a stream of numbers (bounded memory). */
export function pushPoint(
  series: Array<{ value: number }>,
  value: number,
  maxPoints = 40,
): Array<{ value: number }> {
  const next = [...series, { value }]
  return next.length > maxPoints ? next.slice(next.length - maxPoints) : next
}
