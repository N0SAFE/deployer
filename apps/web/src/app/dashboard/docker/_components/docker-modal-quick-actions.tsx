'use client'

import type { LucideIcon } from 'lucide-react'

export interface DockerModalQuickActionItem {
  label: string
  icon: LucideIcon
  onClick: () => void
}

interface DockerModalQuickActionsProps {
  actions: DockerModalQuickActionItem[]
  dangerAction?: DockerModalQuickActionItem
}

export function DockerModalQuickActions({ actions, dangerAction }: DockerModalQuickActionsProps) {
  return (
    <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-1">
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <button
            key={action.label}
            type="button"
            title={action.label}
            onClick={action.onClick}
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Icon className="h-4 w-4" />
          </button>
        )
      })}

      {dangerAction ? (
        <button
          type="button"
          title={dangerAction.label}
          onClick={dangerAction.onClick}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-destructive transition-colors hover:bg-destructive/10"
        >
          <dangerAction.icon className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
}