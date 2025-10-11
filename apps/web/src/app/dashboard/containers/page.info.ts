import { z } from 'zod';

export const Route = {
  name: 'DashboardContainers',
  params: z.object({}),
  search: z.object({
    status: z.enum(['all', 'running', 'stopped', 'failed']).optional(),
    service: z.string().optional(),
    project: z.string().optional(),
  }),
};