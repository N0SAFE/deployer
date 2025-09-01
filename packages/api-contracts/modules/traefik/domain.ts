import { oc } from '@orpc/contract';
import { z } from 'zod';
import { 
  CreateDomainConfigSchema, 
  DomainConfigSchema 
} from './schemas';

// Domain management contracts
export const traefikCreateDomainConfigContract = oc
  .route({
    method: 'POST',
    path: '/instances/:instanceId/domains',
    summary: 'Create a domain configuration',
  })
  .input(z.object({
    instanceId: z.string(),
  }).merge(CreateDomainConfigSchema))
  .output(DomainConfigSchema);

export const traefikListDomainConfigsContract = oc
  .route({
    method: 'GET',
    path: '/instances/:instanceId/domains',
    summary: 'List domain configurations for an instance',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(z.array(DomainConfigSchema));