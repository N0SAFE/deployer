/**
 * Static File Contract - Nginx Container Management for Static Deployments
 *
 * **PURPOSE**: Lightweight nginx container management for serving static files
 *
 * **SCOPE**: This contract handles:
 * - Dynamic nginx container creation and configuration
 * - Static file deployment with custom nginx configs
 * - Traefik integration for routing
 * - Container lifecycle management (deploy, update, remove)
 *
 * **FRONTEND INTEGRATION**: ❌ Backend Only - Infrastructure service
 * - Used internally by deployment system for static file strategies
 * - Automated by deployment orchestration service
 *
 * Routes: /static-file/*
 * Status: 🟢 Production Ready - Automated nginx container management
 * Complexity: Medium - Container orchestration with dynamic routing
 */
import { oc } from '@orpc/contract';
import { z } from 'zod';
// Input/Output Schemas
export const staticFileDeploymentOptionsSchema = z.object({
    serviceId: z.string().uuid(),
    deploymentId: z.string().uuid(),
    projectId: z.string().uuid().optional(),
    domain: z.string().optional(),
    subdomain: z.string().optional(),
    sourcePath: z.string().optional(),
});
export const nginxContainerInfoSchema = z.object({
    containerId: z.string(),
    containerName: z.string(),
    domain: z.string(),
    isRunning: z.boolean(),
    createdAt: z.date(),
});
export const updateStaticFilesSchema = z.object({
    projectId: z.string().uuid().optional(),
    serviceId: z.string().uuid(),
    deploymentId: z.string().uuid(),
    sourcePath: z.string().optional(),
});
// ORPC Contract Definitions
export const staticFileDeployContract = oc
    .route({
    method: "POST",
    path: "/deploy",
    summary: "Deploy static files with nginx container",
})
    .input(staticFileDeploymentOptionsSchema)
    .output(z.object({
    success: z.boolean(),
    containerInfo: nginxContainerInfoSchema.optional(),
    error: z.string().optional(),
}));
export const staticFileUpdateContract = oc
    .route({
    method: "PUT",
    path: "/update",
    summary: "Update existing static file deployment",
})
    .input(updateStaticFilesSchema)
    .output(z.object({
    success: z.boolean(),
    error: z.string().optional(),
}));
export const staticFileRemoveContract = oc
    .route({
    method: "DELETE",
    path: "/remove",
    summary: "Remove static file deployment",
})
    .input(z.object({
    projectId: z.string().uuid().optional(),
    serviceId: z.string().uuid(),
    deploymentId: z.string().uuid().optional(),
}))
    .output(z.object({
    success: z.boolean(),
    error: z.string().optional(),
}));
// Main Static File Contract
export const staticFileContract = oc.tag("StaticFile").prefix("/static-file").router({
    deploy: staticFileDeployContract,
    update: staticFileUpdateContract,
    remove: staticFileRemoveContract,
});
export type StaticFileContract = typeof staticFileContract;
// Type exports
export type StaticFileDeploymentOptions = z.infer<typeof staticFileDeploymentOptionsSchema>;
export type NginxContainerInfo = z.infer<typeof nginxContainerInfoSchema>;
export type UpdateStaticFiles = z.infer<typeof updateStaticFilesSchema>;
