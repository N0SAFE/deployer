'use client'

import { PageHeader } from '@/components/dashboard'
import { IntegrationList } from '../_components/integration-list'

export default function DnsIntegrationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings › Integrations"
        title="DNS and public edge"
        description="DNS providers that publish your domains. A Cloudflare account can also host the stack's public edge tunnel."
      />
      <IntegrationList group="dns" />
    </div>
  )
}
