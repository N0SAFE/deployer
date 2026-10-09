import { AuthDashboardAdminProvidersDnsCloudflare } from '@/routes'
import { UnavailableIntegration } from '../../_components/unavailable-integration'

export default function Route53IntegrationPage() {
  return (
    <UnavailableIntegration
      name="AWS Route 53"
      description="DNS records for domains hosted in Route 53."
      reason="Only Cloudflare is implemented as a DNS provider today. The API refuses to store Route 53 credentials, so there is nothing to configure."
      instead={{
        title: 'Use Cloudflare for DNS',
        text: 'Cloudflare manages DNS records and can host the stack’s public edge tunnel. Move the zone to Cloudflare, or point your registrar there.',
        route: AuthDashboardAdminProvidersDnsCloudflare,
        label: 'Open Cloudflare integration',
      }}
    />
  )
}
