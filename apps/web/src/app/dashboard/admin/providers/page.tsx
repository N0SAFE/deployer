'use client'

import { PageHeader, StatStrip, StatStripItem } from '@/components/dashboard'
import { IntegrationList, useIntegrationSummary } from './_components/integration-list'

function GroupHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

/**
 * The Integrations landing: every external service this platform can use, what
 * connecting it enables, whether it works right now, and the one next step.
 * Statuses come from the API's own data — a service is only "Connected" when a
 * live check said so.
 */
export default function IntegrationsPage() {
  const summary = useIntegrationSummary()
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Integrations"
        description="External services this platform uses: Git hosts and registries to deploy from, and DNS providers to publish your domains."
      />

      {summary.loading ? null : (
        <StatStrip>
          <StatStripItem label="Connected" value={`${String(summary.connected)} of ${String(summary.total)}`} tone={summary.connected > 0 ? 'live' : undefined} />
          <StatStripItem
            label="Need a look"
            value={summary.attention}
            tone={summary.attention > 0 ? 'pending' : undefined}
            hint="expired, rejected or never verified"
          />
        </StatStrip>
      )}

      <section className="space-y-3">
        <GroupHeading title="Code and registries" description="Where your services' source code and images come from." />
        <IntegrationList group="code" />
      </section>

      <section className="space-y-3">
        <GroupHeading title="DNS and public edge" description="Where your domains are published, and the account the public edge can run on." />
        <IntegrationList group="dns" />
      </section>
    </div>
  )
}
