import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  checkSubdomainAvailabilitySchema,
  subdomainAvailabilityResponseSchema,
  addServiceDomainSchema,
  updateServiceDomainSchema,
  serviceDomainWithFullUrlSchema,
  addServiceDomainResponseSchema,
} from './schemas';

// Check subdomain availability
export const checkSubdomainAvailabilityContract = oc
  .route({
    path: '/check-subdomain',
    method: 'POST',
    summary: 'Check if a subdomain is available for a service',
  })
  .input(checkSubdomainAvailabilitySchema)
  .output(subdomainAvailabilityResponseSchema);

// List service domain mappings
export const listServiceDomainsInput = z.object({
  serviceId: z.string().uuid(),
});

export const listServiceDomainsContract = oc
  .route({
    path: '/:serviceId/domains',
    method: 'GET',
    summary: 'List all domain mappings for a service',
  })
  .input(listServiceDomainsInput)
  .output(z.array(serviceDomainWithFullUrlSchema));

// Add domain mapping to service
export const addServiceDomainContract = oc
  .route({
    path: '/:serviceId/domains',
    method: 'POST',
    summary: 'Add a domain mapping to service with conflict detection',
  })
  .input(addServiceDomainSchema)
  .output(addServiceDomainResponseSchema);

// Update service domain mapping
export const updateServiceDomainInput = z.object({
  serviceId: z.string().uuid(),
  mappingId: z.string().uuid(),
}).merge(updateServiceDomainSchema);

export const updateServiceDomainContract = oc
  .route({
    path: '/:serviceId/domains/:mappingId',
    method: 'PUT',
    summary: 'Update a service domain mapping',
  })
  .input(updateServiceDomainInput)
  .output(serviceDomainWithFullUrlSchema);

// Set primary domain
export const setPrimaryServiceDomainInput = z.object({
  serviceId: z.string().uuid(),
  mappingId: z.string().uuid(),
});

export const setPrimaryServiceDomainContract = oc
  .route({
    path: '/:serviceId/domains/:mappingId/primary',
    method: 'PUT',
    summary: 'Set a domain mapping as the primary domain for the service',
  })
  .input(setPrimaryServiceDomainInput)
  .output(serviceDomainWithFullUrlSchema);

// Remove domain mapping from service
export const removeServiceDomainInput = z.object({
  serviceId: z.string().uuid(),
  mappingId: z.string().uuid(),
});

export const removeServiceDomainOutput = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const removeServiceDomainContract = oc
  .route({
    path: '/:serviceId/domains/:mappingId',
    method: 'DELETE',
    summary: 'Remove a domain mapping from service',
  })
  .input(removeServiceDomainInput)
  .output(removeServiceDomainOutput);
