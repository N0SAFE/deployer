'use client'

import { useState } from 'react'
import { Input } from '@repo/ui/components/shadcn/input'
import { Button } from '@repo/ui/components/shadcn/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Checkbox } from '@repo/ui/components/shadcn/checkbox'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Field, FieldLabel, FieldDescription } from '@repo/ui/components/shadcn/field'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@repo/ui/components/shadcn/tabs'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@repo/ui/components/shadcn/collapsible'
import { Check, Sparkles, Plus, X, Layers, ChevronDown, ChevronRight, Loader2, ShipWheel } from 'lucide-react'
import { cn } from '@repo/ui/lib/utils'
import type { CreateServiceFormApi, RunnerFormData } from '../CreateService.hook'
import { githubAppEndpoints } from '@/domains/github-apps/endpoints'
import { useRunnerDetection } from './runner-detection-context'
import { RUNNER_META, RUNNER_DEFAULT_CONFIG, subServicesFromHints } from './runner-presets'
import { AutocompleteField } from './autocomplete-field'
import { SearchableSelect } from './searchable-select'
import type { OrchestratorSubService } from './runner-types'

/* ─── Small primitives ─────────────────────────────────────────────── */

function TagsInput({ value, onChange, placeholder }: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  return (
    <Input
      value={value.join(', ')}
      onChange={(e) => { onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean)) }}
      placeholder={placeholder}
      className="font-mono text-xs"
    />
  )
}

function NumberField({ value, onChange, options, placeholder }: {
  value: number
  onChange: (v: number) => void
  options: readonly string[]
  placeholder?: string
}) {
  const current = String(value)
  const all = options.includes(current) ? [...options] : [current, ...options]
  return (
    <Select value={current} onValueChange={(v) => { onChange(Number(v)) }}>
      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {all.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
      </SelectContent>
    </Select>
  )
}

function KeyValueEditor({ value, onChange, keyPlaceholder, valuePlaceholder }: {
  value: Record<string, string>
  onChange: (next: Record<string, string>) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  const entries = Object.entries(value)
  const update = (next: Record<string, string>) => { onChange(next) }
  return (
    <div className="space-y-1.5">
      {entries.length === 0 && <p className="text-xs text-muted-foreground">No entries.</p>}
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-1.5">
          <Input
            value={k}
            onChange={(e) => {
              const nv: Record<string, string> = {}
              for (const [kk, vv] of Object.entries(value)) { if (kk !== k) nv[kk] = vv }
              if (e.target.value) nv[e.target.value] = v
              update(nv)
            }}
            placeholder={keyPlaceholder}
            className="h-7 font-mono text-xs"
          />
          <span className="text-muted-foreground">=</span>
          <Input
            value={v}
            onChange={(e) => { update({ ...value, [k]: e.target.value }) }}
            placeholder={valuePlaceholder}
            className="h-7 flex-1 font-mono text-xs"
          />
          <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" onClick={() => {
            const nv: Record<string, string> = {}
            for (const [kk, vv] of Object.entries(value)) { if (kk !== k) nv[kk] = vv }
            update(nv)
          }}>
            <X className="size-3" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-6 w-fit gap-1 text-[11px]" onClick={() => {
        update({ ...value, [`key${String(entries.length + 1)}`]: '' })
      }}>
        <Plus className="size-3" /> Add
      </Button>
    </div>
  )
}

/** Common container image presets for fluent image selection. */
const IMAGE_PRESETS = [
  'node:22-alpine', 'node:20-alpine', 'nginx:alpine', 'nginx:latest',
  'postgres:16-alpine', 'postgres:15-alpine', 'redis:7-alpine',
  'python:3.12-slim', 'python:3.11-slim', 'ghcr.io/your-org/app:latest',
] as const

/** Common healthcheck commands for fluent selection. */
const HEALTHCHECK_PRESETS = [
  'CMD-SHELL curl -f http://localhost:3000/health',
  'CMD-SHELL wget -q --spider http://localhost:3000/health',
  'CMD-SHELL pg_isready -U postgres',
  'CMD-SHELL redis-cli ping',
  'CMD exit 0',
] as const

/* ─── Sub-service editor (progressive disclosure) ──────────────────── */

function emptySubService(index: number): OrchestratorSubService {
  return {
    name: `svc-${String(index + 1)}`,
    image: '',
    ports: [],
    portMappings: [],
    expose: false,
    tls: { enabled: false, httpRedirect: true },
    networks: [],
    customDomains: [],
    environment: {},
    volumes: [],
    labels: {},
    secrets: [],
    dependsOn: [],
    dependsOnCondition: 'service_started',
    replicas: 1,
    restart: 'no',
    build: { args: {} },
  }
}

