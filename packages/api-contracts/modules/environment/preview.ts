import { oc } from '@orpc/contract';
import { z } from 'zod';
import { deploymentEnvironmentSchema, environmentVariableSchema } from './schemas';
// Preview environment configuration
export const previewEnvironmentConfigSchema = z.object({
    autoDeleteAfterDays: z.number().min(1).max(90).default(7),
    maxInstances: z.number().min(1).max(20).default(5),
    allowedBranches: z.array(z.string()).default(['feature/*', 'preview/*']),
    requirePullRequest: z.boolean().default(true),
    variableTemplate: z.string().uuid().optional(), // reference to variable template
    inheritFromEnvironment: z.string().uuid().optional(), // inherit variables from existing env
});
export const createPreviewEnvironmentSchema = z.object({
    name: z.string().min(1).max(100),
    branch: z.string().min(1),
    pullRequestId: z.string().optional(),
    config: previewEnvironmentConfigSchema.optional(),
    variables: z.array(environmentVariableSchema).default([]),
    metadata: z.record(z.string(), z.any()).optional(),
});
// Create Preview Environment
export const environmentCreatePreviewInput = createPreviewEnvironmentSchema;
export const environmentCreatePreviewOutput = z.object({
    success: z.boolean(),
    data: deploymentEnvironmentSchema,
});
export const environmentCreatePreviewContract = oc
    .route({
    method: "POST",
    path: "/preview",
    summary: "Create a preview environment",
})
    .input(environmentCreatePreviewInput)
    .output(environmentCreatePreviewOutput);
// Create Preview Environment for Project
export const environmentCreatePreviewForProjectInput = z.object({
    projectId: z.string().min(1), // Accept both UUIDs and project slugs
}).merge(createPreviewEnvironmentSchema);
export const environmentCreatePreviewForProjectOutput = deploymentEnvironmentSchema;
export const environmentCreatePreviewForProjectContract = oc
    .route({
    method: "POST",
    path: "/projects/:projectId/environments/preview",
    summary: "Create preview environment for branch/PR",
})
    .input(environmentCreatePreviewForProjectInput)
    .output(environmentCreatePreviewForProjectOutput);
// List Preview Environments
export const environmentListPreviewsInput = z.object({
    projectId: z.string().uuid().optional(),
});
export const environmentListPreviewsOutput = z.object({
    success: z.boolean(),
    data: z.array(deploymentEnvironmentSchema),
});
export const environmentListPreviewsContract = oc
    .route({
    method: "GET",
    path: "/preview",
    summary: "List all preview environments",
})
    .input(environmentListPreviewsInput)
    .output(environmentListPreviewsOutput);
// List Preview Environments with Filters
export const environmentListPreviewEnvironmentsInput = z.object({
    projectId: z.string().min(1), // Accept both UUIDs and project slugs
    branch: z.string().optional(),
    status: z.enum(['active', 'expired', 'all']).default('active'),
    limit: z.number().min(1).max(100).default(20),
    offset: z.number().min(0).default(0),
});
export const environmentListPreviewEnvironmentsOutput = z.object({
    environments: z.array(deploymentEnvironmentSchema),
    total: z.number(),
    hasMore: z.boolean(),
});
export const environmentListPreviewEnvironmentsContract = oc
    .route({
    method: "GET",
    path: "/projects/:projectId/environments/preview",
    summary: "List preview environments with filters",
})
    .input(environmentListPreviewEnvironmentsInput)
    .output(environmentListPreviewEnvironmentsOutput);
// Cleanup Expired Previews
export const environmentCleanupExpiredPreviewsInput = z.object({});
export const environmentCleanupExpiredPreviewsOutput = z.object({
    success: z.boolean(),
    data: z.object({
        cleanedUpEnvironments: z.array(z.string().uuid()),
        count: z.number(),
    }),
});
export const environmentCleanupExpiredPreviewsContract = oc
    .route({
    method: "DELETE",
    path: "/preview/cleanup",
    summary: "Cleanup expired preview environments",
})
    .input(environmentCleanupExpiredPreviewsInput)
    .output(environmentCleanupExpiredPreviewsOutput);
// Cleanup Preview Environments for Project
export const environmentCleanupPreviewEnvironmentsInput = z.object({
    projectId: z.string().min(1), // Accept both UUIDs and project slugs
    dryRun: z.boolean().default(false),
});
export const environmentCleanupPreviewEnvironmentsOutput = z.object({
    cleanedUp: z.array(z.object({
        id: z.string().uuid(),
        name: z.string(),
        reason: z.string(),
    })),
    skipped: z.array(z.object({
        id: z.string().uuid(),
        name: z.string(),
        reason: z.string(),
    })),
    summary: z.object({
        total: z.number(),
        cleanedUp: z.number(),
        skipped: z.number(),
    }),
});
export const environmentCleanupPreviewEnvironmentsContract = oc
    .route({
    method: "POST",
    path: "/projects/:projectId/environments/preview/cleanup",
    summary: "Cleanup expired preview environments",
})
    .input(environmentCleanupPreviewEnvironmentsInput)
    .output(environmentCleanupPreviewEnvironmentsOutput);
