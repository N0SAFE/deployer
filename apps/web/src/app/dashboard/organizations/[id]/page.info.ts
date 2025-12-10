import { z } from 'zod'

export const Route = {
  name: 'DashboardOrganizationDetail',
  params: z.object({
    id: z.string().describe('Organization ID'),
  }),
}
