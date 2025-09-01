import { oc } from '@orpc/contract';
import { z } from 'zod';
import { 
  CreateTraefikInstanceSchema, 
  TraefikInstanceSchema 
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