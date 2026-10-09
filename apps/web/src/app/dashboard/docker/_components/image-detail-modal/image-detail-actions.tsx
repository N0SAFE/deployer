'use client'

import type { LucideIcon } from 'lucide-react'
import { Download, Play, ScanSearch, Tag, Trash2, Upload } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'

export type ImageQueuedOp = 'pull' | 'tag' | 'push' | 'export'

interface ImageDetailActionsProps {
  canRescan: boolean
  onRun: () => void
  onRescan: () => void
  onQueueOp: (op: ImageQueuedOp) => void
  onRemove: () => void
}

const QUEUED_OPS: readonly { op: ImageQueuedOp; label: string; icon: LucideIcon }[] = [
  { op: 'pull', label: 'Pull', icon: Download },
  { op: 'tag', label: 'Tag', icon: Tag },
  { op: 'push', label: 'Push', icon: Upload },
  { op: 'export', label: 'Export', icon: Download },
]

/** Labelled actions: text shows from `sm` up, below that the icon keeps an accessible name. */
export function ImageDetailActions({ canRescan, onRun, onRescan, onQueueOp, onRemove }: ImageDetailActionsProps) {
  return (
    <div role="toolbar" aria-label="Image actions" className="flex flex-wrap items-center gap-1">
      <Button type="button" size="sm" className="h-8 gap-1.5" onClick={onRun}>
        <Play aria-hidden className="h-3.5 w-3.5" />
        Run
      </Button>
      {canRescan ? (
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={onRescan} aria-label="Rescan image">
          <ScanSearch aria-hidden className="h-3.5 w-3.5" />
          <span className="max-sm:sr-only">Rescan</span>
        </Button>
      ) : null}
      {QUEUED_OPS.map(({ op, label, icon: Icon }) => (
        <Button key={op} type="button" size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => { onQueueOp(op) }} aria-label={`${label} image`}>
          <Icon aria-hidden className="h-3.5 w-3.5" />
          <span className="max-sm:sr-only">{label}</span>
        </Button>
      ))}
      <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 text-destructive hover:text-destructive" onClick={onRemove} aria-label="Remove image">
        <Trash2 aria-hidden className="h-3.5 w-3.5" />
        <span className="max-sm:sr-only">Remove</span>
      </Button>
    </div>
  )
}
