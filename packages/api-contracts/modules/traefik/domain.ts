import { oc } from '@orpc/contract';
import { z } from 'zod';
import { 
  CreateDomainConfigSchema, 
  DomainConfigSchema,
  DNSCheckSchema,
  DNSCheckResultSchema
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

// DNS checking contracts
export const traefikCheckDNSContract = oc
  .route({
    method: 'POST',
    path: '/domains/dns-check',
    summary: 'Check DNS records for a domain',
  })
  .input(DNSCheckSchema)
  .output(DNSCheckResultSchema);

export const traefikValidateDomainDNSContract = oc
  .route({
    method: 'POST',
    path: '/domains/:domainConfigId/validate-dns',
    summary: 'Validate DNS records for a specific domain configuration',
  })
  .input(z.object({
    domainConfigId: z.string(),
  }))
  .output(DomainConfigSchema);