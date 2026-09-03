import { z } from 'zod'

export const page = true
export const layout = false
export const Route = {
  name: 'AuthDashboardProjectsProjectIdDomains',
  params: z.object({
    projectId: z.string(),
  }),
}
