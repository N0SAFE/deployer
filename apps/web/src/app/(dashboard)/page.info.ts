import { z } from 'zod'

export const Route = {
  name: 'Dashboard' as const,
  params: z.object({}),
  search: z.object({}),
}