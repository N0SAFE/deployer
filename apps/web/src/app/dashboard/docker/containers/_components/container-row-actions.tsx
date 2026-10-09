'use client'

import type { DockerContainer } from '@repo/contracts-entities'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { MoreHorizontal, Play, RotateCcw, Square, Trash2 } from 'lucide-react'
import { DockerContainerDetailModalTrigger } from '../../_components/container-detail-modal'
import type { ContainerAction, ContainerRow } from '../_models/container-list.model'
import { isLive } from '../_utils/container-rows'

const OPENER_CLASS = 'inline-flex h-7 items-center rounded border border-border/60 px-2 text-xs hover:bg-muted hover:no-underline'

/**
 * Per-row actions in one place: Logs always, Shell only while the container runs,
 * and a menu whose items are disabled when they cannot apply (no Stop on a stopped container).
 */
export function ContainerRowActions({ row, entity, onStateChange, onAction, disabled }: {
  row: ContainerRow
  entity: DockerContainer | undefined
  onStateChange: () => void
  onAction: (action: ContainerAction, rows: ContainerRow[]) => void
  disabled: boolean
}) {
  const live = isLive(row)
  return (
    <div className="flex items-center gap-1.5">
      <DockerContainerDetailModalTrigger id={row.id} container={entity} onContainerStateChange={onStateChange} initialTab="logs" className={OPENER_CLASS}>
        Logs
      </DockerContainerDetailModalTrigger>
      {live ? (
        <DockerContainerDetailModalTrigger id={row.id} container={entity} onContainerStateChange={onStateChange} initialTab="terminal" className={OPENER_CLASS}>
          Shell
        </DockerContainerDetailModalTrigger>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for ${row.name}`} disabled={disabled}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={live} onSelect={() => { onAction('start', [row]) }}>
            <Play /> Start
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!live} onSelect={() => { onAction('stop', [row]) }}>
            <Square /> Stop
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!live} onSelect={() => { onAction('restart', [row]) }}>
            <RotateCcw /> Restart
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => { onAction('remove', [row]) }}>
            <Trash2 /> Remove…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
