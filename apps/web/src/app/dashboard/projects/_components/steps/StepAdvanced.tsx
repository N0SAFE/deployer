'use client'

import { useState } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Field, FieldLabel } from '@repo/ui/components/shadcn/field'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@repo/ui/components/shadcn/collapsible'
import { Plus, X, ChevronDown, ChevronRight, KeyRound, Layers, Boxes, Cpu, MemoryStick } from 'lucide-react'
import type { CreateServiceFormApi, OrchestratorSubService } from '../CreateService.hook'

/* ─── Key/value editor (advanced env vars) ─────────────────────────── */

function EnvRowEditor({ items, onChange }: {
  items: { key: string; value: string }[]
  onChange: (next: { key: string; value: string }[]) => void
}) {
  const update = (next: { key: string; value: string }[]) => { onChange(next) }
  return (
    <div className="space-y-1.5">
      {items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No platform environment variables. These are injected on top of the runner&apos;s own
          environment.
        </p>
      )}
      {items.map((entry, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={entry.key}
            onChange={(e) => { const nv = [...items]; if (nv[i]) { nv[i] = { ...nv[i], key: e.target.value }; update(nv) } }}
            placeholder="DATABASE_URL"
            className="h-7 w-56 font-mono text-xs"
          />
          <span className="text-muted-foreground">=</span>
          <Input
            value={entry.value}
            onChange={(e) => { const nv = [...items]; if (nv[i]) { nv[i] = { ...nv[i], value: e.target.value }; update(nv) } }}
            placeholder="postgres://…"
            className="h-7 flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            onClick={() => { update(items.filter((_, idx) => idx !== i)) }}
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-6 w-fit gap-1 text-[11px]" onClick={() => { update([...items, { key: '', value: '' }]) }}>
        <Plus className="size-3" /> Add variable
      </Button>
    </div>
  )
}

/* ─── Per-sub-service effective env preview ────────────────────────── */

function SubServiceEnvCard({ svc, mainEnv }: {
  svc: OrchestratorSubService
  mainEnv: Record<string, string>
}) {
  const [open, setOpen] = useState(false)
  const overrideKeys = Object.keys(svc.environment)
  const cascadedKeys = Object.keys(mainEnv).filter((k) => !(k in svc.environment))
  const effective = { ...mainEnv, ...svc.environment }
  const total = Object.keys(effective).length

  return (
    <div className="rounded-lg border bg-background/40">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center gap-2 px-2.5 py-2 text-left">
            {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
            <Layers className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-xs font-medium">{svc.name}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {overrideKeys.length > 0 && <Badge variant="outline" className="text-[9px] text-primary">{String(overrideKeys.length)} override</Badge>}
              {cascadedKeys.length > 0 && <Badge variant="secondary" className="text-[9px]">{String(cascadedKeys.length)} cascaded</Badge>}
              <span className="text-[10px] tabular-nums text-muted-foreground">{String(total)} total</span>
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t px-2.5 py-2">
          {total === 0 ? (
            <p className="text-[11px] text-muted-foreground">No environment variables.</p>
          ) : (
            <div className="space-y-0.5">
              {Object.entries(effective).map(([k, v]) => {
                const isOverride = k in svc.environment
                return (
                  <div key={k} className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="truncate">{k}</span>
                    <span className="flex-1 truncate text-muted-foreground">{v || '\u2014'}</span>
                    {isOverride
                      ? <Badge variant="outline" className="shrink-0 text-[8px] text-primary">override</Badge>
                      : <Badge variant="secondary" className="shrink-0 text-[8px]">cascade</Badge>}
                  </div>
                )
              })}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

/* ─── Section wrapper ──────────────────────────────────────────────── */

function Section({ title, description, icon, children }: {
  title: string
  description?: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-background/40 p-4">
      <div>
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          {icon}{title}
        </h4>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  )
}

/* ─── Main step ────────────────────────────────────────────────────── */

export function StepAdvanced({ form }: { form: CreateServiceFormApi }) {
  return (
    <form.Subscribe
      selector={(s) => {
        const runnerId = s.values.runner.runnerId
        const rc = s.values.runner.config as never as {
          environment?: Record<string, string>
          subServices?: OrchestratorSubService[]
        } | undefined
        return {
          isOrchestrator: runnerId === 'orchestrator',
          mainEnv: (runnerId === 'orchestrator' ? rc?.environment : undefined) ?? {},
          subServices: (runnerId === 'orchestrator' ? rc?.subServices : undefined) ?? [],
        }
      }}
      children={({ isOrchestrator, mainEnv, subServices }) => (
        <div className="space-y-4">
          {/* ── Environment cascade landscape (orchestrator) ── */}
          {isOrchestrator && (
            <Section
              title="Environment cascade"
              description="How environment variables flow from the platform down to each sub-service. A sub-service's own value always wins over the cascaded one."
              icon={<KeyRound className="size-3.5 text-primary" />}
            >
              {/* Orchestrator main env (cascades to all sub-services) */}
              <div className="rounded-md border bg-background/40 p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Orchestrator main (cascades)
                  </p>
                  {Object.keys(mainEnv).length > 0 && (
                    <Badge variant="outline" className="text-[9px]">{String(Object.keys(mainEnv).length)} vars → all sub-services</Badge>
                  )}
                </div>
                <form.Field name="runner.config.environment" children={(f) => (
                  <EnvRowEditor
                    items={Object.entries((f.state.value as Record<string, string> | undefined) ?? {}).map(([key, value]) => ({ key, value }))}
                    onChange={(rows) => {
                      const next: Record<string, string> = {}
                      for (const r of rows) { if (r.key) next[r.key] = r.value }
                      f.handleChange(next)
                    }}
                  />
                )} />
              </div>

              {/* Per-sub-service effective env */}
              <div className="space-y-1.5">
                {subServices.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    No sub-services yet — import them in the Runner step to see per-service variables.
                  </p>
                ) : (
                  subServices.map((svc) => (
                    <SubServiceEnvCard key={svc.name || `svc-${String(subServices.indexOf(svc))}`} svc={svc} mainEnv={mainEnv} />
                  ))
                )}
              </div>
            </Section>
          )}

          {/* ── Platform environment variables ── */}
          <Section
            title="Platform environment variables"
            description="Extra variables injected by the platform for this service. They are merged on top of the runner environment (a later layer wins)."
            icon={<KeyRound className="size-3.5 text-muted-foreground" />}
          >
            <form.Field name="advanced.environmentVariables" mode="array" children={(field) => (
              <EnvRowEditor
                items={(field.state.value as { key: string; value: string }[] | undefined) ?? []}
                onChange={(rows) => { field.handleChange(rows) }}
              />
            )} />
          </Section>

          {/* ── Resource limits ── */}
          <Section
            title="Resource limits"
            description="CPU & memory ceilings for the deployed workload. Leave unset for no limit."
            icon={<Cpu className="size-3.5 text-muted-foreground" />}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <form.Field name="advanced.resourceLimits.memory" children={(f) => (
                <Field>
                  <FieldLabel className="flex items-center gap-1 text-xs"><MemoryStick className="size-3" /> Memory limit</FieldLabel>
                  <Select value={f.state.value ?? ''} onValueChange={(v) => { f.handleChange(v || undefined) }}>
                    <SelectTrigger><SelectValue placeholder="No limit" /></SelectTrigger>
                    <SelectContent>
                      {['128m', '256m', '512m', '1g', '2g', '4g', '8g'].map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </Field>
              )} />
              <form.Field name="advanced.resourceLimits.cpu" children={(f) => (
                <Field>
                  <FieldLabel className="flex items-center gap-1 text-xs"><Cpu className="size-3" /> CPU limit</FieldLabel>
                  <Select value={f.state.value ?? ''} onValueChange={(v) => { f.handleChange(v || undefined) }}>
                    <SelectTrigger><SelectValue placeholder="No limit" /></SelectTrigger>
                    <SelectContent>
                      {['0.25', '0.5', '1', '2', '4', '8'].map((c) => (<SelectItem key={c} value={c}>{c} CPU</SelectItem>))}
                    </SelectContent>
                  </Select>
                </Field>
              )} />
            </div>

            {/* Per-sub-service resource summary */}
            {isOrchestrator && subServices.length > 0 && (
              <div className="mt-3 space-y-1 border-t pt-3">
                <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <Boxes className="size-3" /> Per sub-service resources
                </p>
                {subServices.map((svc) => {
                  const r = svc.resources
                  return (
                    <div key={svc.name || 'svc'} className="flex items-center gap-2 rounded-md border bg-background/40 px-2.5 py-1.5 text-[11px]">
                      <span className="truncate font-medium">{svc.name}</span>
                      <span className="flex-1" />
                      {r?.cpus ? <Badge variant="secondary" className="gap-1 text-[9px]"><Cpu className="size-2.5" /> {String(r.cpus)} CPU</Badge> : null}
                      {r?.memory ? <Badge variant="secondary" className="gap-1 text-[9px]"><MemoryStick className="size-2.5" /> {r.memory}</Badge> : null}
                      {!r?.cpus && !r?.memory ? <span className="text-[10px] text-muted-foreground">no limits</span> : null}
                    </div>
                  )
                })}
              </div>
            )}
          </Section>
        </div>
      )}
    />
  )
}