/** Compact port-forward editor for a sub-service. */
function SubPortMappingEditor({ value, onChange }: {
  value: { containerPort: number; hostPort?: number; protocol: 'tcp' | 'udp'; name?: string }[]
  onChange: (next: { containerPort: number; hostPort?: number; protocol: 'tcp' | 'udp'; name?: string }[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [containerPort, setContainerPort] = useState('')
  const [hostPort, setHostPort] = useState('')
  const [protocol, setProtocol] = useState<'tcp' | 'udp'>('tcp')

  const commit = () => {
    const cp = Number(containerPort)
    if (!Number.isInteger(cp) || cp <= 0) return
    const hp = hostPort.trim() ? Number(hostPort) : undefined
    onChange([...value, { containerPort: cp, hostPort: hp, protocol, name: `mapping-${String(value.length + 1)}` }])
    setContainerPort(''); setHostPort(''); setProtocol('tcp'); setAdding(false)
  }

  return (
    <div className="space-y-1.5">
      {value.length === 0 && <p className="text-[11px] text-muted-foreground">No extra forwards.</p>}
      {value.map((m, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded border px-2 py-1 text-[11px]">
          <span className="font-mono text-muted-foreground">{m.protocol}</span>
          <code className="font-mono">{m.hostPort ?? 'auto'}</code>
          <span className="text-muted-foreground">→</span>
          <code className="font-mono">{m.containerPort}</code>
          <span className="flex-1" />
          <Button type="button" variant="ghost" size="icon" className="size-5" onClick={() => { onChange(value.filter((_, idx) => idx !== i)) }}>
            <X className="size-3" />
          </Button>
        </div>
      ))}
      {adding ? (
        <div className="flex items-center gap-1.5">
          <Select value={protocol} onValueChange={(v) => { setProtocol(v as 'tcp' | 'udp') }}>
            <SelectTrigger className="h-6 w-16 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tcp">tcp</SelectItem>
              <SelectItem value="udp">udp</SelectItem>
            </SelectContent>
          </Select>
          <Input value={hostPort} onChange={(e) => { setHostPort(e.target.value) }} placeholder="host" className="h-6 w-16 font-mono text-[11px]" />
          <span className="text-[11px] text-muted-foreground">→</span>
          <Input value={containerPort} onChange={(e) => { setContainerPort(e.target.value) }} placeholder="container" className="h-6 w-20 font-mono text-[11px]" />
          <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={commit}>Add</Button>
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => { setAdding(false) }}>Cancel</Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" className="h-6 w-fit gap-1 text-[11px]" onClick={() => { setAdding(true) }}>
          <Plus className="size-3" /> Add forward
        </Button>
      )}
    </div>
  )
}

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
    svc.expose ? 'internet' : 'internal',
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
          {svc.image ? <code className="truncate font-mono text-[10px] text-muted-foreground">{svc.image}</code> : null}
        </button>
        {facts && <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:block">{facts}</span>}
        <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" onClick={onRemove}>
          <X className="size-3" />
        </Button>
      </div>
    </div>
  )
}

/** Expanded sub-service editor — tabbed, one concern at a time. */
function SubServiceEditorExpanded({ svc, mainEnv, onPatch, onPatchNested }: {
  svc: OrchestratorSubService
  mainEnv: Record<string, string>
  onPatch: (partial: Partial<OrchestratorSubService>) => void
  onPatchNested: (path: 'build' | 'healthCheck' | 'resources' | 'tls', partial: Record<string, unknown>) => void
}) {
  return (
    <div className="rounded-lg border border-t-0 bg-background/60 px-3 pb-3 pt-2">
      <Tabs defaultValue="basics">
        <TabsList className="w-full">
          <TabsTrigger value="basics">Basics</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="scale">Scale</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>

        {/* ── Basics ── */}
        <TabsContent value="basics" className="mt-2 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field><FieldLabel className="text-[11px]">Name</FieldLabel><Input value={svc.name} onChange={(e) => { onPatch({ name: e.target.value }) }} placeholder="service-name" className="text-xs" /></Field>
            <Field>
              <FieldLabel className="text-[11px]">Image</FieldLabel>
              <AutocompleteField
                value={svc.image}
                onChange={(v) => { onPatch({ image: v }) }}
                options={IMAGE_PRESETS}
                placeholder="nginx:alpine"
              />
            </Field>
            <Field><FieldLabel className="text-[11px]">Command</FieldLabel><Input value={svc.command ?? ''} onChange={(e) => { onPatch({ command: e.target.value }) }} placeholder="npm start" className="font-mono text-xs" /></Field>
            <Field><FieldLabel className="text-[11px]">Entrypoint</FieldLabel><Input value={svc.entrypoint ?? ''} onChange={(e) => { onPatch({ entrypoint: e.target.value }) }} placeholder="/entrypoint.sh" className="font-mono text-xs" /></Field>
          </div>
          <div className="rounded-md border bg-background/40 p-2.5">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Build (optional)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field><FieldLabel className="text-[11px]">Context</FieldLabel><Input value={svc.build?.context ?? ''} onChange={(e) => { onPatchNested('build', { context: e.target.value }) }} placeholder="." className="font-mono text-xs" /></Field>
              <Field><FieldLabel className="text-[11px]">Dockerfile</FieldLabel><Input value={svc.build?.dockerfile ?? ''} onChange={(e) => { onPatchNested('build', { dockerfile: e.target.value }) }} placeholder="Dockerfile" className="font-mono text-xs" /></Field>
            </div>
            <Field className="mt-2">
              <FieldLabel className="text-[11px]">Build args</FieldLabel>
              <KeyValueEditor value={svc.build?.args ?? {}} onChange={(args) => { onPatchNested('build', { args }) }} keyPlaceholder="ARG" valuePlaceholder="value" />
            </Field>
          </div>
        </TabsContent>

        {/* ── Network ── */}
        <TabsContent value="network" className="mt-2 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field>
              <FieldLabel className="text-[11px]">Primary port</FieldLabel>
              <Input type="number" value={svc.port ?? ''} onChange={(e) => { onPatch({ port: e.target.value ? Number(e.target.value) : undefined }) }} placeholder="3000" className="text-xs" />
            </Field>
            <Field>
              <FieldLabel className="text-[11px]">Expose to internet</FieldLabel>
              <div className="flex items-center gap-2">
                <Switch checked={svc.expose} onCheckedChange={(c) => { onPatch({ expose: c }) }} />
                <span className="text-[11px] text-muted-foreground">Ingress (Traefik)</span>
              </div>
            </Field>
            <Field><FieldLabel className="text-[11px]">Container ports</FieldLabel><TagsInput value={svc.ports.map(String)} onChange={(v) => { onPatch({ ports: v.map(Number) }) }} placeholder="80, 443" /></Field>
            <Field><FieldLabel className="text-[11px]">Networks</FieldLabel><TagsInput value={svc.networks} onChange={(v) => { onPatch({ networks: v }) }} placeholder="frontend, backend" /></Field>
          </div>
          <Field>
            <FieldLabel className="text-[11px]">Port forwards</FieldLabel>
            <SubPortMappingEditor value={svc.portMappings} onChange={(portMappings) => { onPatch({ portMappings }) }} />
          </Field>
          {svc.expose && (
            <div className="space-y-2 rounded-md border bg-background/40 p-2.5">
              <div className="flex items-center gap-2">
                <Switch checked={svc.tls.enabled} onCheckedChange={(c) => { onPatchNested('tls', { enabled: c }) }} />
                <span className="text-[11px] text-muted-foreground">TLS termination</span>
              </div>
              {svc.tls.enabled && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field>
                    <FieldLabel className="text-[11px]">Certificate secret</FieldLabel>
                    <AutocompleteField value={svc.tls.certSecretRef ?? ''} onChange={(v) => { onPatchNested('tls', { certSecretRef: v }) }} options={['letsencrypt', 'cloudflare-origin', 'wildcard-prod', 'wildcard-staging']} placeholder="letsencrypt" />
                  </Field>
                  <div className="flex items-end gap-2 pb-1">
                    <Checkbox checked={svc.tls.httpRedirect} onCheckedChange={(c) => { onPatchNested('tls', { httpRedirect: c === true }) }} />
                    <span className="text-[11px] text-muted-foreground">Redirect HTTP → HTTPS</span>
                  </div>
                </div>
              )}
            </div>
          )}
          <Field>
            <FieldLabel className="text-[11px]">Custom domains</FieldLabel>
            <TagsInput value={svc.customDomains} onChange={(v) => { onPatch({ customDomains: v }) }} placeholder="app.example.com, api.example.com" />
          </Field>
        </TabsContent>

        {/* ── Config & storage ── */}
        <TabsContent value="config" className="mt-2 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field>
              <FieldLabel className="flex items-center gap-1 text-[11px]">
                Environment (overrides)
                {Object.keys(mainEnv).length > 0 && <Badge variant="outline" className="text-[9px]">{String(Object.keys(mainEnv).length)} cascade</Badge>}
              </FieldLabel>
              <KeyValueEditor value={svc.environment} onChange={(environment) => { onPatch({ environment }) }} keyPlaceholder="KEY" valuePlaceholder="value" />
            </Field>
            <Field>
              <FieldLabel className="text-[11px]">Volumes</FieldLabel>
              <TagsInput value={svc.volumes} onChange={(v) => { onPatch({ volumes: v }) }} placeholder="/data:/app/data" />
            </Field>
            <Field>
              <FieldLabel className="text-[11px]">Labels</FieldLabel>
              <KeyValueEditor value={svc.labels} onChange={(labels) => { onPatch({ labels }) }} keyPlaceholder="key" valuePlaceholder="value" />
            </Field>
            <Field><FieldLabel className="text-[11px]">Secrets</FieldLabel><TagsInput value={svc.secrets} onChange={(v) => { onPatch({ secrets: v }) }} placeholder="db-password" /></Field>
          </div>
        </TabsContent>

        {/* ── Scaling ── */}
        <TabsContent value="scale" className="mt-2 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field><FieldLabel className="text-[11px]">Depends on</FieldLabel><TagsInput value={svc.dependsOn} onChange={(v) => { onPatch({ dependsOn: v }) }} placeholder="db, cache" /></Field>
            <Field>
              <FieldLabel className="text-[11px]">Depends condition</FieldLabel>
              <Select value={svc.dependsOnCondition} onValueChange={(v) => { onPatch({ dependsOnCondition: v as OrchestratorSubService['dependsOnCondition'] }) }}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="service_started">Started</SelectItem>
                  <SelectItem value="service_healthy">Healthy</SelectItem>
                  <SelectItem value="service_completed_successfully">Completed</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel className="text-[11px]">Replicas</FieldLabel>
              <NumberField value={svc.replicas} onChange={(v) => { onPatch({ replicas: v }) }} options={['1', '2', '3', '5', '10']} placeholder="1" />
            </Field>
            <Field>
              <FieldLabel className="text-[11px]">Restart policy</FieldLabel>
              <Select value={svc.restart} onValueChange={(v) => { onPatch({ restart: v as OrchestratorSubService['restart'] }) }}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">no</SelectItem>
                  <SelectItem value="always">always</SelectItem>
                  <SelectItem value="on-failure">on-failure</SelectItem>
                  <SelectItem value="unless-stopped">unless-stopped</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </TabsContent>

        {/* ── Health & resources ── */}
        <TabsContent value="health" className="mt-2 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field>
              <FieldLabel className="text-[11px]">Healthcheck</FieldLabel>
              <AutocompleteField
                value={(svc.healthCheck?.test ?? []).join(' ')}
                onChange={(v) => {
                  const parts = v.trim() ? v.trim().split(/\s+/) : ['CMD-SHELL', 'exit 0']
                  onPatchNested('healthCheck', { test: parts })
                }}
                options={HEALTHCHECK_PRESETS}
                placeholder="CMD-SHELL curl -f http://localhost:3000/health"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field>
                <FieldLabel className="text-[11px]">Interval (s)</FieldLabel>
                <NumberField value={svc.healthCheck?.interval ?? 30} onChange={(v) => { onPatchNested('healthCheck', { interval: v }) }} options={['10', '15', '30', '60', '120']} placeholder="30" />
              </Field>
              <Field>
                <FieldLabel className="text-[11px]">Timeout (s)</FieldLabel>
                <NumberField value={svc.healthCheck?.timeout ?? 10} onChange={(v) => { onPatchNested('healthCheck', { timeout: v }) }} options={['3', '5', '10', '30']} placeholder="10" />
              </Field>
              <Field>
                <FieldLabel className="text-[11px]">Retries</FieldLabel>
                <NumberField value={svc.healthCheck?.retries ?? 3} onChange={(v) => { onPatchNested('healthCheck', { retries: v }) }} options={['0', '1', '3', '5', '10']} placeholder="3" />
              </Field>
              <Field>
                <FieldLabel className="text-[11px]">CPU</FieldLabel>
                <Input type="number" step="0.1" value={svc.resources?.cpus ?? ''} onChange={(e) => { onPatchNested('resources', { cpus: e.target.value ? Number(e.target.value) : undefined }) }} placeholder="1.0" className="text-xs" />
              </Field>
              <Field>
                <FieldLabel className="text-[11px]">Memory</FieldLabel>
                <Input value={svc.resources?.memory ?? ''} onChange={(e) => { onPatchNested('resources', { memory: e.target.value }) }} placeholder="512m" className="font-mono text-xs" />
              </Field>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SubServiceEditor({ form }: { form: CreateServiceFormApi }) {
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
            {items.length > 0 && <Badge variant="outline" className="text-[10px]">{String(items.length)}</Badge>}
          </FieldLabel>
          <FieldDescription>
            {items.length === 0
              ? 'Services detected in the compose manifest. Expand a row to configure it — everything starts collapsed so only what you need is visible.'
              : 'Expand a service to configure it. Only one service is open at a time.'}
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
                  <SubServiceEditorExpanded
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
                placeholder="image:tag"
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

/* ─── Per-runner configuration fields ──────────────────────────────── */

/** Orchestrator fields: compose file + cascade env + sub-services. */
function OrchestratorFields({ form, hints }: {
  form: CreateServiceFormApi
  hints: ReturnType<typeof useRunnerDetection>['hints']
}) {
  const { source, setDetection } = useRunnerDetection()
  const [redetecting, setRedetecting] = useState(false)

  const handleComposeChange = async (path: string) => {
    form.setFieldValue('runner.config.composeFile', path)
    if (!source) return
    // Re-detect sub-services for the newly selected compose file and replace
    // the existing sub-services with the auto-detected ones.
    setRedetecting(true)
    try {
      const result = await githubAppEndpoints.detectRunner.call({
        params: { owner: source.owner, repo: source.repo },
        query: { providerAppId: source.appId, composeFile: path },
      })
      const newHints = result.detected[0]?.config ?? null
      if (newHints) {
        setDetection(result.defaultBuilder ?? result.detected[0]?.builderId ?? null, newHints)
        form.setFieldValue('runner.config.subServices', subServicesFromHints(newHints.composeServices))
      }
    } catch {
      // best-effort: keep current sub-services on failure
    } finally {
      setRedetecting(false)
    }
  }

  const candidates = (hints?.composeCandidates ?? []).map((c) => ({
    value: c.path,
    label: c.path,
    badge: c.kind,
  }))

  return (
    <div className="space-y-3">
      {/* Compose file — fluent select over detected candidates; switching re-detects sub-services */}
      <form.Field name="runner.config.composeFile" children={(f) => (
        <Field>
          <FieldLabel>Compose file <span className="text-destructive">*</span></FieldLabel>
          {candidates.length > 1 ? (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SearchableSelect
                  value={f.state.value}
                  onChange={(v) => { void handleComposeChange(v) }}
                  options={candidates}
                  placeholder="docker-compose.yml"
                  searchPlaceholder="Type to search compose files…"
                  emptyMessage="No compose file matches."
                  allowCustom
                />
              </div>
              {redetecting && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
            </div>
          ) : (
            <AutocompleteField
              value={f.state.value}
              onChange={(v) => { f.handleChange(v) }}
              options={['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml', 'docker-compose.prod.yml']}
              placeholder="docker-compose.yml"
              detected={hints?.composeFile}
            />
          )}
          {candidates.length > 1 && (
            <FieldDescription>
              {String(candidates.length)} compose files found in the repo — prod preferred. Switching re-detects the sub-services.
            </FieldDescription>
          )}
        </Field>
      )} />
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field name="runner.config.composeProjectName" children={(f) => (
          <Field><FieldLabel>Project name</FieldLabel><Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="my-project" /></Field>
        )} />
        <form.Field name="runner.config.profiles" children={(f) => (
          <Field><FieldLabel>Profiles</FieldLabel><TagsInput value={f.state.value ?? []} onChange={(v) => { f.handleChange(v) }} placeholder="prod, cache" /></Field>
        )} />
      </div>

      {/* ── Self-deploy + preview scope ── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field name="runner.config.autoDeploySubtree" children={(f) => (
          <Field>
            <FieldLabel>Self-deploy scope</FieldLabel>
            <Select value={f.state.value} onValueChange={(v) => { f.handleChange(v as 'whole-stack' | 'changed-only') }}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="whole-stack">Whole stack — push deploys parent + all children</SelectItem>
                <SelectItem value="changed-only">Changed only — push deploys affected services</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>What a push to this repo deploys (GitHub paths-filter style).</FieldDescription>
          </Field>
        )} />
        <form.Field name="runner.config.previewScope" children={(f) => (
          <Field>
            <FieldLabel>Preview scope</FieldLabel>
            <Select value={f.state.value} onValueChange={(v) => { f.handleChange(v as 'whole-stack' | 'changed-only') }}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="whole-stack">Whole stack — PR previews the full product</SelectItem>
                <SelectItem value="changed-only">Changed only — PR previews touched services</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>What a PR preview of this orchestrator includes.</FieldDescription>
          </Field>
        )} />
      </div>

      {/* ── Hierarchy note (collapsed by default) ── */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1 text-[11px] text-muted-foreground">
            <Sparkles className="size-3 text-primary" /> Orchestrator hierarchy
            <ChevronDown className="size-3" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="text-xs text-muted-foreground">
          The orchestrator is a manifest shell — ports, networking, exposure and domains are configured per sub-service below.
          Environment variables set here cascade into every sub-service; a sub-service&apos;s own value overrides them.
        </CollapsibleContent>
      </Collapsible>

      {/* ── Main (cascaded) environment ── */}
      <form.Field name="runner.config.environment" children={(f) => (
        <Field>
          <FieldLabel>Environment (cascades)</FieldLabel>
          <KeyValueEditor
            value={f.state.value ?? {}}
            onChange={(v) => { f.handleChange(v) }}
            keyPlaceholder="KEY"
            valuePlaceholder="value"
          />
        </Field>
      )} />

      <SubServiceEditor form={form} />
    </div>
  )
}

/**
 * Compose STACK — ONE service managing a docker-compose stack as a single
 * unit. `docker compose up/down/logs` run against the whole stack. There is
 * no per-service lifecycle control; the declared services are read-only
 * references (you can still update image/env via the compose file, but the
 * service deploys as one unit).
 */
function ComposeStackFields({ form, hints }: {
  form: CreateServiceFormApi
  hints: ReturnType<typeof useRunnerDetection>['hints']
}) {
  const candidates = (hints?.composeCandidates ?? []).map((c) => ({
    value: c.path,
    label: c.path,
    badge: c.kind,
  }))

  return (
    <div className="space-y-3">
      <form.Field name="runner.config.composeFile" children={(f) => (
        <Field>
          <FieldLabel>Compose file <span className="text-destructive">*</span></FieldLabel>
          {candidates.length > 1 ? (
            <SearchableSelect
              value={f.state.value}
              onChange={(v) => { f.handleChange(v) }}
              options={candidates}
              placeholder="docker-compose.yml"
              searchPlaceholder="Type to search compose files…"
              emptyMessage="No compose file matches."
              allowCustom
            />
          ) : (
            <AutocompleteField
              value={f.state.value}
              onChange={(v) => { f.handleChange(v) }}
              options={['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml', 'docker-compose.prod.yml']}
              placeholder="docker-compose.yml"
              detected={hints?.composeFile}
            />
          )}
          <FieldDescription>
            This service deploys the <strong>whole stack</strong> as one unit — up/down/logs run on all
            services together. For per-service control, switch the runner to&nbsp;
            <strong>Sub-services</strong>.
          </FieldDescription>
        </Field>
      )} />
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field name="runner.config.appName" children={(f) => (
          <Field>
            <FieldLabel>Compose project name <span className="text-destructive">*</span></FieldLabel>
            <Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="my-stack" />
            <FieldDescription>The `-p` project name used by docker compose.</FieldDescription>
          </Field>
        )} />
        <form.Field name="runner.config.profiles" children={(f) => (
          <Field><FieldLabel>Profiles</FieldLabel><TagsInput value={f.state.value ?? []} onChange={(v) => { f.handleChange(v) }} placeholder="prod, cache" /></Field>
        )} />
      </div>

      {/* ── Declared services (read-only refs) ── */}
      <form.Field name="runner.config.declaredServices" children={(f) => {
        const declared = (f.state.value as { name: string; image?: string; ports?: string[] }[] | undefined) ?? []
        return (
          <Field>
            <FieldLabel>Services in this stack</FieldLabel>
            <FieldDescription>
              Detected from the compose file. They are managed as a single unit — switch to
              Sub-services to give each one its own lifecycle and dependency graph.
            </FieldDescription>
            {declared.length === 0 ? (
              <p className="text-xs text-muted-foreground">No services detected yet — pick a compose file above.</p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {declared.map((s) => (
                  <div key={s.name} className="flex items-center gap-2 rounded-md border bg-background/40 px-2.5 py-1.5 text-[11px]">
                    <Layers className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="flex-1" />
                    {s.image ? <code className="truncate font-mono text-[10px] text-muted-foreground">{s.image}</code> : null}
                    {s.ports && s.ports.length > 0 ? <Badge variant="outline" className="text-[9px]">{s.ports.join(', ')}</Badge> : null}
                  </div>
                ))}
              </div>
            )}
          </Field>
        )
      }} />

      {/* ── Stack environment ── */}
      <form.Field name="runner.config.environment" children={(f) => (
        <Field>
          <FieldLabel>Stack environment</FieldLabel>
          <FieldDescription>Environment overrides passed to the whole compose stack.</FieldDescription>
          <KeyValueEditor
            value={f.state.value ?? {}}
            onChange={(v) => { f.handleChange(v) }}
            keyPlaceholder="KEY"
            valuePlaceholder="value"
          />
        </Field>
      )} />
    </div>
  )
}

/**
 * MOCK runner — spec-driven replacement of a contract (Prism/WireMock/
 * json-server). The `implements.contractRef` must match the service this mock
 * replaces (DI-style swap validated by the platform).
 */
function MockRunnerFields({ form }: { form: CreateServiceFormApi }) {
  const [engine, setEngine] = useState<'prism' | 'wiremock' | 'json-server'>('prism')

  return (
    <div className="space-y-3">
      <form.Subscribe selector={(s) => (s.values.runner.runnerId === 'mock' ? ((s.values.runner.config as { engine?: 'prism' | 'wiremock' | 'json-server' }).engine ?? 'prism') : 'prism')} children={(engineVal) => {
        const currentEngine = engineVal as 'prism' | 'wiremock' | 'json-server'
        return (
          <div className="space-y-3">
            {/* ── Contract (the interface this mock satisfies) ── */}
            <div className="grid gap-3 sm:grid-cols-2">
              <form.Field name="runner.config.implements.contractRef" children={(f) => (
                <Field>
                  <FieldLabel>Contract ref <span className="text-destructive">*</span></FieldLabel>
                  <Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="api.oas3" className="font-mono" />
                  <FieldDescription>Must match the replaced service&apos;s contract.</FieldDescription>
                </Field>
              )} />
              <form.Field name="runner.config.implements.compatibility" children={(f) => (
                <Field>
                  <FieldLabel>Compatibility</FieldLabel>
                  <Select value={f.state.value} onValueChange={(v) => { f.handleChange(v as 'http' | 'grpc' | 'events') }}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">HTTP</SelectItem>
                      <SelectItem value="grpc">gRPC</SelectItem>
                      <SelectItem value="events">Events</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )} />
            </div>

            {/* ── Engine ── */}
            <form.Field name="runner.config.engine" children={(f) => (
              <Field>
                <FieldLabel>Mock engine</FieldLabel>
                <Select value={f.state.value} onValueChange={(v) => { f.handleChange(v as 'prism' | 'wiremock' | 'json-server'); setEngine(v as 'prism' | 'wiremock' | 'json-server') }}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prism">Prism (OpenAPI spec → auto responses)</SelectItem>
                    <SelectItem value="wiremock">WireMock (stub mappings)</SelectItem>
                    <SelectItem value="json-server">json-server (fixture file)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )} />

            {/* ── Source (per engine) ── */}
            {currentEngine === 'prism' && (
              <form.Field name="runner.config.source" children={(f) => {
                const source = f.state.value as never as { kind?: string; specPath?: string } | undefined
                return (
                  <Field>
                    <FieldLabel>OpenAPI spec path <span className="text-destructive">*</span></FieldLabel>
                    <Input
                      value={source?.specPath ?? ''}
                      onChange={(e) => { f.handleChange({ kind: 'openapi', specPath: e.target.value } as never) }}
                      placeholder="contracts/api.oas3.yml"
                      className="font-mono"
                    />
                  </Field>
                )
              }} />
            )}
            {currentEngine === 'wiremock' && (
              <form.Field name="runner.config.source" children={(f) => {
                const source = f.state.value as never as { kind?: string; mappingsDir?: string } | undefined
                return (
                  <Field>
                    <FieldLabel>Stub mappings dir <span className="text-destructive">*</span></FieldLabel>
                    <Input
                      value={source?.mappingsDir ?? ''}
                      onChange={(e) => { f.handleChange({ kind: 'stub-dir', mappingsDir: e.target.value } as never) }}
                      placeholder="mocks/mappings"
                      className="font-mono"
                    />
                  </Field>
                )
              }} />
            )}
            {currentEngine === 'json-server' && (
              <form.Field name="runner.config.source" children={(f) => {
                const source = f.state.value as never as { kind?: string; dbPath?: string } | undefined
                return (
                  <Field>
                    <FieldLabel>Fixture file path <span className="text-destructive">*</span></FieldLabel>
                    <Input
                      value={source?.dbPath ?? ''}
                      onChange={(e) => { f.handleChange({ kind: 'db-file', dbPath: e.target.value } as never) }}
                      placeholder="mocks/db.json"
                      className="font-mono"
                    />
                  </Field>
                )
              }} />
            )}

            {/* ── Behavior ── */}
            <div className="grid gap-3 sm:grid-cols-2">
              <form.Field name="runner.config.behavior.latencyMs" children={(f) => (
                <Field>
                  <FieldLabel>Latency (ms)</FieldLabel>
                  <NumberField value={f.state.value ?? 0} onChange={(v) => { f.handleChange(v) }} options={['0', '100', '250', '500', '1000']} placeholder="0" />
                </Field>
              )} />
              <form.Field name="runner.config.behavior.failRatePercent" children={(f) => (
                <Field>
                  <FieldLabel>Fail rate (%)</FieldLabel>
                  <NumberField value={f.state.value ?? 0} onChange={(v) => { f.handleChange(v) }} options={['0', '1', '5', '10', '25', '50']} placeholder="0" />
                </Field>
              )} />
            </div>

            {/* ── Preview-only toggle ── */}
            <form.Field name="runner.config.previewOnly" children={(f) => (
              <Field>
                <div className="flex items-center gap-2">
                  <Switch checked={f.state.value} onCheckedChange={(c) => { f.handleChange(c) }} />
                  <span className="text-xs text-muted-foreground">Preview only — never deploy to production</span>
                </div>
              </Field>
            )} />
          </div>
        )
      }} />
    </div>
  )
}

function RunnerSpecificFields({ form, runnerId, hints }: {
  form: CreateServiceFormApi
  runnerId: RunnerFormData['runnerId']
  hints: ReturnType<typeof useRunnerDetection>['hints']
}) {
  switch (runnerId) {
    case 'manual':
      return (
        <form.Field name="runner.config.startCommand" children={(f) => (
          <Field>
            <FieldLabel>Start command <span className="text-destructive">*</span></FieldLabel>
            <AutocompleteField
              value={f.state.value ?? ''}
              onChange={(v) => { f.handleChange(v) }}
              options={['npm start', 'npm run start', 'yarn start', 'pnpm start', 'bun start', 'node server.js', 'node index.js', 'python main.py', 'uvicorn main:app --host 0.0.0.0', 'gunicorn app:app --bind 0.0.0.0:8000', 'go run .', 'cargo run']}
              placeholder="npm start"
              detected={hints?.startCommand}
            />
            <FieldDescription>The process command that starts your container.</FieldDescription>
          </Field>
        )} />
      )
    case 'orchestrator':
      return <OrchestratorFields form={form} hints={hints} />
    case 'compose':
      return <ComposeStackFields form={form} hints={hints} />
    case 'kubernetes':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <form.Field name="runner.config.namespace" children={(f) => (
            <Field>
              <FieldLabel>Namespace <span className="text-destructive">*</span></FieldLabel>
              <AutocompleteField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['default', 'production', 'staging', 'development']} placeholder="default" />
            </Field>
          )} />
          <form.Field name="runner.config.deploymentName" children={(f) => (
            <Field><FieldLabel>Deployment name <span className="text-destructive">*</span></FieldLabel><Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="my-service" /></Field>
          )} />
          <form.Field name="runner.config.replicas" children={(f) => (
            <Field><FieldLabel>Replicas</FieldLabel><NumberField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['1', '2', '3', '5', '10']} placeholder="1" /></Field>
          )} />
          <form.Field name="runner.config.serviceAccountName" children={(f) => (
            <Field><FieldLabel>Service account</FieldLabel><Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="default" /></Field>
          )} />
        </div>
      )
    case 'nomad':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <form.Field name="runner.config.jobName" children={(f) => (
            <Field><FieldLabel>Job name <span className="text-destructive">*</span></FieldLabel><Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="my-service" /></Field>
          )} />
          <form.Field name="runner.config.datacenter" children={(f) => (
            <Field><FieldLabel>Datacenter <span className="text-destructive">*</span></FieldLabel><AutocompleteField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['dc1', 'dc2', 'dc3']} placeholder="dc1" /></Field>
          )} />
          <form.Field name="runner.config.nomadNamespace" children={(f) => (
            <Field><FieldLabel>Nomad namespace</FieldLabel><Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="default" /></Field>
          )} />
        </div>
      )
    case 'worker-runtime':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <form.Field name="runner.config.queueName" children={(f) => (
            <Field><FieldLabel>Queue name <span className="text-destructive">*</span></FieldLabel><AutocompleteField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['default', 'jobs', 'emails', 'events']} placeholder="my-queue" /></Field>
          )} />
          <form.Field name="runner.config.concurrency" children={(f) => (
            <Field><FieldLabel>Concurrency</FieldLabel><NumberField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['1', '2', '5', '10', '50', '100']} placeholder="1" /></Field>
          )} />
          <form.Field name="runner.config.maxRetries" children={(f) => (
            <Field><FieldLabel>Max retries</FieldLabel><NumberField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['0', '1', '3', '5', '10']} placeholder="0" /></Field>
          )} />
        </div>
      )
    case 'static':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <form.Field name="runner.config.outputDir" children={(f) => (
            <Field>
              <FieldLabel>Output directory <span className="text-destructive">*</span></FieldLabel>
              <AutocompleteField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['dist', 'build', 'public', 'out', './dist']} placeholder="dist" detected={hints?.outputDir} />
            </Field>
          )} />
          <form.Field name="runner.config.indexFile" children={(f) => (
            <Field>
              <FieldLabel>Index file <span className="text-destructive">*</span></FieldLabel>
              <AutocompleteField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['index.html', '200.html', 'index.htm']} placeholder="index.html" detected={hints?.indexFile} />
            </Field>
          )} />
          <form.Field name="runner.config.errorPage" children={(f) => (
            <Field><FieldLabel>Error page</FieldLabel><Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="404.html" /></Field>
          )} />
        </div>
      )
    case 'mock':
      return <MockRunnerFields form={form} />
  }
}

