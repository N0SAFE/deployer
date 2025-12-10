'use client'

import type { JSX } from 'react'
import { cn } from '@/lib/utils'

interface DataPoint {
  label: string
  value: number
}

interface SimpleBarChartProps {
  data: DataPoint[]
  height?: number
  className?: string
  barClassName?: string
  showLabels?: boolean
  showValues?: boolean
  maxValue?: number
}

export function SimpleBarChart({
  data,
  height = 120,
  className,
  barClassName,
  showLabels = true,
  showValues = false,
  maxValue,
}: SimpleBarChartProps): JSX.Element {
  const max = maxValue ?? Math.max(...data.map((d) => d.value), 1)

  return (
    <div className={cn('flex items-end gap-1', className)} style={{ height }}>
      {data.map((point, index) => {
        const barHeight = (point.value / max) * 100
        return (
          <div
            key={`${point.label}-${String(index)}`}
            className="flex flex-1 flex-col items-center gap-1"
          >
            {showValues && (
              <span className="text-muted-foreground text-xs">{point.value}</span>
            )}
            <div
              className={cn(
                'w-full rounded-t bg-primary/80 transition-all hover:bg-primary',
                barClassName
              )}
              style={{ height: `${String(barHeight)}%`, minHeight: point.value > 0 ? 4 : 0 }}
              title={`${point.label}: ${String(point.value)}`}
            />
            {showLabels && (
              <span className="text-muted-foreground text-[10px] leading-none">
                {point.label}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface SimpleLineChartProps {
  data: DataPoint[]
  height?: number
  className?: string
  lineColor?: string
  showLabels?: boolean
  showDots?: boolean
}

export function SimpleLineChart({
  data,
  height = 120,
  className,
  lineColor = 'hsl(var(--primary))',
  showLabels = true,
  showDots = true,
}: SimpleLineChartProps): JSX.Element {
  const max = Math.max(...data.map((d) => d.value), 1)
  const points = data.map((point, index) => {
    const x = (index / (data.length - 1)) * 100
    const y = 100 - (point.value / max) * 100
    return { x, y, ...point }
  })

  const pathData = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${String(p.x)} ${String(p.y)}`)
    .join(' ')

  return (
    <div className={cn('relative', className)} style={{ height }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
      >
        <path
          d={pathData}
          fill="none"
          stroke={lineColor}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {showDots &&
          points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="3"
              fill={lineColor}
              className="hover:r-4 transition-all"
            >
              <title>
                {p.label}: {p.value}
              </title>
            </circle>
          ))}
      </svg>
      {showLabels && (
        <div className="mt-1 flex justify-between">
          {data.map((point, index) => (
            <span
              key={index}
              className="text-muted-foreground text-[10px] leading-none"
            >
              {point.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

interface DonutChartProps {
  data: { label: string; value: number; color: string }[]
  size?: number
  strokeWidth?: number
  className?: string
  showLegend?: boolean
}

export function DonutChart({
  data,
  size = 120,
  strokeWidth = 20,
  className,
  showLegend = true,
}: DonutChartProps): JSX.Element {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  const segments = data.reduce<{ label: string; value: number; color: string; percent: number; dashLength: number; dashOffset: number }[]>((acc, segment) => {
    const percent = total > 0 ? segment.value / total : 0
    const dashLength = circumference * percent
    const previousOffset = acc.reduce((sum, s) => sum + s.dashLength, 0)
    const dashOffset = circumference - previousOffset
    return [...acc, { ...segment, percent, dashLength, dashOffset }]
  }, [])

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
        />
        {segments.map((segment, index) => (
          <circle
            key={index}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${String(segment.dashLength)} ${String(circumference - segment.dashLength)}`}
            strokeDashoffset={segment.dashOffset}
            className="transition-all"
          >
            <title>
              {segment.label}: {segment.value} ({Math.round(segment.percent * 100)}%)
            </title>
          </circle>
        ))}
      </svg>
      {showLegend && (
        <div className="flex flex-col gap-1">
          {segments.map((segment, index) => (
            <div key={index} className="flex items-center gap-2 text-sm">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: segment.color }}
              />
              <span className="text-muted-foreground">{segment.label}</span>
              <span className="font-medium">{segment.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
