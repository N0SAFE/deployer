import { oc } from '@orpc/contract';
import { z } from 'zod';

// Traefik Instance schemas
export const CreateTraefikInstanceSchema = z.object({
  name: z.string().min(1).max(255),
  dashboardPort: z.number().min(1024).max(65535).optional(),
  httpPort: z.number().min(80).max(65535).optional(),
  httpsPort: z.number().min(443).max(65535).optional(),
  acmeEmail: z.string().email().optional(),
  logLevel: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
  insecureApi: z.boolean().default(true),
});

export const TraefikInstanceSchema = z.object({
  id: z.string(),
  name: z.string(),
  containerId: z.string().nullable(),
  status: z.enum(['stopped', 'starting', 'running', 'stopping', 'error']),
  dashboardPort: z.number().nullable(),
  httpPort: z.number().nullable(),
  httpsPort: z.number().nullable(),
  acmeEmail: z.string().nullable(),
  logLevel: z.string().nullable(),
  insecureApi: z.boolean().nullable(),
  config: z.any(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Domain Config schemas
export const CreateDomainConfigSchema = z.object({
  domain: z.string().min(1),
  subdomain: z.string().optional(),
  sslEnabled: z.boolean().default(false),
  sslProvider: z.enum(['letsencrypt', 'selfsigned', 'custom']).optional(),
  certificatePath: z.string().optional(),
  middleware: z.record(z.string(), z.any()).optional(),
  isActive: z.boolean().default(true),
});

export const DomainConfigSchema = z.object({
  id: z.string(),
  traefikInstanceId: z.string(),
  domain: z.string(),
  subdomain: z.string().nullable(),
  fullDomain: z.string(),
  sslEnabled: z.boolean().nullable(),
  sslProvider: z.string().nullable(),
  certificatePath: z.string().nullable(),
  middleware: z.any(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Route Config schemas
export const CreateRouteConfigSchema = z.object({
  deploymentId: z.string().optional(),
  routeName: z.string().min(1),
  serviceName: z.string().min(1),
  containerName: z.string().optional(),
  targetPort: z.number(),
  pathPrefix: z.string().min(1).default('/'),
  priority: z.number().optional(),
  middleware: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

export const RouteConfigSchema = z.object({
  id: z.string(),
  domainConfigId: z.string(),
  deploymentId: z.string().nullable(),
  routeName: z.string(),
  serviceName: z.string(),
  containerName: z.string().nullable(),
  targetPort: z.number(),
  pathPrefix: z.string().nullable(),
  priority: z.number().nullable(),
  middleware: z.any(),
  isActive: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Deployment Registration schemas
export const RegisterDeploymentSchema = z.object({
  deploymentId: z.string().min(1),
  serviceName: z.string().min(1),
  containerName: z.string().min(1),
  targetPort: z.number(),
  domain: z.string().min(1),
  subdomain: z.string().optional(),
  pathPrefix: z.string().default('/'),
  sslEnabled: z.boolean().default(false),
  middleware: z.array(z.string()).default([]),
});

export const DeploymentRegistrationResponseSchema = z.object({
  domainConfigId: z.string(),
  routeConfigId: z.string(),
  fullDomain: z.string(),
  deploymentUrl: z.string().url(),
  message: z.string(),
});

// Traefik management contracts
export const traefikContract = oc.router({
  // Instance management
  createInstance: oc
    .route({
      method: 'POST',
      path: '/traefik/instances',
      summary: 'Create a new Traefik instance',
    })
    .input(CreateTraefikInstanceSchema)
    .output(TraefikInstanceSchema),

  listInstances: oc
    .route({
      method: 'GET',
      path: '/traefik/instances',
      summary: 'List all Traefik instances',
    })
    .input(z.object({}).optional())
    .output(z.array(TraefikInstanceSchema)),

  getInstance: oc
    .route({
      method: 'GET',
      path: '/traefik/instances/:instanceId',
      summary: 'Get a specific Traefik instance',
    })
    .input(z.object({
      instanceId: z.string(),
    }))
    .output(TraefikInstanceSchema),

  startInstance: oc
    .route({
      method: 'POST',
      path: '/traefik/instances/:instanceId/start',
      summary: 'Start a Traefik instance',
    })
    .input(z.object({
      instanceId: z.string(),
    }))
    .output(TraefikInstanceSchema),

  stopInstance: oc
    .route({
      method: 'POST',
      path: '/traefik/instances/:instanceId/stop',
      summary: 'Stop a Traefik instance',
    })
    .input(z.object({
      instanceId: z.string(),
    }))
    .output(TraefikInstanceSchema),

  healthCheckInstance: oc
    .route({
      method: 'GET',
      path: '/traefik/instances/:instanceId/health',
      summary: 'Check health of a Traefik instance',
    })
    .input(z.object({
      instanceId: z.string(),
    }))
    .output(z.object({ healthy: z.boolean() })),

  // Domain management
  createDomainConfig: oc
    .route({
      method: 'POST',
      path: '/traefik/instances/:instanceId/domains',
      summary: 'Create a domain configuration',
    })
    .input(z.object({
      instanceId: z.string(),
    }).merge(CreateDomainConfigSchema))
    .output(DomainConfigSchema),

  listDomainConfigs: oc
    .route({
      method: 'GET',
      path: '/traefik/instances/:instanceId/domains',
      summary: 'List domain configurations for an instance',
    })
    .input(z.object({
      instanceId: z.string(),
    }))
    .output(z.array(DomainConfigSchema)),

  // Route management
  createRouteConfig: oc
    .route({
      method: 'POST',
      path: '/traefik/domains/:domainConfigId/routes',
      summary: 'Create a route configuration',
    })
    .input(z.object({
      domainConfigId: z.string(),
    }).merge(CreateRouteConfigSchema))
    .output(RouteConfigSchema),

  listRouteConfigs: oc
    .route({
      method: 'GET',
      path: '/traefik/domains/:domainConfigId/routes',
      summary: 'List route configurations for a domain',
    })
    .input(z.object({
      domainConfigId: z.string(),
    }))
    .output(z.array(RouteConfigSchema)),

  deleteRouteConfig: oc
    .route({
      method: 'DELETE',
      path: '/traefik/routes/:routeConfigId',
      summary: 'Delete a route configuration',
    })
    .input(z.object({
      routeConfigId: z.string(),
    }))
    .output(z.void()),

  // Deployment registration
  registerDeployment: oc
    .route({
      method: 'POST',
      path: '/traefik/instances/:instanceId/deployments/register',
      summary: 'Register a deployment with Traefik',
    })
    .input(z.object({
      instanceId: z.string(),
    }).merge(RegisterDeploymentSchema))
    .output(DeploymentRegistrationResponseSchema),

  unregisterDeployment: oc
    .route({
      method: 'DELETE',
      path: '/traefik/deployments/:deploymentId',
      summary: 'Unregister a deployment from Traefik',
    })
    .input(z.object({
      deploymentId: z.string().min(1),
    }))
    .output(z.void()),
});

export type TraefikContract = typeof traefikContract;