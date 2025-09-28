import { oc } from '@orpc/contract';
import { z } from 'zod';
export const environmentSchema = z.enum(['production', 'staging', 'preview', 'development']);
export const sourceTypeSchema = z.enum(['github', 'gitlab', 'git', 'upload', 'custom']);
// Source configuration schema that matches database
export const sourceConfigSchema = z.object({
    // GitHub/GitLab
    repositoryUrl: z.string().optional(),
    branch: z.string().optional(),
    commitSha: z.string().optional(),
    pullRequestNumber: z.number().optional(),
    // File upload
    fileName: z.string().optional(),
    fileSize: z.number().optional(),
    // Custom
    customData: z.record(z.string(), z.any()).optional(),
});
export const deploymentTriggerInput = z.object({
    serviceId: z.string(),
    environment: environmentSchema,
    // sourceType and sourceConfig are now optional - they will be determined by the API
    // based on the service's provider and builder configuration in the database
    sourceType: sourceTypeSchema.optional(),
    sourceConfig: sourceConfigSchema.optional(),
    environmentVariables: z.record(z.string(), z.string()).optional(),
});
export const deploymentTriggerOutput = z.object({
    deploymentId: z.string(),
    jobId: z.string(),
    status: z.string(),
    message: z.string(),
});
export const deploymentTriggerContract = oc
    .route({
    method: "POST",
    path: "/trigger",
    summary: "Trigger new deployment",
})
    .input(deploymentTriggerInput)
    .output(deploymentTriggerOutput);
