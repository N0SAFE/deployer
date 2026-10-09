import { redirect } from 'next/navigation'
import { AuthDashboardProjectsProjectIdServicesServiceIdConfigurationGeneral } from '@/routes'

/**
 * `/configuration` has no content of its own: the service's identity lives on
 * Configuration → General (which also covers resources and retention). The
 * Configuration tab lands there so the same fields are never editable in two
 * places.
 */
export default async function DashboardServiceConfigurationIndexPage({
  params,
}: {
  params: Promise<{ projectId: string; serviceId: string }>
}) {
  const { projectId, serviceId } = await params
  redirect(AuthDashboardProjectsProjectIdServicesServiceIdConfigurationGeneral({ projectId, serviceId }))
}
