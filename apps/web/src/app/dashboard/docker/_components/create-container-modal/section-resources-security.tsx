'use client'

import { Cpu, HeartPulse, Shield } from 'lucide-react'
import { CollapsibleSection, TagInput, ToggleChips } from './form-primitives'
import { CheckboxField, TextField } from './text-field'
import type { ContainerForm } from './use-container-form'

const COMMON_CAPABILITIES = ['SYS_ADMIN', 'SYS_PTRACE', 'NET_ADMIN', 'NET_RAW', 'SYS_TIME', 'CHOWN', 'SETUID', 'SETGID'] as const

function toggled(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

export function SectionResources({ form }: { form: ContainerForm }) {
  const { state, setField } = form
  return (
    <CollapsibleSection title="Resources" icon={<Cpu className="size-4" aria-hidden="true" />} summary={state.memoryLimitMb || state.cpuLimit ? 'limits set' : 'no limits'}>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField form={form} name="memoryLimitMb" label="Memory limit (MB)" value={state.memoryLimitMb} onChange={(value) => { setField('memoryLimitMb', value) }} placeholder="512" hint="The container is killed if it exceeds this." />
        <TextField form={form} name="memoryReservationMb" label="Memory reservation (MB)" value={state.memoryReservationMb} onChange={(value) => { setField('memoryReservationMb', value) }} placeholder="256" />
        <TextField form={form} name="cpuLimit" label="CPU limit (cores)" value={state.cpuLimit} onChange={(value) => { setField('cpuLimit', value) }} placeholder="1" />
        <TextField form={form} name="cpuShares" label="CPU shares" value={state.cpuShares} onChange={(value) => { setField('cpuShares', value) }} placeholder="1024" />
        <TextField form={form} name="cpuQuota" label="CPU quota (µs)" value={state.cpuQuota} onChange={(value) => { setField('cpuQuota', value) }} placeholder="50000" />
        <TextField form={form} name="cpuPeriod" label="CPU period (µs)" value={state.cpuPeriod} onChange={(value) => { setField('cpuPeriod', value) }} placeholder="100000" />
      </div>
    </CollapsibleSection>
  )
}

export function SectionSecurity({ form }: { form: ContainerForm }) {
  const { state, setField } = form
  return (
    <CollapsibleSection title="Security" icon={<Shield className="size-4" aria-hidden="true" />} summary={state.privilegedMode ? 'privileged' : undefined}>
      <TextField form={form} name="containerUser" label="Run as user" value={state.containerUser} onChange={(value) => { setField('containerUser', value) }} placeholder="user:group or UID:GID" hint="Empty uses the image's default user." mono />
      <CheckboxField id="ccm-privileged" label="Privileged mode" checked={state.privilegedMode} onChange={(value) => { setField('privilegedMode', value) }} hint="Gives the container almost full access to this node. Only enable it if you trust the image." />
      <TagInput label="Security options" placeholder="no-new-privileges" values={state.securityOptions} onChange={(value) => { setField('securityOptions', value) }} />
      <ToggleChips label="Add capabilities" options={COMMON_CAPABILITIES} selected={state.capAdd} onToggle={(cap) => { setField('capAdd', toggled(state.capAdd, cap)) }} />
      <ToggleChips label="Drop capabilities" options={COMMON_CAPABILITIES} selected={state.capDrop} onToggle={(cap) => { setField('capDrop', toggled(state.capDrop, cap)) }} />
    </CollapsibleSection>
  )
}

export function SectionHealthcheck({ form }: { form: ContainerForm }) {
  const { state, setField } = form
  return (
    <CollapsibleSection title="Healthcheck" icon={<HeartPulse className="size-4" aria-hidden="true" />} summary={state.healthcheckEnabled ? 'enabled' : 'off'}>
      <CheckboxField id="ccm-health" label="Enable healthcheck" checked={state.healthcheckEnabled} onChange={(value) => { setField('healthcheckEnabled', value) }} />
      {state.healthcheckEnabled ? (
        <>
          <TextField form={form} name="healthcheckCommand" label="Command" value={state.healthcheckCommand} onChange={(value) => { setField('healthcheckCommand', value) }} placeholder="curl -f http://localhost:3000/health || exit 1" hint="Exit code 0 means healthy." mono />
          <TextField form={form} name="healthcheckIntervalSec" label="Interval (seconds)" value={state.healthcheckIntervalSec} onChange={(value) => { setField('healthcheckIntervalSec', value) }} placeholder="30" />
        </>
      ) : null}
    </CollapsibleSection>
  )
}
