'use client'

import { HardDrive, Settings2, Wifi } from 'lucide-react'
import { AddRowButton, CollapsibleSection, FormSection, RemoveRowButton, RowHeader, SELECT_CLASS, TagInput, ToggleChips } from './form-primitives'
import { CheckboxField, RowInput, SelectField, TextField } from './text-field'
import type { GpuMode, VulnerabilityCriteria } from './container-form.model'
import type { ContainerForm } from './use-container-form'

const COMMON_ULIMITS = ['nofile', 'nproc', 'core', 'stack', 'memlock'] as const
const GPU_CAPABILITIES = ['gpu', 'compute', 'utility', 'graphics', 'video', 'display'] as const
const GPU_MODES: readonly { value: GpuMode; label: string }[] = [
  { value: 'all', label: 'All GPUs' },
  { value: 'count', label: 'A number of GPUs' },
  { value: 'specific', label: 'Specific device IDs' },
]
const CRITERIA: readonly { value: VulnerabilityCriteria; label: string }[] = [
  { value: 'never', label: 'Never block' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'any', label: 'Any finding' },
]

export function SectionDns({ form }: { form: ContainerForm }) {
  const { state, setField } = form
  return (
    <CollapsibleSection title="DNS" icon={<Wifi className="size-4" aria-hidden="true" />} summary={state.dnsServers.length > 0 ? `${String(state.dnsServers.length)} servers` : undefined}>
      <TagInput label="DNS servers" placeholder="8.8.8.8" values={state.dnsServers} onChange={(value) => { setField('dnsServers', value) }} />
      <TagInput label="Search domains" placeholder="example.com" values={state.dnsSearch} onChange={(value) => { setField('dnsSearch', value) }} />
      <TagInput label="DNS options" placeholder="ndots:5" values={state.dnsOptions} onChange={(value) => { setField('dnsOptions', value) }} />
    </CollapsibleSection>
  )
}

export function SectionDevices({ form }: { form: ContainerForm }) {
  const { state } = form
  return (
    <CollapsibleSection title="Devices" icon={<HardDrive className="size-4" aria-hidden="true" />} summary={state.devices.length > 0 ? String(state.devices.length) : undefined}>
      {state.devices.length === 0 ? <p className="text-xs text-muted-foreground">No host devices are passed through.</p> : <RowHeader columns={['Host device', 'Container path', 'Permissions']} template="md:grid-cols-[1fr_1fr_120px_auto]" />}
      {state.devices.map((device, index) => (
        <div key={`device-${String(index)}`} className="grid gap-2 md:grid-cols-[1fr_1fr_120px_auto]">
          <RowInput form={form} name={`devices.${String(index)}.hostPath`} label={`Device ${String(index + 1)} host path`} value={device.hostPath} placeholder="/dev/sda" onChange={(value) => { form.updateRow('devices', index, { hostPath: value }) }} />
          <RowInput form={form} name={`devices.${String(index)}.containerPath`} label={`Device ${String(index + 1)} container path`} value={device.containerPath} placeholder="/dev/sda" onChange={(value) => { form.updateRow('devices', index, { containerPath: value }) }} />
          <RowInput form={form} name={`devices.${String(index)}.permissions`} label={`Device ${String(index + 1)} permissions`} value={device.permissions} placeholder="rwm" onChange={(value) => { form.updateRow('devices', index, { permissions: value }) }} />
          <RemoveRowButton label={`Remove device ${String(index + 1)}`} onClick={() => { form.removeRow('devices', index) }} />
        </div>
      ))}
      <AddRowButton label="Add device" onClick={() => { form.addRow('devices') }} />
    </CollapsibleSection>
  )
}

