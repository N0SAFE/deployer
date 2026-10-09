import { AuthDashboardAdminProvidersDnsCloudflare } from '@/routes'
import { UnavailableIntegration } from '../../_components/unavailable-integration'

export default function GoogleDnsIntegrationPage() {
  return (
    <UnavailableIntegration
      name="Google Cloud DNS"
      description="DNS records for zones hosted in Google Cloud DNS."
      reason="Only Cloudflare is implemented as a DNS provider today. The API refuses to store Google Cloud credentials, so there is nothing to configure."
      instead={{
        title: 'Use Cloudflare for DNS',
        text: 'Cloudflare manages DNS records and can host the stack’s public edge tunnel. Move the zone to Cloudflare, or point your registrar there.',
        route: AuthDashboardAdminProvidersDnsCloudflare,
        label: 'Open Cloudflare integration',
      }}
    />
  )
}
