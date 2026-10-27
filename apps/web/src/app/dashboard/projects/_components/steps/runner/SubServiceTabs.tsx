'use client'

import { Input } from '@deployer/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Switch } from '@deployer/ui/components/shadcn/switch'
import { Checkbox } from '@deployer/ui/components/shadcn/checkbox'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Field, FieldLabel, FieldDescription } from '@deployer/ui/components/shadcn/field'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@deployer/ui/components/shadcn/tabs'
import { AutocompleteField } from '../autocomplete-field'
import type { OrchestratorSubService } from '../runner-types'
import { HEALTHCHECK_PRESETS, IMAGE_PRESETS } from './sub-service-defaults'
import { KeyValueEditor, NumberField, TagsInput } from './primitives'

/** Expanded sub-service editor — tabbed, one concern at a time. */
export function SubServiceTabs({ svc, mainEnv, onPatch, onPatchNested }: {
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
            <Field><FieldLabel className="text-xs">Name</FieldLabel><Input value={svc.name} onChange={(e) => { onPatch({ name: e.target.value }) }} placeholder="service-name" className="text-xs" /></Field>
            <Field>
              <FieldLabel className="text-xs">Image</FieldLabel>
              <AutocompleteField
                value={svc.image}
                onChange={(v) => { onPatch({ image: v }) }}
                options={IMAGE_PRESETS}
                placeholder="nginx:alpine"
              />
            </Field>
            <Field><FieldLabel className="text-xs">Command</FieldLabel><Input value={svc.command ?? ''} onChange={(e) => { onPatch({ command: e.target.value }) }} placeholder="npm start" className="font-mono text-xs" /></Field>
            <Field><FieldLabel className="text-xs">Entrypoint</FieldLabel><Input value={svc.entrypoint ?? ''} onChange={(e) => { onPatch({ entrypoint: e.target.value }) }} placeholder="/entrypoint.sh" className="font-mono text-xs" /></Field>
          </div>
          <div className="rounded-md border bg-background/40 p-2.5">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Build (optional)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field><FieldLabel className="text-xs">Context</FieldLabel><Input value={svc.build?.context ?? ''} onChange={(e) => { onPatchNested('build', { context: e.target.value }) }} placeholder="." className="font-mono text-xs" /></Field>
              <Field><FieldLabel className="text-xs">Dockerfile</FieldLabel><Input value={svc.build?.dockerfile ?? ''} onChange={(e) => { onPatchNested('build', { dockerfile: e.target.value }) }} placeholder="Dockerfile" className="font-mono text-xs" /></Field>
            </div>
            <Field className="mt-2">
              <FieldLabel className="text-xs">Build args</FieldLabel>
              <KeyValueEditor value={svc.build?.args ?? {}} onChange={(args) => { onPatchNested('build', { args }) }} keyPlaceholder="ARG" valuePlaceholder="value" />
            </Field>
          </div>
        </TabsContent>

        {/* ── Network ── */}
        <TabsContent value="network" className="mt-2 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field>
              <FieldLabel className="text-xs">Primary port</FieldLabel>
              <Input type="number" value={svc.port ?? ''} onChange={(e) => { onPatch({ port: e.target.value ? Number(e.target.value) : undefined }) }} placeholder="3000" className="text-xs" />
            </Field>
            <Field>
              <FieldLabel className="text-xs">Visibility</FieldLabel>
              <Select value={svc.visibility} onValueChange={(v) => { onPatch({ visibility: v as OrchestratorSubService['visibility'] }) }}>
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public — also on the public lane (internet) when one is enabled</SelectItem>
                  <SelectItem value="private">Private — this machine and mesh members only</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field><FieldLabel className="text-xs">Other container ports</FieldLabel><TagsInput value={svc.ports.map(String)} onChange={(v) => { onPatch({ ports: v.map(Number) }) }} placeholder="80, 443" /><FieldDescription>Extra ports the container listens on, separated by commas.</FieldDescription></Field>
            <Field><FieldLabel className="text-xs">Networks</FieldLabel><TagsInput value={svc.networks} onChange={(v) => { onPatch({ networks: v }) }} placeholder="frontend, backend" /></Field>
          </div>
          {svc.visibility === 'public' && (
            <div className="space-y-2 rounded-md border bg-background/40 p-2.5">
              <div className="flex items-center gap-2">
                <Switch checked={svc.tls.enabled} onCheckedChange={(c) => { onPatchNested('tls', { enabled: c }) }} />
                <span className="text-xs text-muted-foreground">TLS termination</span>
              </div>
              {svc.tls.enabled && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field>
                    <FieldLabel className="text-xs">Certificate secret</FieldLabel>
                    <AutocompleteField value={svc.tls.certSecretRef ?? ''} onChange={(v) => { onPatchNested('tls', { certSecretRef: v }) }} options={['letsencrypt', 'cloudflare-origin', 'wildcard-prod', 'wildcard-staging']} placeholder="letsencrypt" />
                  </Field>
                  <div className="flex items-end gap-2 pb-1">
                    <Checkbox checked={svc.tls.httpRedirect} onCheckedChange={(c) => { onPatchNested('tls', { httpRedirect: c === true }) }} />
                    <span className="text-xs text-muted-foreground">Redirect HTTP → HTTPS</span>
                  </div>
                </div>
              )}
            </div>
          )}
          <Field>
            <FieldLabel className="text-xs">Custom domains</FieldLabel>
            <TagsInput value={svc.customDomains} onChange={(v) => { onPatch({ customDomains: v }) }} placeholder="app.example.com, api.example.com" />
          </Field>
        </TabsContent>

        {/* ── Config & storage ── */}
        <TabsContent value="config" className="mt-2 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field>
              <FieldLabel className="flex items-center gap-1 text-xs">
                Environment (overrides shared values)
                {Object.keys(mainEnv).length > 0 && <Badge variant="outline" className="text-xs">{String(Object.keys(mainEnv).length)} cascade</Badge>}
              </FieldLabel>
              <KeyValueEditor value={svc.environment} onChange={(environment) => { onPatch({ environment }) }} keyPlaceholder="KEY" valuePlaceholder="value" />
            </Field>
            <Field>
              <FieldLabel className="text-xs">Volumes</FieldLabel>
              <TagsInput value={svc.volumes} onChange={(v) => { onPatch({ volumes: v }) }} placeholder="/data:/app/data" />
            </Field>
            <Field>
              <FieldLabel className="text-xs">Labels</FieldLabel>
              <KeyValueEditor value={svc.labels} onChange={(labels) => { onPatch({ labels }) }} keyPlaceholder="key" valuePlaceholder="value" />
            </Field>
            <Field><FieldLabel className="text-xs">Secrets</FieldLabel><TagsInput value={svc.secrets} onChange={(v) => { onPatch({ secrets: v }) }} placeholder="db-password" /></Field>
          </div>
        </TabsContent>

        {/* ── Scaling ── */}
        <TabsContent value="scale" className="mt-2 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field><FieldLabel className="text-xs">Depends on</FieldLabel><TagsInput value={svc.dependsOn} onChange={(v) => { onPatch({ dependsOn: v }) }} placeholder="db, cache" /><FieldDescription>Names of sub-services that must be up first, separated by commas.</FieldDescription></Field>
            <Field>
              <FieldLabel className="text-xs">Wait until it is</FieldLabel>
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
              <FieldLabel className="text-xs">Replicas (copies)</FieldLabel>
              <NumberField value={svc.replicas} onChange={(v) => { onPatch({ replicas: v }) }} options={['1', '2', '3', '5', '10']} placeholder="1" />
            </Field>
            <Field>
              <FieldLabel className="text-xs">Restart policy</FieldLabel>
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
              <FieldLabel className="text-xs">Health check command</FieldLabel>
              <AutocompleteField
                value={(svc.healthCheck?.test ?? []).join(' ')}
                onChange={(v) => {
                  const parts = v.trim() ? v.trim().split(/\s+/) : ['CMD-SHELL', 'exit 0']
                  onPatchNested('healthCheck', { test: parts })
                }}
                options={HEALTHCHECK_PRESETS}
                placeholder="CMD-SHELL curl -f http://localhost:3000/health"
              />
              <FieldDescription>A command run inside the container on a schedule. Exit code 0 means the service is healthy.</FieldDescription>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field>
                <FieldLabel className="text-xs">Check every (s)</FieldLabel>
                <NumberField value={svc.healthCheck?.interval ?? 30} onChange={(v) => { onPatchNested('healthCheck', { interval: v }) }} options={['10', '15', '30', '60', '120']} placeholder="30" />
              </Field>
              <Field>
                <FieldLabel className="text-xs">Timeout (s)</FieldLabel>
                <NumberField value={svc.healthCheck?.timeout ?? 10} onChange={(v) => { onPatchNested('healthCheck', { timeout: v }) }} options={['3', '5', '10', '30']} placeholder="10" />
              </Field>
              <Field>
                <FieldLabel className="text-xs">Retries before unhealthy</FieldLabel>
                <NumberField value={svc.healthCheck?.retries ?? 3} onChange={(v) => { onPatchNested('healthCheck', { retries: v }) }} options={['0', '1', '3', '5', '10']} placeholder="3" />
              </Field>
              <Field>
                <FieldLabel className="text-xs">CPU limit</FieldLabel>
                <Input type="number" step="0.1" value={svc.resources?.cpus ?? ''} onChange={(e) => { onPatchNested('resources', { cpus: e.target.value ? Number(e.target.value) : undefined }) }} placeholder="1.0" className="text-xs" />
              </Field>
              <Field>
                <FieldLabel className="text-xs">Memory limit</FieldLabel>
                <Input value={svc.resources?.memory ?? ''} onChange={(e) => { onPatchNested('resources', { memory: e.target.value }) }} placeholder="512m" className="font-mono text-xs" />
              </Field>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
