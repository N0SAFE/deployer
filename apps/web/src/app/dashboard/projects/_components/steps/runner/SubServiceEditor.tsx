'use client'

import { useState } from 'react'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Field, FieldLabel, FieldDescription } from '@deployer/ui/components/shadcn/field'
import { Sparkles, Plus, X, Layers, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@deployer/ui/lib/utils'
import type { CreateServiceFormApi } from '../../CreateService.hook'
import { useRunnerDetection } from '../runner-detection-context'
import { subServicesFromHints } from '../runner-presets'
import type { OrchestratorSubService } from '../runner-types'
import { emptySubService } from './sub-service-defaults'
import { SubServiceTabs } from './SubServiceTabs'

/** Collapsed summary row for a sub-service. */
function SubServiceRow({ svc, index, expanded, onToggle, onRemove }: {
  svc: OrchestratorSubService
  index: number
  expanded: boolean
  onToggle: () => void
  onRemove: () => void
}) {
  const facts = [
    svc.port ? `:${String(svc.port)}` : null,
    svc.ports.length > 0 ? `ports: ${svc.ports.join(', ')}` : null,
    svc.visibility,
    svc.replicas > 1 ? `×${String(svc.replicas)}` : null,
    Object.keys(svc.environment).length > 0 ? `${String(Object.keys(svc.environment).length)} env` : null,
    svc.volumes.length > 0 ? `${String(svc.volumes.length)} vol` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className={cn('rounded-lg border bg-background/40', expanded && 'border-primary/40')}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {expanded ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
          <Layers className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium">{svc.name || `service-${String(index + 1)}`}</span>
          {svc.image ? <code className="truncate font-mono text-xs text-muted-foreground">{svc.image}</code> : null}
        </button>
        {facts && <span className="hidden max-w-[45%] shrink-0 truncate text-xs text-muted-foreground sm:block" title={facts}>{facts}</span>}
        <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" aria-label={`Remove ${svc.name || 'service'}`} onClick={onRemove}>
          <X className="size-3" />
        </Button>
      </div>
    </div>
  )
}

export function SubServiceEditor({ form }: { form: CreateServiceFormApi }) {
  const { hints } = useRunnerDetection()
  const [adding, setAdding] = useState(false)
  // Only ONE sub-service expanded at a time (null = none).
  const [expanded, setExpanded] = useState<number | null>(null)

  return (
    <form.Subscribe selector={(s) => (s.values.runner.runnerId === 'orchestrator' ? ((s.values.runner.config as { environment?: Record<string, string> }).environment ?? {}) : {})} children={(mainEnv) => (
      <form.Field name="runner.config.subServices" children={(f) => {
      const items = (f.state.value as never as OrchestratorSubService[] | undefined) ?? []
      const update = (next: OrchestratorSubService[]) => { f.handleChange(next) }
      const patch = (index: number, partial: Partial<OrchestratorSubService>) => {
        const nv = [...items]
        const current: OrchestratorSubService = nv[index] ?? emptySubService(index)
        nv[index] = { ...current, ...partial }
        update(nv)
      }
      const patchNested = (index: number, path: 'build' | 'healthCheck' | 'resources' | 'tls', partial: Record<string, unknown>) => {
        const nv = [...items]
        const current = nv[index]
        if (!current) return
        const existing = current[path]
        nv[index] = { ...current, [path]: { ...(existing ?? {}), ...partial } }
        update(nv)
      }

      return (
        <Field>
          <FieldLabel className="flex items-center gap-2">
            <Layers className="size-3.5" /> Sub-services
            {items.length > 0 && <Badge variant="outline" className="text-xs">{String(items.length)}</Badge>}
          </FieldLabel>
          <FieldDescription>
            {items.length === 0
              ? 'A sub-service is one container from your compose file, deployed and monitored on its own. Import the detected ones or add them by hand, then expand a row to configure it.'
              : 'Expand a sub-service to configure it. Only one is open at a time.'}
          </FieldDescription>

          {items.length === 0 && !adding && (
            <div className="space-y-2">
              {hints?.composeServices && hints.composeServices.length > 0 && (
                <Button type="button" size="sm" variant="outline" className="w-fit gap-1.5" onClick={() => {
                  const detected = hints.composeServices
                  if (!detected) return
                  update(subServicesFromHints(detected))
                  setExpanded(0)
                }}>
                  <Sparkles className="size-3.5 text-primary" /> Import detected services
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" className="w-fit gap-1.5" onClick={() => { setAdding(true) }}>
                <Plus className="size-3.5" /> Add manually
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            {items.map((svc, i) => (
              <div key={i}>
                <SubServiceRow
                  svc={svc}
                  index={i}
                  expanded={expanded === i}
                  onToggle={() => { setExpanded(expanded === i ? null : i) }}
                  onRemove={() => {
                    update(items.filter((_, idx) => idx !== i))
                    if (expanded === i) setExpanded(null)
                  }}
                />
                {expanded === i && (
                  <SubServiceTabs
                    svc={svc}
                    mainEnv={mainEnv}
                    onPatch={(partial) => { patch(i, partial) }}
                    onPatchNested={(path, partial) => { patchNested(i, path, partial) }}
                  />
                )}
              </div>
            ))}
          </div>

          {adding && (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Image to run, e.g. nginx:alpine — press Enter to add" aria-label="Image for the new sub-service"
                className="font-mono text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                    const next: OrchestratorSubService = { ...emptySubService(items.length), image: e.currentTarget.value.trim() }
                    update([...items, next])
                    setAdding(false)
                    setExpanded(items.length)
                  }
                }}
              />
              <Button type="button" size="sm" variant="outline" onClick={() => { setAdding(false) }}>Cancel</Button>
            </div>
          )}

          {items.length > 0 && (
            <Button type="button" size="sm" variant="ghost" className="w-fit gap-1.5" onClick={() => { setAdding(true) }}>
              <Plus className="size-3.5" /> Add sub-service
            </Button>
          )}
        </Field>
      )
    }} />
    )} />
  )
}
