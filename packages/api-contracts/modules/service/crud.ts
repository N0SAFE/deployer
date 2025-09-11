import { oc } from '@orpc/contract';
import { z } from 'zod';
import { 
    serviceWithStatsSchema, 
    createServiceSchema, 
    updateServiceSchema, 
    serviceSchema, 
    createServiceDependencySchema, 
    serviceDependencySchema, 
    deploymentSummarySchema, 
    addServiceLogInput, 
    addServiceLogOutput,
    getProjectDependencyGraphInput,
    getProjectDependencyGraphOutput
} from './schemas';
export const serviceListByProjectInput = z.object({
    projectId: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    search: z.string().optional(),
    type: z.string().optional(),
    isActive: z.coerce.boolean().optional(),
});
export const serviceListByProjectOutput = z.object({
    services: z.array(serviceWithStatsSchema),
    total: z.number(),
    hasMore: z.boolean(),
});
export const serviceListByProjectContract = oc
    .route({
    method: "GET",
    path: "/projects/:projectId/services",
    summary: "List services for a project",
})
    .input(serviceListByProjectInput)
    .output(serviceListByProjectOutput);
export const serviceGetByIdInput = z.object({
    id: z.string().uuid(),
});
export const serviceGetByIdOutput = serviceWithStatsSchema;
export const serviceGetByIdContract = oc
    .route({
    method: "GET",
    path: "/:id",
    summary: "Get service by ID",
})
    .input(serviceGetByIdInput)
    .output(serviceGetByIdOutput);
// Create new service
export const serviceCreateContract = oc
    .route({
    method: "POST",
    path: "/",
    summary: "Create new service",
})
    .input(createServiceSchema)
    .output(serviceSchema);
// Update service
export const serviceUpdateContract = oc
    .route({
    method: "PUT",
    path: "/:id",
    summary: "Update service",
})
    .input(z.object({
    id: z.string().uuid(),
}).merge(updateServiceSchema))
    .output(serviceSchema);
// Delete service
export const serviceDeleteContract = oc
    .route({
    method: "DELETE",
    path: "/:id",
    summary: "Delete service",
})
    .input(z.object({
    id: z.string().uuid(),
}))
    .output(z.object({
    success: z.boolean(),
    message: z.string(),
}));
// List deployments for a service
export const serviceGetDeploymentsContract = oc
    .route({
    method: "GET",
    path: "/:id/deployments",
    summary: "List deployments for a service",
})
    .input(z.object({
    id: z.string().uuid(),
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0),
    environment: z.enum(['production', 'staging', 'preview', 'development']).optional(),
    status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']).optional(),
}))
    .output(z.object({
    deployments: z.array(deploymentSummarySchema),
    total: z.number(),
    hasMore: z.boolean(),
}));
// Get service dependencies
export const serviceGetDependenciesContract = oc
    .route({
    method: "GET",
    path: "/:id/dependencies",
    summary: "Get service dependencies",
})
    .input(z.object({
    id: z.string().uuid(),
}))
    .output(z.object({
    dependencies: z.array(serviceDependencySchema.extend({
        dependsOnService: z.object({
            id: z.string(),
            name: z.string(),
            type: z.string(),
        }),
    })),
}));
// Add service dependency
export const serviceAddDependencyContract = oc
    .route({
    method: "POST",
    path: "/:id/dependencies",
    summary: "Add service dependency",
})
    .input(z.object({
    id: z.string().uuid(),
}).merge(createServiceDependencySchema))
    .output(serviceDependencySchema);
// Remove service dependency
export const serviceRemoveDependencyContract = oc
    .route({
    method: "DELETE",
    path: "/:id/dependencies/:dependencyId",
    summary: "Remove service dependency",
})
    .input(z.object({
    id: z.string().uuid(),
    dependencyId: z.string().uuid(),
}))
    .output(z.object({
    success: z.boolean(),
    message: z.string(),
}));
// Toggle service active status
export const serviceToggleActiveContract = oc
    .route({
    method: "PATCH",
    path: "/:id/toggle",
    summary: "Toggle service active status",
})
    .input(z.object({
    id: z.string().uuid(),
    isActive: z.boolean(),
}))
    .output(serviceSchema);
// Add service log
export const serviceAddLogContract = oc
    .route({
    method: "POST",
    path: "/logs",
    summary: "Add service log entry",
})
    .input(addServiceLogInput)
    .output(addServiceLogOutput);

// Traefik Configuration Management

// Get Traefik configuration for a service
export const serviceGetTraefikConfigContract = oc
    .route({
    method: "GET",
    path: "/:id/traefik-config",
    summary: "Get Traefik configuration for service",
})
    .input(z.object({
    id: z.string().uuid(),
}))
    .output(z.object({
    id: z.string().uuid(),
    serviceId: z.string().uuid(),
    domain: z.string(),
    subdomain: z.string(),
    fullDomain: z.string(),
    sslEnabled: z.boolean(),
    sslProvider: z.string().nullable(),
    pathPrefix: z.string(),
    port: z.number(),
    middleware: z.record(z.string(), z.any()),
    healthCheck: z.record(z.string(), z.any()),
    isActive: z.boolean(),
    configContent: z.string(),
    lastSyncedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
}));

// Update Traefik configuration for a service
export const serviceUpdateTraefikConfigContract = oc
    .route({
    method: "PUT",
    path: "/:id/traefik-config",
    summary: "Update Traefik configuration for service",
})
    .input(z.object({
    id: z.string().uuid(),
    domain: z.string().optional(),
    subdomain: z.string().optional(),
    sslEnabled: z.boolean().optional(),
    sslProvider: z.string().nullable().optional(),
    pathPrefix: z.string().optional(),
    port: z.number().optional(),
    middleware: z.record(z.string(), z.any()).optional(),
    healthCheck: z.record(z.string(), z.any()).optional(),
    configContent: z.string().optional(),
    isActive: z.boolean().optional(),
}))
    .output(z.object({
    id: z.string().uuid(),
    serviceId: z.string().uuid(),
    domain: z.string(),
    subdomain: z.string(),
    fullDomain: z.string(),
    sslEnabled: z.boolean(),
    sslProvider: z.string().nullable(),
    pathPrefix: z.string(),
    port: z.number(),
    middleware: z.record(z.string(), z.any()),
    healthCheck: z.record(z.string(), z.any()),
    isActive: z.boolean(),
    configContent: z.string(),
    lastSyncedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
}));

// Sync Traefik configuration to file system
export const serviceSyncTraefikConfigContract = oc
    .route({
    method: "POST",
    path: "/:id/traefik-config/sync",
    summary: "Sync Traefik configuration to file system",
})
    .input(z.object({
    id: z.string().uuid(),
}))
    .output(z.object({
    success: z.boolean(),
    message: z.string(),
    syncedAt: z.string(),
    filePath: z.string().optional(),
}));

// Get project dependency graph
export const serviceGetProjectDependencyGraphContract = oc
    .route({
    method: "GET",
    path: "/projects/:projectId/dependencies-graph",
    summary: "Get project service dependency graph",
})
    .input(getProjectDependencyGraphInput)
    .output(getProjectDependencyGraphOutput);
