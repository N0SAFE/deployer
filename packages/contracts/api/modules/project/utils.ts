import { oc } from '@orpc/contract';
import { z } from 'zod';
// Temporary placeholders for schemas - will be properly imported when variable-resolver module is reorganized
const resolveVariableRequestSchema = z.any();
const resolveVariableResponseSchema = z.any();
const environmentStatusSchema = z.any();
// Resolve Variables
export const projectResolveVariablesInput = z.object({
    id: z.string().uuid(),
}).passthrough(); // Allow additional properties from resolveVariableRequestSchema
export const projectResolveVariablesOutput = resolveVariableResponseSchema;
export const projectResolveVariablesContract = oc
    .route({
    method: "POST",
    path: "/:id/resolve-variables",
    summary: "Resolve dynamic variables in template",
})
    .input(projectResolveVariablesInput)
    .output(projectResolveVariablesOutput);
// Get Available Variables
export const projectGetAvailableVariablesInput = z.object({
    id: z.string().uuid(),
    environmentId: z.string().uuid().optional(),
    scope: z.enum(['project', 'service', 'environment', 'global']).optional(),
});
export const projectGetAvailableVariablesOutput = z.object({
    variables: z.array(z.object({
        key: z.string(),
        path: z.string(),
        scope: z.string(),
        description: z.string().optional(),
        example: z.string().optional(),
    })),
    scopes: z.array(z.object({
        scope: z.string(),
        description: z.string(),
        variables: z.array(z.string()),
    })),
});
export const projectGetAvailableVariablesContract = oc
    .route({
    method: "GET",
    path: "/:id/available-variables",
    summary: "Get all available variables for dynamic resolution",
})
    .input(projectGetAvailableVariablesInput)
    .output(projectGetAvailableVariablesOutput);
// Get Environment Status
export const projectGetEnvironmentStatusInput = z.object({
    id: z.string().uuid(),
    environmentId: z.string().uuid(),
});
export const projectGetEnvironmentStatusOutput = environmentStatusSchema;
export const projectGetEnvironmentStatusContract = oc
    .route({
    method: "GET",
    path: "/:id/environments/:environmentId/status",
    summary: "Get environment status and health",
})
    .input(projectGetEnvironmentStatusInput)
    .output(projectGetEnvironmentStatusOutput);
// Get All Environment Statuses
export const projectGetAllEnvironmentStatusesInput = z.object({
    id: z.string().uuid(),
});
export const projectGetAllEnvironmentStatusesOutput = z.object({
    environments: z.array(environmentStatusSchema),
    summary: z.object({
        total: z.number(),
        healthy: z.number(),
        unhealthy: z.number(),
        deploying: z.number(),
        failed: z.number(),
    }),
});
export const projectGetAllEnvironmentStatusesContract = oc
    .route({
    method: "GET",
    path: "/:id/environment-statuses",
    summary: "Get status for all project environments",
})
    .input(projectGetAllEnvironmentStatusesInput)
    .output(projectGetAllEnvironmentStatusesOutput);
// Refresh Environment Status
export const projectRefreshEnvironmentStatusInput = z.object({
    id: z.string().uuid(),
    environmentId: z.string().uuid(),
});
export const projectRefreshEnvironmentStatusOutput = environmentStatusSchema;
export const projectRefreshEnvironmentStatusContract = oc
    .route({
    method: "POST",
    path: "/:id/environments/:environmentId/refresh-status",
    summary: "Refresh environment status and variable resolution",
})
    .input(projectRefreshEnvironmentStatusInput)
    .output(projectRefreshEnvironmentStatusOutput);
