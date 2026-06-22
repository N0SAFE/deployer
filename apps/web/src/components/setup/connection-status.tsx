"use client"

import { CheckCircle2, Loader2, XCircle, Circle } from "lucide-react"
import { cn } from "@/lib/utils"

export type ConnectionState = "idle" | "checking" | "reachable" | "unreachable"

type Props = {
  state: ConnectionState
  idleLabel?: string
  checkingLabel?: string
  reachableLabel?: string
  unreachableLabel?: string
  detail?: string
  className?: string
}

export function ConnectionStatus({
  state,
  idleLabel = "Enter a value to check",
  checkingLabel = "Checking...",
  reachableLabel = "Reachable",
  unreachableLabel = "Unreachable",
  detail,
  className,
}: Props) {
  const config = {
    idle: {
      icon: Circle,
      label: idleLabel,
      iconClass: "text-muted-foreground/60",
      textClass: "text-muted-foreground",
      bgClass: "bg-muted/30 border-border/60",
    },
    checking: {
      icon: Loader2,
      label: checkingLabel,
      iconClass: "text-primary animate-spin",
      textClass: "text-foreground",
      bgClass: "bg-primary/[0.06] border-primary/30",
    },
    reachable: {
      icon: CheckCircle2,
      label: reachableLabel,
      iconClass: "text-emerald-500",
      textClass: "text-foreground",
      bgClass: "bg-emerald-500/[0.07] border-emerald-500/30",
    },
    unreachable: {
      icon: XCircle,
      label: unreachableLabel,
      iconClass: "text-destructive",
      textClass: "text-foreground",
      bgClass: "bg-destructive/[0.07] border-destructive/30",
    },
  }[state]

  const Icon = config.icon

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition-colors",
        config.bgClass,
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", config.iconClass)} aria-hidden="true" />
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className={cn("font-medium leading-tight", config.textClass)}>{config.label}</span>
        {detail ? (
          <span className="text-xs text-muted-foreground leading-snug wrap-break-word">{detail}</span>
        ) : null}
      </div>
    </div>
  )
}
