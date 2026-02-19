import { z } from 'zod';

export const Route = {
  name: 'GlobalDeployments',
  params: z.object({}),
  search: z.object({
    status: z.enum(['all', 'success', 'failed', 'pending', 'building', 'deploying', 'cancelled']).optional(),
    environment: z.enum(['all', 'production', 'staging', 'preview', 'development']).optional(),
    project: z.string().optional(),
    tab: z.enum(['all', 'active', 'completed', 'failed']).optional(),
  }),
};