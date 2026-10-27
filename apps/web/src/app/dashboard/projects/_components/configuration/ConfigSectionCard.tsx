'use client'

import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { getErrorMessage, isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE } from '@/lib/orpc/typed-errors'
import { InlineError } from '../workload/WorkloadStates'

/** The slice of a TanStack query a section needs. */
export interface ConfigQuery<T> {
  data: T | undefined
  isLoading: boolean
  error: unknown
  refetch: () => unknown
}

/**
 * One editable settings card: read view → Edit → draft form → Save.
 * The draft is seeded from the server value when Edit is clicked, so there is
 * no sync effect and a refetch never clobbers what the operator is typing.
 */
export function ConfigSectionCard<T extends object>({
  title,
  description,
  query,
  renderView,
  renderEdit,
  onSave,
  saving,
  notice,
}: {
  title: string
  description: ReactNode
  query: ConfigQuery<T>
  renderView: (config: T) => ReactNode
  renderEdit: (draft: T, setDraft: (next: T) => void) => ReactNode
  onSave: (draft: T) => Promise<void>
  saving: boolean
  notice?: ReactNode
}) {
  const [draft, setDraft] = useState<T | null>(null)
  const config = query.data

  const save = async () => {
    if (!draft) return
    try {
      await onSave(draft)
      toast.success(`${title} saved`)
      setDraft(null)
    } catch (err) {
      toast.error(`Failed to save ${title.toLowerCase()}`, { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  let body: ReactNode
  if (query.error && !config) {
    body = <InlineError title={`Could not load ${title.toLowerCase()}`} error={query.error} onRetry={() => { void query.refetch() }} />
  } else if (!config) {
    body = query.isLoading ? <Skeleton className="h-16 w-full" aria-label={`Loading ${title.toLowerCase()}`} /> : <p className="text-sm text-muted-foreground">No configuration returned for this project.</p>
  } else {
    body = (
      <>
        {notice ? <p className="mb-3 text-sm text-muted-foreground">{notice}</p> : null}
        {draft ? renderEdit(draft, setDraft) : renderView(config)}
      </>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {draft ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setDraft(null) }} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={() => { void save() }} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" disabled={!config} onClick={() => { if (config) setDraft({ ...config }) }}>Edit</Button>
        )}
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}

/** One "label: value" cell of a read view. */
export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return <div><span className="text-muted-foreground">{label}:</span> {children}</div>
}

/** Number input value → number (empty field keeps the previous value rather than writing 0). */
export function parseNumber(raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}
