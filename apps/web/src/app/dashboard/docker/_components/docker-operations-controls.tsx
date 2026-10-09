'use client'

import { useEffect } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'

interface DockerSavedViewSelectProps {
  storageKey: string
  /** Accessible name of the select (what it chooses). */
  label?: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}

export function DockerSavedViewSelect({ storageKey, label = 'Saved view', options, value, onChange }: DockerSavedViewSelectProps) {
  useEffect(() => {
    const cached = globalThis.localStorage.getItem(storageKey)
    if (cached && options.some((option) => option.value === cached)) {
      onChange(cached)
    }
  }, [onChange, options, storageKey])

  useEffect(() => {
    globalThis.localStorage.setItem(storageKey, value)
  }, [storageKey, value])

  return (
    <select
      aria-label={label}
      className="h-9 rounded-md border bg-background px-3 text-sm"
      value={value}
      onChange={(event) => {
        onChange(event.target.value)
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}

export type DockerBatchAction = 'start' | 'stop' | 'restart' | 'update' | 'remove'

const BATCH_ACTION_LABELS: Record<DockerBatchAction, string> = {
  start: 'Start',
  stop: 'Stop',
  restart: 'Restart',
  update: 'Update',
  remove: 'Remove',
}

interface DockerBatchOperationsBarProps {
  selectedCount: number
  resourceLabel: string
  onClearSelection: () => void
  onAction?: (action: DockerBatchAction) => void
  /** Which actions to offer, in order. Defaults to every action. */
  actions?: readonly DockerBatchAction[]
  /** How many of the selected items each action applies to; an action at 0 is disabled. */
  applicableCounts?: Partial<Record<DockerBatchAction, number>>
  /** Disables every action while one is running. */
  busy?: boolean
}

const ALL_BATCH_ACTIONS: readonly DockerBatchAction[] = ['start', 'stop', 'restart', 'update', 'remove']

/** Bulk-action bar shown while rows are selected. Renders nothing when the selection is empty. */
export function DockerBatchOperationsBar({
  selectedCount,
  resourceLabel,
  onClearSelection,
  onAction,
  actions = ALL_BATCH_ACTIONS,
  applicableCounts,
  busy = false,
}: DockerBatchOperationsBarProps) {
  if (selectedCount === 0) return null

  return (
    <div role="region" aria-label={`Actions for selected ${resourceLabel}`} className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
      <span className="text-sm font-medium" aria-live="polite">{selectedCount} selected</span>
      <div className="ml-auto flex flex-wrap gap-2">
        {actions.map((action) => {
          const applicable = applicableCounts?.[action]
          const count = applicable === undefined ? '' : ` (${String(applicable)})`
          return (
            <Button
              key={action}
              size="sm"
              variant={action === 'remove' ? 'destructive' : 'outline'}
              disabled={busy || !onAction || applicable === 0}
              title={applicable === 0 ? `None of the selected ${resourceLabel} can be ${BATCH_ACTION_LABELS[action].toLowerCase()}ed right now` : undefined}
              onClick={() => { onAction?.(action) }}
            >
              {BATCH_ACTION_LABELS[action]}{count}
            </Button>
          )
        })}
        <Button size="sm" variant="ghost" onClick={onClearSelection}>Clear selection</Button>
      </div>
    </div>
  )
}
