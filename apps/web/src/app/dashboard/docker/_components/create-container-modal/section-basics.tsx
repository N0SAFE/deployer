'use client'

import { CONFIG_PRESETS, type RestartPolicy } from './container-form.model'
import { SELECT_CLASS } from './form-primitives'
import { CheckboxField, SelectField, TextField } from './text-field'
import type { ContainerForm } from './use-container-form'

const RESTART_OPTIONS: readonly { value: RestartPolicy; label: string }[] = [
  { value: 'no', label: 'Never restart' },
  { value: 'always', label: 'Always' },
  { value: 'unless-stopped', label: 'Unless stopped' },
  { value: 'on-failure', label: 'On failure' },
]
const NETWORK_MODES = [
  { value: 'bridge', label: 'bridge (default, isolated)' },
  { value: 'host', label: 'host (shares the node network)' },
  { value: 'none', label: 'none (no networking)' },
]

/** Name, image, command, restart policy and the start/pull switches. */
export function SectionBasics({ form }: { form: ContainerForm }) {
  const { state, setField } = form
  return (
    <div className="space-y-4">
      <div className="rounded-md border p-3">
        <label htmlFor="ccm-preset" className="mb-1.5 block text-sm font-medium">Starting point</label>
        <select id="ccm-preset" className={SELECT_CLASS} value={state.selectedConfigSetId} onChange={(event) => { form.applyPreset(event.target.value) }}>
          <option value="">Blank configuration</option>
          {CONFIG_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} — {preset.description}</option>)}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">Choosing one replaces the ports, variables, restart policy and network mode below.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <TextField form={form} name="name" label="Container name" required value={state.name} onChange={(value) => { setField('name', value) }} placeholder="my-service-web" mono />
        <TextField form={form} name="image" label="Image" required value={state.image} onChange={(value) => { setField('image', value) }} placeholder="ghcr.io/org/app:latest" mono />
        <TextField form={form} name="command" label="Command" className="md:col-span-2" value={state.command} onChange={(value) => { setField('command', value) }} placeholder="bun run start" hint="Leave empty to use the image's default command." mono />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SelectField form={form} name="restartPolicy" label="Restart policy" value={state.restartPolicy} options={RESTART_OPTIONS} onChange={(value) => { setField('restartPolicy', value) }} />
        <SelectField form={form} name="networkMode" label="Network mode" value={state.networkMode} options={NETWORK_MODES} onChange={(value) => { setField('networkMode', value) }} />
        {state.restartPolicy === 'on-failure' ? (
          <TextField form={form} name="restartMaxRetries" label="Max restart retries" value={state.restartMaxRetries} onChange={(value) => { setField('restartMaxRetries', value) }} placeholder="3" hint="Empty means keep retrying." />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <CheckboxField id="ccm-start" label="Start after create" checked={state.startAfterCreate} onChange={(value) => { setField('startAfterCreate', value) }} />
        <CheckboxField id="ccm-repull" label="Pull image before deploy" checked={state.repullImage} onChange={(value) => { setField('repullImage', value) }} />
        <CheckboxField id="ccm-ro" label="Read-only root filesystem" checked={state.readOnlyRootFs} onChange={(value) => { setField('readOnlyRootFs', value) }} hint="The container cannot write outside its mounted volumes." />
      </div>
    </div>
  )
}
