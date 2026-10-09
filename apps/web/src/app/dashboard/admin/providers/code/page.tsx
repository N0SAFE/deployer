'use client'

import { PageHeader } from '@/components/dashboard'
import { IntegrationList } from '../_components/integration-list'

export default function CodeIntegrationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings › Integrations"
        title="Code and registries"
        description="Git hosts and image registries your services are built and deployed from."
      />
      <IntegrationList group="code" />
    </div>
  )
}
