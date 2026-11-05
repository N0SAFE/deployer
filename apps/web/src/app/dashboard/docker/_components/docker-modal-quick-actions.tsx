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

export function DockerModalQuickActions({
    actions,
    dangerAction,
}: DockerModalQuickActionsProps) {
    return (
        <div className="bg-muted/30 flex items-center gap-1 rounded-md border p-1">
            {actions.map((action) => {
                const Icon = action.icon
                return (
                    <button
                        key={action.label}
                        type="button"
                        title={action.label}
                        onClick={action.onClick}
                        className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-sm transition-colors"
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
                    className="text-destructive hover:bg-destructive/10 inline-flex h-8 w-8 items-center justify-center rounded-sm transition-colors"
                >
                    <dangerAction.icon className="h-4 w-4" />
                </button>
            ) : null}
        </div>
    )
}