/* ─── Main step ────────────────────────────────────────────────────── */

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border bg-background/40 p-4">
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  )
}

/** Compact detection summary — one line + expandable details. */
function DetectionSummary({ hints, builderId }: {
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
            {builderId && <Badge variant="outline" className="text-[10px]">{builderId}</Badge>}
            {summary && <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{summary}</span>}
            {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t px-3 py-2">
          {recommendations.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Found</span>
              {recommendations.map((r) => (
                <Badge key={`${r.kind}-${r.path}`} variant="secondary" className="gap-1.5 text-[10px]">
                  <span className="capitalize">{r.kind}</span>
                  <code className="font-mono text-[9px] text-muted-foreground">{r.path}</code>
                </Badge>
              ))}
            </div>
          )}
          {recommendations.length === 0 && <p className="text-[11px] text-muted-foreground">No additional files to recommend.</p>}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

/** Grid of selectable runner-type cards. */
function RunnerTypePicker({ value, onChange }: { value: RunnerFormData['runnerId']; onChange: (v: RunnerFormData['runnerId']) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {RUNNER_META.map((opt) => {
        const Icon = opt.icon
        const selected = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => { onChange(opt.value) }}
            className={cn(
              'group relative flex flex-col gap-1 rounded-lg border p-2.5 text-left transition-all',
              selected
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-border bg-background/40 hover:border-primary/40 hover:bg-muted/40',
            )}
          >
            {selected && (
              <span className="absolute right-1.5 top-1.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-2.5" />
              </span>
            )}
            <Icon className="size-4 text-muted-foreground group-hover:text-foreground" />
            <span className="text-xs font-medium leading-tight">{opt.label}</span>
            <span className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">{opt.description}</span>
          </button>
        )
      })}
    </div>
  )
}

