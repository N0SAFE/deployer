'use client'

import { useEffect } from 'react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { toast } from 'sonner'

interface DockerSavedViewSelectProps {
  storageKey: string
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
}

export function DockerSavedViewSelect({ storageKey, options, value, onChange }: DockerSavedViewSelectProps) {
  useEffect(() => {
    const cached = globalThis.localStorage?.getItem(storageKey)
    if (cached && options.some((option) => option.value === cached)) {
      onChange(cached)
    }
  }, [onChange, options, storageKey])

  useEffect(() => {
    globalThis.localStorage?.setItem(storageKey, value)
  }, [storageKey, value])

  return (
    <select aria-label="{option.label}"
      className="h-10 rounded-md border bg-background px-3 text-sm"
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

interface DockerBatchOperationsBarProps {
  selectedCount: number
  resourceLabel: string
  onClearSelection: () => void
  onAction?: (action: 'start' | 'stop' | 'restart' | 'update' | 'remove') => void
}

export function DockerBatchOperationsBar({ selectedCount, resourceLabel, onClearSelection, onAction }: DockerBatchOperationsBarProps) {
  if (selectedCount === 0) return null

  function execute(action: 'start' | 'stop' | 'restart' | 'update' | 'remove'): void {
    onAction?.(action)
    if (!onAction) {
      toast.success(`${action} queued`, {
        description: `${String(selectedCount)} ${resourceLabel} selected`,
      })
    }
  }

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 flex flex-wrap items-center gap-2">
      <Badge>{selectedCount} selected</Badge>
      <span className="text-sm text-muted-foreground">Batch actions for {resourceLabel}</span>
      <div className="ml-auto flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => execute('start')}>Start</Button>
        <Button size="sm" variant="outline" onClick={() => execute('stop')}>Stop</Button>
        <Button size="sm" variant="outline" onClick={() => execute('restart')}>Restart</Button>
        <Button size="sm" variant="outline" onClick={() => execute('update')}>Update</Button>
        <Button size="sm" variant="destructive" onClick={() => execute('remove')}>Remove</Button>
        <Button size="sm" variant="ghost" onClick={onClearSelection}>Clear</Button>
      </div>
    </div>
  )
}
