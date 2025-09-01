import { oc } from '@orpc/contract';
import { z } from 'zod';
import { deploymentEnvironmentSchema } from './schemas';

export const environmentListInput = z.object({
  projectId: z.string().uuid().optional(),
  type: z.enum(['production', 'staging', 'preview']).optional(),
  search: z.string().optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  sortBy: z.enum(['name', 'type', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const environmentListOutput = z.object({
  success: z.boolean(),
  data: z.object({
    environments: z.array(deploymentEnvironmentSchema),
    pagination: z.object({
      total: z.number(),
      limit: z.number(),
      offset: z.number(),
    }),
  }),
});

export const environmentListContract = oc
  .route({
    method: "GET",
    path: "/",
    summary: "List environments with optional filtering and pagination",
  })
  .input(environmentListInput)
  .output(environmentListOutput);