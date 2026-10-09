'use client'

import { MultiSelect } from '@repo/ui/components/shadcn/multi-select'
import { SELECT_CLASS, AddRowButton, FormSection, RemoveRowButton, RowHeader } from './form-primitives'
import { RowInput } from './text-field'
import type { ContainerForm } from './use-container-form'

/** Published ports and volume mounts. */
export function SectionPortsVolumes({ form }: { form: ContainerForm }) {
  const { state } = form
  return (
    <>
      <FormSection title="Ports" description="Publish a container port on a port of this node. Leave a row empty to skip it.">
        <RowHeader columns={['Host port', 'Container port', 'Protocol']} template="md:grid-cols-[1fr_1fr_120px_auto]" />
        {state.ports.map((port, index) => (
          <div key={`port-${String(index)}`} className="grid gap-2 md:grid-cols-[1fr_1fr_120px_auto]">
            <RowInput form={form} name={`ports.${String(index)}.hostPort`} label={`Port ${String(index + 1)} host port`} value={port.hostPort} placeholder="8080" onChange={(value) => { form.updateRow('ports', index, { hostPort: value }) }} />
            <RowInput form={form} name={`ports.${String(index)}.containerPort`} label={`Port ${String(index + 1)} container port`} value={port.containerPort} placeholder="3000" onChange={(value) => { form.updateRow('ports', index, { containerPort: value }) }} />
            <select aria-label={`Port ${String(index + 1)} protocol`} className={SELECT_CLASS} value={port.protocol} onChange={(event) => { form.updateRow('ports', index, { protocol: event.target.value === 'udp' ? 'udp' : 'tcp' }) }}>
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
            </select>
            <RemoveRowButton label={`Remove port ${String(index + 1)}`} onClick={() => { form.removeRow('ports', index) }} />
          </div>
        ))}
        <AddRowButton label="Add port" onClick={() => { form.addRow('ports') }} />
      </FormSection>

      <FormSection title="Volumes" description="Mount a path or named volume of this node into the container. Data in a named volume survives the container.">
        <RowHeader columns={['Host path or volume name', 'Container path', 'Mode']} template="md:grid-cols-[1fr_1fr_120px_auto]" />
        {state.volumes.map((volume, index) => (
          <div key={`volume-${String(index)}`} className="grid gap-2 md:grid-cols-[1fr_1fr_120px_auto]">
            <RowInput form={form} name={`volumes.${String(index)}.hostPath`} label={`Volume ${String(index + 1)} host path or name`} value={volume.hostPath} placeholder="/srv/data or my-volume" onChange={(value) => { form.updateRow('volumes', index, { hostPath: value }) }} />
            <RowInput form={form} name={`volumes.${String(index)}.containerPath`} label={`Volume ${String(index + 1)} container path`} value={volume.containerPath} placeholder="/data" onChange={(value) => { form.updateRow('volumes', index, { containerPath: value }) }} />
            <select aria-label={`Volume ${String(index + 1)} mode`} className={SELECT_CLASS} value={volume.mode} onChange={(event) => { form.updateRow('volumes', index, { mode: event.target.value === 'ro' ? 'ro' : 'rw' }) }}>
              <option value="rw">read-write</option>
              <option value="ro">read-only</option>
            </select>
            <RemoveRowButton label={`Remove volume ${String(index + 1)}`} onClick={() => { form.removeRow('volumes', index) }} />
          </div>
        ))}
        <AddRowButton label="Add volume" onClick={() => { form.addRow('volumes') }} />
      </FormSection>
    </>
  )
}

/** Environment variables, labels and attached networks. */
export function SectionEnvLabelsNetworks({ form, networkOptions }: { form: ContainerForm; networkOptions: { value: string; label: string; description: string }[] }) {
  const { state } = form
  return (
    <>
      <FormSection title="Environment variables" description="Values are stored in the container configuration; do not put long-lived secrets here.">
        <RowHeader columns={['Name', 'Value']} template="md:grid-cols-[1fr_1fr_auto]" />
        {state.envVars.map((entry, index) => (
          <div key={`env-${String(index)}`} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <RowInput form={form} name={`envVars.${String(index)}.key`} label={`Variable ${String(index + 1)} name`} value={entry.key} placeholder="KEY" onChange={(value) => { form.updateRow('envVars', index, { key: value }) }} />
            <RowInput form={form} name={`envVars.${String(index)}.value`} label={`Variable ${String(index + 1)} value`} value={entry.value} placeholder="value" onChange={(value) => { form.updateRow('envVars', index, { value }) }} />
            <RemoveRowButton label={`Remove variable ${String(index + 1)}`} onClick={() => { form.removeRow('envVars', index) }} />
          </div>
        ))}
        <AddRowButton label="Add variable" onClick={() => { form.addRow('envVars') }} />
      </FormSection>

      <FormSection title="Labels" description="Metadata on the container, e.g. for routing or grouping.">
        <RowHeader columns={['Key', 'Value']} template="md:grid-cols-[1fr_1fr_auto]" />
        {state.labels.map((entry, index) => (
          <div key={`label-${String(index)}`} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <RowInput form={form} name={`labels.${String(index)}.key`} label={`Label ${String(index + 1)} key`} value={entry.key} placeholder="com.example.key" onChange={(value) => { form.updateRow('labels', index, { key: value }) }} />
            <RowInput form={form} name={`labels.${String(index)}.value`} label={`Label ${String(index + 1)} value`} value={entry.value} placeholder="value" onChange={(value) => { form.updateRow('labels', index, { value }) }} />
            <RemoveRowButton label={`Remove label ${String(index + 1)}`} onClick={() => { form.removeRow('labels', index) }} />
          </div>
        ))}
        <AddRowButton label="Add label" onClick={() => { form.addRow('labels') }} />
      </FormSection>

      <FormSection title="Attached networks" description="Extra Docker networks on this node to connect the container to.">
        <MultiSelect
          options={networkOptions}
          value={state.selectedNetworks}
          onValueChange={(value) => { form.setField('selectedNetworks', value) }}
          placeholder="Select attached networks"
          searchPlaceholder="Search networks..."
          emptyMessage="No network found on this node."
        />
      </FormSection>
    </>
  )
}
