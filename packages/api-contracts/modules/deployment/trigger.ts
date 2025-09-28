import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  environmentSchema,
  sourceTypeSchema,
  sourceConfigSchema,
  buildConfigSchema,
  environmentVariableSchema,
  previewConfigSchema,
  deploymentStatusSchema,
  createDeploymentInputSchema,
  resourceLimitsSchema
} from '../../common/deployment-config';
export const deploymentTriggerInput = createDeploymentInputSchema.extend({
    buildStrategy: z.enum(['build-time', 'runtime']).optional(),
    resourceLimits: resourceLimitsSchema.optional()
});
export const deploymentTriggerOutput = z.object({
    deploymentId: z.string().uuid(),
    jobId: z.string(),
    status: deploymentStatusSchema,
    message: z.string(),
    estimatedDuration: z.number().int().positive().optional(),
    queuePosition: z.number().int().positive().optional()
});
export const deploymentTriggerContract = oc
    .route({
    method: "POST",
    path: "/trigger",
    summary: "Trigger new deployment",
})
    .input(deploymentTriggerInput)
    .output(deploymentTriggerOutput);
