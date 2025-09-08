import { oc } from '@orpc/contract';
import { z } from 'zod';
import { 
  CreateTraefikInstanceSchema, 
  TraefikInstanceSchema,
  TraefikTemplateSchema 
} from './schemas';

// Instance management contracts
export const traefikCreateInstanceContract = oc
  .route({
    method: 'POST',
    path: '/instances',
    summary: 'Create a new Traefik instance',
  })
  .input(CreateTraefikInstanceSchema)
  .output(TraefikInstanceSchema);

export const traefikListInstancesContract = oc
  .route({
    method: 'GET',
    path: '/instances',
    summary: 'List all Traefik instances',
  })
  .input(z.object({}).optional())
  .output(z.array(TraefikInstanceSchema));

export const traefikGetInstanceContract = oc
  .route({
    method: 'GET',
    path: '/instances/:instanceId',
    summary: 'Get a specific Traefik instance',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(TraefikInstanceSchema);

export const traefikStartInstanceContract = oc
  .route({
    method: 'POST',
    path: '/instances/:instanceId/start',
    summary: 'Start a Traefik instance',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(TraefikInstanceSchema);

export const traefikStopInstanceContract = oc
  .route({
    method: 'POST',
    path: '/instances/:instanceId/stop',
    summary: 'Stop a Traefik instance',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(TraefikInstanceSchema);

export const traefikHealthCheckInstanceContract = oc
  .route({
    method: 'GET',
    path: '/instances/:instanceId/health',
    summary: 'Check health of a Traefik instance',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(z.object({ healthy: z.boolean() }));

// Template management contracts
export const traefikListTemplatesContract = oc
  .route({
    method: 'GET',
    path: '/templates',
    summary: 'List available Traefik configuration templates',
  })
  .input(z.object({
    category: z.enum(['basic', 'ssl', 'advanced', 'microservices']).optional(),
  }))
  .output(z.array(TraefikTemplateSchema));

export const traefikGetTemplateContract = oc
  .route({
    method: 'GET',
    path: '/templates/:templateId',
    summary: 'Get a specific Traefik template',
  })
  .input(z.object({
    templateId: z.string(),
  }))
  .output(TraefikTemplateSchema);

export const traefikCreateInstanceFromTemplateContract = oc
  .route({
    method: 'POST',
    path: '/instances/from-template',
    summary: 'Create a Traefik instance from a template',
  })
  .input(z.object({
    templateId: z.string(),
    name: z.string().min(1).max(255),
    customConfig: z.object({
      dashboardPort: z.number().min(1024).max(65535).optional(),
      httpPort: z.number().min(80).max(65535).optional(),
      httpsPort: z.number().min(443).max(65535).optional(),
      acmeEmail: z.string().email().optional(),
      logLevel: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
    }).optional(),
  }))
  .output(TraefikInstanceSchema);