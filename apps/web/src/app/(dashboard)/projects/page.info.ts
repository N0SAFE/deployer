import { z } from 'zod'

export const Route = {
  name: 'Projects' as const,
  params: z.object({}),
  search: z.object({
    search: z.string().optional(),
    status: z.enum(['active', 'inactive', 'archived']).optional(),
  }),
}