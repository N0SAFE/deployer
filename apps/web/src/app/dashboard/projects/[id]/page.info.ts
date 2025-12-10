import { z } from 'zod'

export const Route = {
  name: 'DashboardProjectDetail',
  params: z.object({
    id: z.string().describe('Project ID'),
  }),
}
