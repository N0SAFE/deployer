'use client'

import { useState } from 'react'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@deployer/ui/components/shadcn/collapsible'
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react'
import type { useRunnerDetection } from '../runner-detection-context'

/** Compact detection summary — one line + expandable details. */
export function DetectionSummary({ hints, builderId }: {
  hints: ReturnType<typeof useRunnerDetection>['hints']
  builderId: string | null
}) {
  const [open, setOpen] = useState(false)
  if (!hints) return null

  const summary = [
    hints.startCommand ? `start: ${hints.startCommand}` : null,
    hints.ports && hints.ports.length > 0 ? `ports: ${hints.ports.join(', ')}` : null,
    hints.composeFile ? `compose: ${hints.composeFile}` : null,
    hints.composeServices?.length ? `${String(hints.composeServices.length)} sub-services` : null,
  ].filter(Boolean).join(' · ')

  const recommendations = hints.recommendations ?? []

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left">
            <Sparkles className="size-3.5 shrink-0 text-primary" />
            <span className="text-xs font-medium">Auto-detected</span>
            {builderId && <Badge variant="outline" className="text-xs">{builderId}</Badge>}
            {summary && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</span>}
            {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t px-3 py-2">
          {recommendations.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Found</span>
              {recommendations.map((r) => (
                <Badge key={`${r.kind}-${r.path}`} variant="secondary" className="gap-1.5 text-xs">
                  <span className="capitalize">{r.kind}</span>
                  <code className="font-mono text-xs text-muted-foreground">{r.path}</code>
                </Badge>
              ))}
            </div>
          )}
          {recommendations.length === 0 && <p className="text-xs text-muted-foreground">No additional files to recommend.</p>}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
