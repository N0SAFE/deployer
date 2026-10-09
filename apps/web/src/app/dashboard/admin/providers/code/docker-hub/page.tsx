import { AuthDashboardAdminProvidersCodeGithub } from '@/routes'
import { UnavailableIntegration } from '../../_components/unavailable-integration'

export default function DockerHubIntegrationPage() {
  return (
    <UnavailableIntegration
      name="Docker Hub"
      description="Private image pulls from Docker Hub or another container registry."
      reason="The platform has no place to store registry credentials yet, so anything entered here would be lost. Public images pull without credentials and keep working."
      instead={{
        title: 'Deploy from source instead',
        text: 'Connect a Git host and the platform builds the image for you, so no private registry is needed.',
        route: AuthDashboardAdminProvidersCodeGithub,
        label: 'Open GitHub integration',
      }}
    />
  )
}