export function StepRunner({ form }: { form: CreateServiceFormApi }) {
  const { builderId, hints } = useRunnerDetection()

  return (
    <form.Subscribe
      selector={(s) => ({ runnerId: s.values.runner.runnerId })}
      children={({ runnerId }) => (
        <div className="space-y-4">
          <DetectionSummary hints={hints} builderId={builderId} />

          {/* ── Compose mode prompt: one stack vs sub-services ── */}
          {hints?.composeServices && hints.composeServices.length > 1 && runnerId === 'compose' && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-start gap-2">
                <Layers className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    Detected {String(hints.composeServices.length)} services in this compose file
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Currently the whole stack deploys as <strong>one service</strong> (up/down/logs
                    together). Want each service managed individually with its own dependency graph?
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => {
                      form.setFieldValue('runner.runnerId', 'orchestrator')
                      form.setFieldValue('runner.config', {
                        ...RUNNER_DEFAULT_CONFIG.orchestrator,
                        composeFile: hints.composeFile ?? 'docker-compose.yml',
                        subServices: subServicesFromHints(hints.composeServices),
                      })
                    }}>
                      <Layers className="size-3" /> Manage as sub-services
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => {
                      const detected = hints.composeServices
                      if (!detected) return
                      form.setFieldValue('runner.config.declaredServices',
                        detected.map((s) => ({ name: s.name, image: s.image, ports: (s.ports ?? []).map(String) })))
                    }}>
                      <ShipWheel className="size-3" /> Keep as one stack
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Runner type */}
          <Section title="Runner type" description="How the built service is deployed and run.">
            <form.Field name="runner.runnerId" children={(f) => (
              <div className="space-y-2">
                <RunnerTypePicker
                  value={f.state.value}
                  onChange={(v) => {
                    const current = form.state.values.runner
                    // Preserve the existing config when re-selecting the same
                    // runner (avoids wiping detected sub-services etc.).
                    if (current.runnerId === v) return
                    const currentCfg = (current.config as never as Record<string, unknown> | undefined) ?? {}

                    // compose → sub-services: carry detected services into subServices.
                    if (current.runnerId === 'compose' && v === 'orchestrator') {
                      const declared = (currentCfg.declaredServices as never as { name: string; image?: string; ports?: string[] }[] | undefined) ?? []
                      const detected = hints?.composeServices ?? []
                      const next = RUNNER_DEFAULT_CONFIG.orchestrator as Record<string, unknown>
                      f.handleChange(v)
                      form.setFieldValue('runner', {
                        ...current,
                        runnerId: v,
                        config: {
                          ...next,
                          composeFile: currentCfg.composeFile ?? 'docker-compose.yml',
                          profiles: currentCfg.profiles ?? [],
                          environment: currentCfg.environment ?? {},
                          subServices: detected.length > 0
                            ? subServicesFromHints(detected)
                            : declared.map((d) => ({ name: d.name, image: d.image ?? '', ports: (d.ports ?? []).map(Number), portMappings: [], expose: false, tls: { enabled: false, httpRedirect: true }, networks: [], customDomains: [], environment: {}, volumes: [], labels: {}, secrets: [], dependsOn: [], dependsOnCondition: 'service_started', replicas: 1, restart: 'no', build: { args: {} } })),
                        },
                      } as never)
                      return
                    }

                    // sub-services → compose: flatten sub-services into declaredServices.
                    if (current.runnerId === 'orchestrator' && v === 'compose') {
                      const subs = (currentCfg.subServices as never as { name: string; image: string; ports?: number[] }[] | undefined) ?? []
                      const next = RUNNER_DEFAULT_CONFIG.compose as Record<string, unknown>
                      f.handleChange(v)
                      form.setFieldValue('runner', {
                        ...current,
                        runnerId: v,
                        config: {
                          ...next,
                          appName: currentCfg.composeProjectName ?? '',
                          composeFile: currentCfg.composeFile ?? 'docker-compose.yml',
                          profiles: currentCfg.profiles ?? [],
                          environment: currentCfg.environment ?? {},
                          declaredServices: subs.map((s) => ({ name: s.name, image: s.image, ports: (s.ports ?? []).map(String) })),
                        },
                      } as never)
                      return
                    }

                    f.handleChange(v)
                    form.setFieldValue('runner', { ...current, runnerId: v, config: RUNNER_DEFAULT_CONFIG[v] } as never)
                  }}
                />
              </div>
            )} />
          </Section>

          {/* Per-runner configuration */}
          <Section title="Runner configuration" description="Settings specific to this runner type.">
            <RunnerSpecificFields form={form} runnerId={runnerId} hints={hints} />
          </Section>
        </div>
      )}
    />
  )
}
