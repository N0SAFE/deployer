import { z } from 'zod'

export const Route = {
  name: 'ProjectServices',
  params: z.object({
    id: z.string(),
  }),
  search: z.object({
    type: z.enum(['web', 'api', 'worker', 'database', 'cache', 'queue']).optional(),
    status: z.enum(['running', 'stopped', 'deploying', 'failed', 'unknown']).optional(),
  }),
}
