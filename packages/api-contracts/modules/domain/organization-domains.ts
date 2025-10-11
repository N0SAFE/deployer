import { oc } from '@orpc/contract';
import { z } from 'zod';
import { 
  addOrganizationDomainSchema,
  organizationDomainSchema,
  addDomainResponseSchema,
  verifyDomainResponseSchema,
  verificationStatusSchema,
} from './schemas';

// List organization domains
export const listOrganizationDomainsInput = z.object({
  organizationId: z.string().uuid(),
  verificationStatus: verificationStatusSchema.optional(),
});

export const listOrganizationDomainsContract = oc
  .route({
    path: '/:organizationId/domains',
    method: 'GET',
    summary: 'List all domains for an organization',
  })
  .input(listOrganizationDomainsInput)
  .output(z.array(organizationDomainSchema));

// Add domain to organization
export const addOrganizationDomainContract = oc
  .route({
    path: '/:organizationId/domains',
    method: 'POST',
    summary: 'Add a new domain to organization and get verification instructions',
  })
  .input(addOrganizationDomainSchema)
  .output(addDomainResponseSchema);

// Get domain details
export const getOrganizationDomainInput = z.object({
  organizationId: z.string().uuid(),
  domainId: z.string().uuid(),
});

export const getOrganizationDomainContract = oc
  .route({
    path: '/:organizationId/domains/:domainId',
    method: 'GET',
    summary: 'Get details of a specific domain',
  })
  .input(getOrganizationDomainInput)
  .output(organizationDomainSchema);

// Verify domain
export const verifyOrganizationDomainInput = z.object({
  organizationId: z.string().uuid(),
  domainId: z.string().uuid(),
});

export const verifyOrganizationDomainContract = oc
  .route({
    path: '/:organizationId/domains/:domainId/verify',
    method: 'POST',
    summary: 'Manually trigger domain verification',
  })
  .input(verifyOrganizationDomainInput)
  .output(verifyDomainResponseSchema);

// Delete domain
export const deleteOrganizationDomainInput = z.object({
  organizationId: z.string().uuid(),
  domainId: z.string().uuid(),
});

export const deleteOrganizationDomainOutput = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const deleteOrganizationDomainContract = oc
  .route({
    path: '/:organizationId/domains/:domainId',
    method: 'DELETE',
    summary: 'Remove a domain from organization',
  })
  .input(deleteOrganizationDomainInput)
  .output(deleteOrganizationDomainOutput);