export function SectionGpu({ form }: { form: ContainerForm }) {
  const { state, setField } = form
  return (
    <CollapsibleSection title="GPU" icon={<Settings2 className="size-4" aria-hidden="true" />} summary={state.gpuEnabled ? 'enabled' : 'off'}>
      <CheckboxField id="ccm-gpu" label="Enable GPU access" checked={state.gpuEnabled} onChange={(value) => { setField('gpuEnabled', value) }} />
      {state.gpuEnabled ? (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <SelectField form={form} name="gpuMode" label="Which GPUs" value={state.gpuMode} options={GPU_MODES} onChange={(value) => { setField('gpuMode', value) }} />
            {state.gpuMode === 'count' ? <TextField form={form} name="gpuCount" label="GPU count" value={state.gpuCount} onChange={(value) => { setField('gpuCount', value) }} /> : null}
            <TextField form={form} name="gpuDriver" label="Driver" value={state.gpuDriver} onChange={(value) => { setField('gpuDriver', value) }} placeholder="nvidia" />
          </div>
          <TextField form={form} name="runtime" label="Runtime" value={state.runtime} onChange={(value) => { setField('runtime', value) }} placeholder="nvidia" />
          <ToggleChips label="GPU capabilities" options={GPU_CAPABILITIES} selected={state.gpuCapabilities} onToggle={(cap) => { setField('gpuCapabilities', state.gpuCapabilities.includes(cap) ? state.gpuCapabilities.filter((item) => item !== cap) : [...state.gpuCapabilities, cap]) }} />
          {state.gpuMode === 'specific' ? <TagInput label="Device IDs" placeholder="0" values={state.gpuDeviceIds} onChange={(value) => { setField('gpuDeviceIds', value) }} /> : null}
        </>
      ) : null}
    </CollapsibleSection>
  )
}

export function SectionUlimits({ form }: { form: ContainerForm }) {
  const { state } = form
  return (
    <CollapsibleSection title="Ulimits" icon={<Settings2 className="size-4" aria-hidden="true" />} summary={state.ulimits.length > 0 ? String(state.ulimits.length) : undefined}>
      {state.ulimits.length === 0 ? <p className="text-xs text-muted-foreground">Default resource limits apply.</p> : null}
      {state.ulimits.map((item, index) => (
        <div key={`ulimit-${String(index)}`} className="grid gap-2 md:grid-cols-[160px_1fr_1fr_auto]">
          <select aria-label={`Ulimit ${String(index + 1)} name`} className={SELECT_CLASS} value={item.name} onChange={(event) => { form.updateRow('ulimits', index, { name: event.target.value }) }}>
            {COMMON_ULIMITS.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <RowInput form={form} name={`ulimits.${String(index)}.soft`} label={`Ulimit ${String(index + 1)} soft limit`} value={item.soft} placeholder="soft" onChange={(value) => { form.updateRow('ulimits', index, { soft: value }) }} />
          <RowInput form={form} name={`ulimits.${String(index)}.hard`} label={`Ulimit ${String(index + 1)} hard limit`} value={item.hard} placeholder="hard" onChange={(value) => { form.updateRow('ulimits', index, { hard: value }) }} />
          <RemoveRowButton label={`Remove ulimit ${String(index + 1)}`} onClick={() => { form.removeRow('ulimits', index) }} />
        </div>
      ))}
      <AddRowButton label="Add ulimit" onClick={() => { form.addRow('ulimits') }} />
    </CollapsibleSection>
  )
}

export function SectionAutoUpdate({ form }: { form: ContainerForm }) {
  const { state, setField } = form
  return (
    <FormSection title="Auto-update" description="Re-pull the image on a schedule and recreate the container when it changed.">
      <CheckboxField id="ccm-autoupdate" label="Enable auto-update" checked={state.autoUpdateEnabled} onChange={(value) => { setField('autoUpdateEnabled', value) }} />
      <div className="grid gap-3 md:grid-cols-2">
        <TextField form={form} name="autoUpdateCron" label="Schedule (cron)" value={state.autoUpdateCron} onChange={(value) => { setField('autoUpdateCron', value) }} placeholder="0 3 * * *" hint="Five fields; 0 3 * * * is every day at 03:00." mono />
        <SelectField form={form} name="vulnerabilityCriteria" label="Skip update if the scan finds" value={state.vulnerabilityCriteria} options={CRITERIA} onChange={(value) => { setField('vulnerabilityCriteria', value) }} />
      </div>
    </FormSection>
  )
}
