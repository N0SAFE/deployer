import { z } from 'zod'

export const Route = {
  name: 'DashboardDeploymentDetail',
  params: z.object({
    id: z.string().describe('Deployment ID'),
  }),
}
