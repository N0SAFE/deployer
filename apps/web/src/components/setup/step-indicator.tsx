"use client"

import { cn } from "@/lib/utils"

type Props = {
  current: number
  total: number
  labels: string[]
}

export function StepIndicator({ current, total, labels }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
        <span>
          Step {Math.min(current + 1, total)} of {total}
        </span>
        <span className="text-foreground/80">{labels[current] ?? ""}</span>
      </div>
      <div
        className="flex gap-1.5"
        role="progressbar"
        aria-valuenow={current + 1}
        aria-valuemin={1}
        aria-valuemax={total}
      >
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-all duration-500",
              i < current && "bg-primary",
              i === current && "bg-primary shadow-[0_0_12px_rgba(167,139,250,0.5)]",
              i > current && "bg-border/80",
            )}
          />
        ))}
      </div>
    </div>
  )
}
