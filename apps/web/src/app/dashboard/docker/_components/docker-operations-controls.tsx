'use client'

import { useEffect } from 'react'
import { getMockOperationProgress } from '@/mocks/platform/entities/docker.large.mock'
import type { DockerOperationProgressItem } from '@/mocks/platform/types'
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
    <select
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

interface DockerOperationProgressPanelProps {
  resourceType: DockerOperationProgressItem['resourceType']
}

function statusVariant(status: DockerOperationProgressItem['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'success') return 'default'
  if (status === 'failed') return 'destructive'
  if (status === 'running') return 'secondary'
  return 'outline'
}

export function DockerOperationProgressPanel({ resourceType }: DockerOperationProgressPanelProps) {
  const operations = getMockOperationProgress(resourceType)

  return (
    <section className="rounded-xl border border-border/60 bg-card/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Operation queue</h3>
        <Badge variant="outline">mock stream</Badge>
      </div>
      <div className="space-y-2">
        {operations.map((operation) => (
          <div key={operation.id} className="rounded border p-2 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">{operation.action} · {operation.resourceName}</p>
              <Badge variant={statusVariant(operation.status)}>{operation.status}</Badge>
            </div>
            <div className="h-1.5 rounded bg-muted overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${String(operation.progress)}%` }} />
            </div>
            <p className="text-[11px] text-muted-foreground">{operation.progress}% · {operation.updatedAt}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
