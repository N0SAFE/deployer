'use client'

import { DockerRuntimeStackOverview } from '../docker-runtime-stack-overview'
import { completeKeyValues, completePorts, completeVolumes } from './container-form.model'
import { SectionBasics } from './section-basics'
import { SectionEnvLabelsNetworks, SectionPortsVolumes } from './section-mounts'
import { SectionResources, SectionSecurity, SectionHealthcheck } from './section-resources-security'
import { SectionAutoUpdate, SectionDevices, SectionDns, SectionGpu, SectionUlimits } from './section-runtime'
import type { PullScanFlow } from './use-pull-scan-flow'
import type { ContainerForm } from './use-container-form'

/** The "Container" step: every runtime option, most common first, advanced ones collapsed. */
export function ContainerConfigStage({ form, flow, networkOptions }: {
  form: ContainerForm
  flow: PullScanFlow
  networkOptions: { value: string; label: string; description: string }[]
}) {
  const { state } = form
  return (
    <div className="space-y-4">
      <DockerRuntimeStackOverview
        image={state.image}
        pullStatus={flow.pullStatus}
        scanStatus={flow.scanStatus}
        portsCount={completePorts(state.ports).length}
        volumesCount={completeVolumes(state.volumes).length}
        envVarsCount={completeKeyValues(state.envVars).length}
        labelsCount={completeKeyValues(state.labels).length}
        networkMode={state.networkMode}
        selectedNetworksCount={state.selectedNetworks.length}
      />
      <SectionBasics form={form} />
      <SectionPortsVolumes form={form} />
      <SectionEnvLabelsNetworks form={form} networkOptions={networkOptions} />
      <SectionResources form={form} />
      <SectionSecurity form={form} />
      <SectionHealthcheck form={form} />
      <SectionDns form={form} />
      <SectionDevices form={form} />
      <SectionGpu form={form} />
      <SectionUlimits form={form} />
      <SectionAutoUpdate form={form} />
    </div>
  )
}
