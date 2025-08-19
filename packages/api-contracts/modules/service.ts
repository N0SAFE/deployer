import { oc } from '@orpc/contract';
import { z } from 'zod';

// Service schemas matching database
export const resourceLimitsSchema = z.object({
  memory: z.string().optional(), // e.g., "512m"
  cpu: z.string().optional(), // e.g., "0.5"
  storage: z.string().optional(), // e.g., "1g" 
});

export const createServiceSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Service name must be lowercase alphanumeric with hyphens only'),
  type: z.string().min(1), // e.g., "web", "worker", "database"
  dockerfilePath: z.string().default("Dockerfile"),
  buildContext: z.string().default("."),
  port: z.number().int().positive().optional(),
  healthCheckPath: z.string().default("/health"),
  environmentVariables: z.record(z.string(), z.string()).optional(),
  buildArguments: z.record(z.string(), z.string()).optional(),
  resourceLimits: resourceLimitsSchema.optional(),
});

export const updateServiceSchema = createServiceSchema.partial().omit({ projectId: true });

export const serviceSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  type: z.string(),
  dockerfilePath: z.string(),
  buildContext: z.string(),
  port: z.number().nullable(),
  healthCheckPath: z.string(),
  environmentVariables: z.record(z.string(), z.string()).nullable(),
  buildArguments: z.record(z.string(), z.string()).nullable(),
  resourceLimits: resourceLimitsSchema.nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const serviceWithStatsSchema = serviceSchema.extend({
  _count: z.object({
    deployments: z.number(),
    dependencies: z.number(),
  }),
  latestDeployment: z.object({
    id: z.string(),
    status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']),
    environment: z.enum(['production', 'staging', 'preview', 'development']),
    createdAt: z.date(),
    domainUrl: z.string().nullable(),
  }).nullable(),
  project: z.object({
    id: z.string(),
    name: z.string(),
    baseDomain: z.string().nullable(),
  }),
});

export const serviceDependencySchema = z.object({
  id: z.string().uuid(),
  serviceId: z.string().uuid(),
  dependsOnServiceId: z.string().uuid(),
  isRequired: z.boolean(),
  createdAt: z.date(),
});

export const createServiceDependencySchema = z.object({
  dependsOnServiceId: z.string().uuid(),
  isRequired: z.boolean().default(true),
});

export const deploymentSummarySchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']),
  environment: z.enum(['production', 'staging', 'preview', 'development']),
  triggeredBy: z.string().nullable(),
  domainUrl: z.string().nullable(),
  healthCheckUrl: z.string().nullable(),
  containerName: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const serviceContract = oc.router({
  // List services for a project
  listByProject: oc
    .route({
      method: "GET",
      path: "/projects/:projectId/services",
      summary: "List services for a project",
    })
    .input(
      z.object({
        projectId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
        type: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .output(
      z.object({
        services: z.array(serviceWithStatsSchema),
        total: z.number(),
        hasMore: z.boolean(),
      })
    ),

  // Get service by ID
  getById: oc
    .route({
      method: "GET",
      path: "/services/:id",
      summary: "Get service by ID",
    })
    .input(
      z.object({
        id: z.string().uuid(),
      })
    )
    .output(serviceWithStatsSchema),

  // Create new service
  create: oc
    .route({
      method: "POST",
      path: "/services",
      summary: "Create new service",
    })
    .input(createServiceSchema)
    .output(serviceSchema),

  // Update service
  update: oc
    .route({
      method: "PUT",
      path: "/services/:id",
      summary: "Update service",
    })
    .input(
      z.object({
        id: z.string().uuid(),
      }).merge(updateServiceSchema)
    )
    .output(serviceSchema),

  // Delete service
  delete: oc
    .route({
      method: "DELETE",
      path: "/services/:id",
      summary: "Delete service",
    })
    .input(
      z.object({
        id: z.string().uuid(),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        message: z.string(),
      })
    ),

  // List deployments for a service
  getDeployments: oc
    .route({
      method: "GET",
      path: "/services/:id/deployments",
      summary: "List deployments for a service",
    })
    .input(
      z.object({
        id: z.string().uuid(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        environment: z.enum(['production', 'staging', 'preview', 'development']).optional(),
        status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']).optional(),
      })
    )
    .output(
      z.object({
        deployments: z.array(deploymentSummarySchema),
        total: z.number(),
        hasMore: z.boolean(),
      })
    ),

  // Get service dependencies
  getDependencies: oc
    .route({
      method: "GET",
      path: "/services/:id/dependencies",
      summary: "Get service dependencies",
    })
    .input(
      z.object({
        id: z.string().uuid(),
      })
    )
    .output(
      z.object({
        dependencies: z.array(serviceDependencySchema.extend({
          dependsOnService: z.object({
            id: z.string(),
            name: z.string(),
            type: z.string(),
          }),
        })),
      })
    ),

  // Add service dependency
  addDependency: oc
    .route({
      method: "POST",
      path: "/services/:id/dependencies",
      summary: "Add service dependency",
    })
    .input(
      z.object({
        id: z.string().uuid(),
      }).merge(createServiceDependencySchema)
    )
    .output(serviceDependencySchema),

  // Remove service dependency
  removeDependency: oc
    .route({
      method: "DELETE",
      path: "/services/:id/dependencies/:dependencyId",
      summary: "Remove service dependency",
    })
    .input(
      z.object({
        id: z.string().uuid(),
        dependencyId: z.string().uuid(),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        message: z.string(),
      })
    ),

  // Toggle service active status
  toggleActive: oc
    .route({
      method: "PATCH",
      path: "/services/:id/toggle",
      summary: "Toggle service active status",
    })
    .input(
      z.object({
        id: z.string().uuid(),
        isActive: z.boolean(),
      })
    )
    .output(serviceSchema),
});

export type ServiceContract = typeof serviceContract;