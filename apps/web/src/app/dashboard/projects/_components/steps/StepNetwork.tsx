'use client'

import { useState } from 'react'
import { Input } from '@repo/ui/components/shadcn/input'
import { Button } from '@repo/ui/components/shadcn/button'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Checkbox } from '@repo/ui/components/shadcn/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Field, FieldLabel, FieldDescription } from '@repo/ui/components/shadcn/field'
import { Check, Plus, X, Lock, Globe } from 'lucide-react'
import { cn } from '@repo/ui/lib/utils'
import type { CreateServiceFormApi } from '../CreateService.hook'
import { AutocompleteField } from './autocomplete-field'

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
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {all.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
      </SelectContent>
    </Select>
  )
}

interface PortMapping {
  containerPort: number
  hostPort?: number
  protocol: 'tcp' | 'udp'
  name?: string
}

/** Editor for extra port forwards (container → host). */
function PortMappingEditor({ value, onChange }: { value: PortMapping[]; onChange: (v: PortMapping[]) => void }) {
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
    <div className="space-y-2">
      {value.map((m, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
          <span className="font-mono text-muted-foreground">{m.protocol}</span>
          <code className="font-mono">{m.hostPort ?? 'auto'}</code>
          <span className="text-muted-foreground">→</span>
          <code className="font-mono">{m.containerPort}</code>
          <span className="flex-1" />
          <Button type="button" variant="ghost" size="icon" className="size-6" onClick={() => { onChange(value.filter((_, idx) => idx !== i)) }}>
            <X className="size-3" />
          </Button>
        </div>
      ))}
      {adding ? (
        <div className="flex items-center gap-2">
          <Select value={protocol} onValueChange={(v) => { setProtocol(v as 'tcp' | 'udp') }}>
            <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tcp">tcp</SelectItem>
              <SelectItem value="udp">udp</SelectItem>
            </SelectContent>
          </Select>
          <Input value={hostPort} onChange={(e) => { setHostPort(e.target.value) }} placeholder="host (auto)" className="h-7 w-24 font-mono text-xs" />
          <span className="text-xs text-muted-foreground">→</span>
          <Input value={containerPort} onChange={(e) => { setContainerPort(e.target.value) }} placeholder="container" className="h-7 w-24 font-mono text-xs" />
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={commit}>Add</Button>
          <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => { setAdding(false) }}>Cancel</Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" className="h-7 w-fit gap-1.5 text-xs" onClick={() => { setAdding(true) }}>
          <Plus className="size-3.5" /> Add port forward
        </Button>
      )}
    </div>
  )
}

/** Type picker for the health check. */
function HealthTypePicker({ value, onChange }: { value: string; onChange: (v: 'http' | 'tcp' | 'command' | 'none') => void }) {
  const options = [
    { value: 'http', label: 'HTTP', description: 'Request a URL, expect a status.' },
    { value: 'tcp', label: 'TCP', description: 'Open a TCP connection to a port.' },
    { value: 'command', label: 'Command', description: 'Run a shell command in-container.' },
    { value: 'none', label: 'None', description: 'No health checking.' },
  ] as const
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      {options.map((o) => {
        const selected = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => { onChange(o.value) }}
            className={cn(
              'relative flex flex-col gap-1 rounded-lg border p-2.5 text-left transition-all',
              selected ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border bg-background/40 hover:border-primary/40',
            )}
          >
            {selected && <Check className="absolute right-1.5 top-1.5 size-3 text-primary" />}
            <span className="text-xs font-medium">{o.label}</span>
            <span className="text-[10px] leading-snug text-muted-foreground">{o.description}</span>
          </button>
        )
      })}
    </div>
  )
}

const HTTP_METHODS = ['GET', 'HEAD', 'POST'] as const
const STATUS_PRESETS = ['200', '201', '204', '301', '302', '401', '403', '404', '500'] as const

/**
 * Step 6 — Network & Health. Modern, advanced: container port, port
 * forwards, internet exposure + TLS, and a full health-check editor.
 */
