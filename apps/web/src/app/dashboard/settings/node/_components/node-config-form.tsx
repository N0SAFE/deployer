'use client'

import { Button } from '@deployer/ui/components/shadcn/button'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Textarea } from '@deployer/ui/components/shadcn/textarea'
import type { useNodeConfigForm } from './use-node-config-form'

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors'

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** The editor for the persisted node configuration. Saving writes the config file; nothing restarts by itself. */
export function NodeConfigForm({ form }: { form: ReturnType<typeof useNodeConfigForm> }) {
  const f = form.fields
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Field id="node-config-id" label="Node ID" hint="This node's identity in the mesh. Changing it makes peers see a new node.">
          <Input id="node-config-id" value={f.nodeId[0]} onChange={(e) => { f.nodeId[1](e.target.value) }} placeholder="UUID" className="font-mono text-xs" />
        </Field>
        <Field id="node-config-strategy" label="Strategy" hint="local: this node owns its data. remote: it joins an existing mesh through the URLs below.">
          <select id="node-config-strategy" className={SELECT_CLASS} value={f.strategy[0]} onChange={(e) => { f.strategy[1](e.target.value === 'remote' ? 'remote' : 'local') }}>
            <option value="local">local</option>
            <option value="remote">remote</option>
          </select>
        </Field>
        <Field id="node-config-region" label="Region">
          <Input id="node-config-region" value={f.region[0]} onChange={(e) => { f.region[1](e.target.value) }} placeholder="e.g. eu-west-1" className="text-xs" />
        </Field>
        <Field id="node-config-zone" label="Zone">
          <Input id="node-config-zone" value={f.zone[0]} onChange={(e) => { f.zone[1](e.target.value) }} placeholder="e.g. eu-west-1a" className="text-xs" />
        </Field>
        <Field id="node-config-version" label="Version">
          <Input id="node-config-version" value={f.version[0]} onChange={(e) => { f.version[1](e.target.value) }} placeholder="e.g. 1.0.0" className="text-xs" />
        </Field>
        <Field id="node-config-roles" label="Roles (comma-separated)" hint="What this node does for the mesh, e.g. edge, relay.">
          <Input id="node-config-roles" value={f.roles[0]} onChange={(e) => { f.roles[1](e.target.value) }} placeholder="edge, relay" className="text-xs" />
        </Field>
        <Field id="node-config-routing" label="Routing mode" hint="What the mesh optimises when it picks a path through this node.">
          <select id="node-config-routing" className={SELECT_CLASS} value={f.routingMode[0]} onChange={(e) => { f.routingMode[1](e.target.value) }}>
            <option value="">Default</option>
            <option value="latency">latency</option>
            <option value="balanced">balanced</option>
            <option value="throughput">throughput</option>
            <option value="resilience">resilience</option>
          </select>
        </Field>
        <Field id="node-config-consistency" label="Consistency mode" hint="Behaviour during a network split: keep serving (AP) or stop to stay correct (CP).">
          <select id="node-config-consistency" className={SELECT_CLASS} value={f.consistencyMode[0]} onChange={(e) => { f.consistencyMode[1](e.target.value) }}>
            <option value="">Default</option>
            <option value="ap">AP (eventual)</option>
            <option value="cp">CP (strong)</option>
            <option value="hybrid">hybrid</option>
          </select>
        </Field>
      </div>
      <Field id="node-config-db-url" label="Database URL" hint="Stored in plain text in the node's configuration file. Test it first in the Database section.">
        <Input id="node-config-db-url" value={f.databaseUrl[0]} onChange={(e) => { f.databaseUrl[1](e.target.value) }} placeholder="postgresql://..." className="font-mono text-xs" autoComplete="off" />
      </Field>
      <Field id="node-config-mesh-urls" label="Mesh URLs (one per line)" hint="Where this node looks to rejoin the mesh after a restart.">
        <Textarea id="node-config-mesh-urls" className="min-h-15 font-mono text-xs" value={f.meshUrls[0]} onChange={(e) => { f.meshUrls[1](e.target.value) }} placeholder={'https://mesh-1:3001\nhttps://mesh-2:3001'} rows={3} />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void form.save()} disabled={form.saving}>
          {form.saving ? 'Saving…' : 'Save configuration'}
        </Button>
        <Button size="sm" variant="ghost" onClick={form.cancel}>Cancel</Button>
      </div>
    </div>
  )
}
