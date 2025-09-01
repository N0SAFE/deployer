import { oc } from '@orpc/contract';
import { z } from 'zod';

export const deploymentJobStatusInput = z.object({
  jobId: z.string(),
});

export const deploymentJobStatusOutput = z.object({
  id: z.string(),
  status: z.enum(['waiting', 'active', 'completed', 'failed', 'delayed']),
  progress: z.number().min(0).max(100),
  data: z.record(z.string(), z.any()),
  result: z.record(z.string(), z.any()).optional(),
  failedReason: z.string().optional(),
  processedOn: z.string().optional(),
  finishedOn: z.string().optional(),
  delay: z.number().optional(),
  timestamp: z.string(),
});

export const deploymentJobStatusContract = oc
  .route({
    method: 'GET',
    path: '/job/:jobId',
    summary: 'Get deployment job status',
    description: 'Returns status and progress for a deployment job',
  })
  .input(deploymentJobStatusInput)
  .output(deploymentJobStatusOutput);
