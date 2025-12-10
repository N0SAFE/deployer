import { z } from 'zod'

export const Route = {
  name: 'ServiceDetail',
  params: z.object({
    id: z.string(),
    serviceId: z.string(),
  }),
  search: z.object({
    tab: z.enum(['overview', 'deployments', 'dependencies', 'logs', 'settings']).optional(),
  }),
}
