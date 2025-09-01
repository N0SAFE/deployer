import { oc } from '@orpc/contract';
import { z } from 'zod';
import { 
  CreateRouteConfigSchema, 
  RouteConfigSchema 
} from './schemas';

// Route management contracts
export const traefikCreateRouteConfigContract = oc
  .route({
    method: 'POST',
    path: '/domains/:domainConfigId/routes',
    summary: 'Create a route configuration',
  })
  .input(z.object({
    domainConfigId: z.string(),
  }).merge(CreateRouteConfigSchema))
  .output(RouteConfigSchema);

export const traefikListRouteConfigsContract = oc
  .route({
    method: 'GET',
    path: '/domains/:domainConfigId/routes',
    summary: 'List route configurations for a domain',
  })
  .input(z.object({
    domainConfigId: z.string(),
  }))
  .output(z.array(RouteConfigSchema));

export const traefikDeleteRouteConfigContract = oc
  .route({
    method: 'DELETE',
    path: '/routes/:routeConfigId',
    summary: 'Delete a route configuration',
  })
  .input(z.object({
    routeConfigId: z.string(),
  }))
  .output(z.void());