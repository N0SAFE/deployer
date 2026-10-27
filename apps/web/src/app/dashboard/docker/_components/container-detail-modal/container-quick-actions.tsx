'use client'

import type { LucideIcon } from 'lucide-react'
import { Pause, Play, PlayCircle, RotateCcw, Skull, Square, Trash2 } from 'lucide-react'
import { Button } from '@deployer/ui/components/shadcn/button'
import type { DockerContainer } from '@deployer/contracts-entities'
import type { ContainerOp } from '../../_hooks/use-container-actions'

interface QuickAction {
  op: ContainerOp
  label: string
  icon: LucideIcon
  destructive?: boolean
  enabledWhen: (status: DockerContainer['status'] | null) => boolean
}

const isActive = (status: DockerContainer['status'] | null): boolean =>
  status === null || status === 'running' || status === 'restarting' || status === 'paused' || status === 'unknown'

const ACTIONS: QuickAction[] = [
  { op: 'start', label: 'Start', icon: Play, enabledWhen: (s) => s !== 'running' },
  { op: 'stop', label: 'Stop', icon: Square, destructive: true, enabledWhen: isActive },
  { op: 'restart', label: 'Restart', icon: RotateCcw, enabledWhen: () => true },
  { op: 'pause', label: 'Pause', icon: Pause, enabledWhen: (s) => s === null || s === 'running' || s === 'unknown' },
  { op: 'unpause', label: 'Unpause', icon: PlayCircle, enabledWhen: (s) => s === null || s === 'paused' || s === 'unknown' },
  { op: 'kill', label: 'Kill', icon: Skull, destructive: true, enabledWhen: isActive },
  { op: 'remove', label: 'Remove', icon: Trash2, destructive: true, enabledWhen: () => true },
]

/** Lifecycle buttons for the container. Icon-only, so every button carries an accessible name and tooltip. */
export function ContainerQuickActions({ status, disabled, onAction }: {
  status: DockerContainer['status'] | null
  disabled: boolean
  onAction: (op: ContainerOp) => void
}) {
  return (
    <div role="group" aria-label="Container actions" className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/30 p-1">
      {ACTIONS.map(({ op, label, icon: Icon, destructive, enabledWhen }) => {
        const allowed = enabledWhen(status)
        return (
          <Button
            key={op}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            title={allowed ? label : `${label} (not available while the container is ${status ?? 'in this state'})`}
            disabled={disabled || !allowed}
            className={destructive ? 'text-destructive hover:text-destructive' : 'text-muted-foreground hover:text-foreground'}
            onClick={() => { onAction(op) }}
          >
            <Icon className="size-4" />
          </Button>
        )
      })}
    </div>
  )
}
