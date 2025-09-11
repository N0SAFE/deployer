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
    serviceName: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Service name must be lowercase alphanumeric with hyphens'),
    deploymentId: z.string().uuid(),
    domain: z.string().min(1),
    subdomain: z.string().optional(),
    filesPath: z.string().min(1),
    customNginxConfig: z.string().optional(),
    sslEnabled: z.boolean().default(false),
});
export const nginxContainerInfoSchema = z.object({
    containerId: z.string(),
    containerName: z.string(),
    domain: z.string(),
    isRunning: z.boolean(),
    createdAt: z.date(),
});
export const updateStaticFilesSchema = z.object({
    containerName: z.string().min(1),
    filesPath: z.string().min(1),
    customNginxConfig: z.string().optional(),
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
    path: "/:serviceName",
    summary: "Update existing static file deployment",
})
    .input(z.object({
    serviceName: z.string().min(1),
}).merge(updateStaticFilesSchema))
    .output(z.object({
    success: z.boolean(),
    error: z.string().optional(),
}));
export const staticFileRemoveContract = oc
    .route({
    method: "DELETE",
    path: "/:serviceName/:containerName",
    summary: "Remove static file deployment",
})
    .input(z.object({
    serviceName: z.string().min(1),
    containerName: z.string().min(1),
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
