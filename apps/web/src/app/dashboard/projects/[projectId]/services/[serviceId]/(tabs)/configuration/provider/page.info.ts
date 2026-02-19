import { z } from 'zod'

export const Route = {
  name: 'DashboardProjectsProjectIdServicesServiceIdTabsConfigurationProvider',
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  }),
}