export function StepNetwork({ form }: { form: CreateServiceFormApi }) {
  return (
    <form.Subscribe
      selector={(s) => ({
        runnerId: s.values.runner.runnerId,
        subServiceCount: s.values.runner.runnerId === 'orchestrator'
          ? ((s.values.runner.config as { subServices?: unknown[] }).subServices ?? []).length
          : 0,
      })}
      children={({ runnerId, subServiceCount }) => {
        const orchestratorWithSubs = runnerId === 'orchestrator' && subServiceCount > 0

        // When the orchestrator owns sub-services, networking/ports/domains
        // are configured PER SUB-SERVICE (in the Runner step), not on the shell.
        if (orchestratorWithSubs) {
          return (
            <div className="space-y-4">
              <Alert>
                <Globe className="size-4" />
                <AlertTitle className="text-xs">Networking is configured per sub-service</AlertTitle>
                <AlertDescription className="text-xs">
                  This orchestrator owns <strong>{String(subServiceCount)} sub-service(s)</strong>.
                  Ports, exposure, TLS and health checks are configured inside each sub-service in
                  the Runner step — the orchestrator shell itself does not expose a port.
                </AlertDescription>
              </Alert>
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Go back to <strong>Runner</strong> to configure each sub-service&apos;s networking,
                exposure, TLS and domains.
              </div>
            </div>
          )
        }

        return (
          <form.Subscribe selector={(s) => ({ hcType: s.values.network.healthCheck.type, expose: s.values.network.expose })} children={({ hcType, expose }) => (
      <div className="space-y-4">
        {/* ── Networking ── */}
        <Section title="Networking" description="The port(s) your service listens on and how they are exposed.">
          <div className="grid gap-3 sm:grid-cols-2">
            <form.Field name="network.port" children={(f) => (
              <Field>
                <FieldLabel>Container port</FieldLabel>
                <Input type="number" value={f.state.value} onChange={(e) => { f.handleChange(e.target.value ? Number(e.target.value) : undefined) }} placeholder="3000" />
                <FieldDescription>The primary port your service listens on inside the container.</FieldDescription>
              </Field>
            )} />
            <form.Field name="network.expose" children={(f) => (
              <Field>
                <FieldLabel className="flex items-center gap-2"><Globe className="size-3.5" /> Expose to internet</FieldLabel>
                <div className="flex items-center gap-2">
                  <Switch checked={f.state.value} onCheckedChange={(c) => { f.handleChange(c) }} />
                  <span className="text-xs text-muted-foreground">Route traffic through the ingress (Traefik).</span>
                </div>
              </Field>
            )} />
          </div>

          <form.Field name="network.portMappings" children={(f) => (
            <Field>
              <FieldLabel>Port forwards</FieldLabel>
              <FieldDescription>Extra container → host port bindings.</FieldDescription>
              <PortMappingEditor value={(f.state.value as never as PortMapping[] | undefined) ?? []} onChange={(v) => { f.handleChange(v) }} />
            </Field>
          )} />

          {expose && (
            <form.Field name="network.tls" children={(f) => {
              const tlsVal = f.state.value as never as { enabled: boolean; certSecretRef?: string; httpRedirect: boolean }
              const update = (patch: Partial<typeof tlsVal>) => { f.handleChange({ ...tlsVal, ...patch }) }
              return (
                <Field>
                  <FieldLabel className="flex items-center gap-2"><Lock className="size-3.5" /> TLS termination</FieldLabel>
                  <div className="flex items-center gap-2">
                    <Switch checked={tlsVal.enabled} onCheckedChange={(c) => { update({ enabled: c }) }} />
                    <span className="text-xs text-muted-foreground">Terminate HTTPS on the edge.</span>
                  </div>
                  {tlsVal.enabled && (
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <div>
                        <FieldLabel className="text-xs">Certificate secret</FieldLabel>
                        <AutocompleteField value={tlsVal.certSecretRef ?? ''} onChange={(v) => { update({ certSecretRef: v }) }} options={['letsencrypt', 'cloudflare-origin', 'wildcard-prod', 'wildcard-staging']} placeholder="letsencrypt" />
                      </div>
                      <div className="flex items-end gap-2 pb-1">
                        <Checkbox checked={tlsVal.httpRedirect} onCheckedChange={(c) => { update({ httpRedirect: c === true }) }} />
                        <span className="text-xs text-muted-foreground">Redirect HTTP → HTTPS</span>
                      </div>
                    </div>
                  )}
                </Field>
              )
            }} />
          )}
        </Section>

        {/* ── Health check ── */}
        <Section title="Health check" description="How the platform verifies the service is healthy.">
          <form.Field name="network.healthCheck.type" children={(f) => (
            <HealthTypePicker
              value={f.state.value}
              onChange={(v) => {
                const base = { interval: 30, timeout: 10, retries: 3, startPeriod: 0, successThreshold: 1, failureThreshold: 3 }
                if (v === 'http') {
                  f.handleChange({ type: 'http', path: '/health', method: 'GET', expectedStatus: 200, headers: {}, ...base } as never)
                } else if (v === 'tcp') {
                  f.handleChange({ type: 'tcp', port: (form.state.values.network.port ?? 3000), ...base } as never)
                } else if (v === 'command') {
                  f.handleChange({ type: 'command', command: 'curl -f http://localhost:3000/health', ...base } as never)
                } else {
                  f.handleChange({ type: 'none' } as never)
                }
              }}
            />
          )} />

          {hcType === 'http' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <form.Field name="network.healthCheck.path" children={(f) => (<Field><FieldLabel>Path</FieldLabel><Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="/health" /></Field>)} />
              <form.Field name="network.healthCheck.method" children={(f) => (
                <Field>
                  <FieldLabel>Method</FieldLabel>
                  <Select value={f.state.value} onValueChange={(v) => { f.handleChange(v as never) }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{HTTP_METHODS.map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}</SelectContent>
                  </Select>
                </Field>
              )} />
              <form.Field name="network.healthCheck.expectedStatus" children={(f) => (
                <Field>
                  <FieldLabel>Expected status</FieldLabel>
                  <AutocompleteField value={String(f.state.value)} onChange={(v) => { f.handleChange(Number(v)) }} options={STATUS_PRESETS} placeholder="200" />
                </Field>
              )} />
            </div>
          )}
          {hcType === 'tcp' && (
            <form.Field name="network.healthCheck.port" children={(f) => (
              <Field><FieldLabel>TCP port</FieldLabel><Input type="number" value={f.state.value} onChange={(e) => { f.handleChange(Number(e.target.value)) }} placeholder="3000" /></Field>
            )} />
          )}
          {hcType === 'command' && (
            <form.Field name="network.healthCheck.command" children={(f) => (
              <Field><FieldLabel>Command</FieldLabel><AutocompleteField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['curl -f http://localhost:3000/health', 'wget -q --spider http://localhost:3000/health', 'test -f /tmp/healthy']} placeholder="curl -f http://localhost:3000/health" /></Field>
            )} />
          )}

          {hcType !== 'none' && (
            <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-3">
              <form.Field name="network.healthCheck.interval" children={(f) => (
                <Field><FieldLabel>Interval (s)</FieldLabel><NumberField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['10', '15', '30', '60', '120']} placeholder="30" /></Field>
              )} />
              <form.Field name="network.healthCheck.timeout" children={(f) => (
                <Field><FieldLabel>Timeout (s)</FieldLabel><NumberField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['3', '5', '10', '30', '60']} placeholder="10" /></Field>
              )} />
              <form.Field name="network.healthCheck.retries" children={(f) => (
                <Field><FieldLabel>Retries</FieldLabel><NumberField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['0', '1', '3', '5', '10']} placeholder="3" /></Field>
              )} />
              <form.Field name="network.healthCheck.startPeriod" children={(f) => (
                <Field><FieldLabel>Start period (s)</FieldLabel><NumberField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['0', '5', '10', '30', '60']} placeholder="0" /></Field>
              )} />
              <form.Field name="network.healthCheck.successThreshold" children={(f) => (
                <Field><FieldLabel>Success threshold</FieldLabel><NumberField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['1', '2', '3', '5']} placeholder="1" /></Field>
              )} />
              <form.Field name="network.healthCheck.failureThreshold" children={(f) => (
                <Field><FieldLabel>Failure threshold</FieldLabel><NumberField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['1', '2', '3', '5']} placeholder="3" /></Field>
              )} />
            </div>
          )}
        </Section>
      </div>
    )} />
        )
      }}
    />
  )
}
