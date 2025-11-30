import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  addProjectDomainSchema,
  updateProjectDomainSchema,
  projectDomainSchema,
  projectDomainWithOrgDomainSchema,
  availableDomainSchema,
  projectDomainWithMappingsSchema,
} from './schemas';

// List project domains
export const listProjectDomainsInput = z.object({
  projectId: z.string().uuid(),
});

export const listProjectDomainsContract = oc
  .route({
    path: '/:projectId/domains',
    method: 'GET',
    summary: 'List all domains configured for a project',
  })
  .input(listProjectDomainsInput)
  .output(z.array(projectDomainWithOrgDomainSchema));

// Get available domains for project
export const getAvailableDomainsInput = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
});

export const getAvailableDomainsContract = oc
  .route({
    path: '/:organizationId/domains/available',
    method: 'GET',
    summary: 'Get all verified organization domains available for project selection',
  })
  .input(getAvailableDomainsInput)
  .output(z.array(availableDomainSchema));

// Get available domains for service mapping
export const getAvailableDomainsForServiceInput = z.object({
  projectId: z.string().uuid(),
  serviceId: z.string().uuid().optional(),
});

export const getAvailableDomainsForServiceContract = oc
  .route({
    path: '/:projectId/domains/available',
    method: 'GET',
    summary: 'Get all project domains with existing service mappings for conflict detection',
  })
  .input(getAvailableDomainsForServiceInput)
  .output(z.array(projectDomainWithMappingsSchema));

// Add domain to project
export const addProjectDomainOutput = z.object({
  projectDomain: projectDomainWithOrgDomainSchema,
  suggestions: z.object({
    commonSubdomains: z.array(z.string()),
    wildcardOption: z.string(),
  }),
});

export const addProjectDomainContract = oc
  .route({
    path: '/:projectId/domains',
    method: 'POST',
    summary: 'Add a verified organization domain to project with subdomain configuration',
  })
  .input(addProjectDomainSchema)
  .output(addProjectDomainOutput);

// Update project domain
export const updateProjectDomainInput = z.object({
  projectId: z.string().uuid(),
  domainId: z.string().uuid(),
}).merge(updateProjectDomainSchema);

export const updateProjectDomainContract = oc
  .route({
    path: '/:projectId/domains/:domainId',
    method: 'PUT',
    summary: 'Update project domain configuration (allowed subdomains, primary status)',
  })
  .input(updateProjectDomainInput)
  .output(projectDomainWithOrgDomainSchema);

// Remove domain from project
export const removeProjectDomainInput = z.object({
  projectId: z.string().uuid(),
  domainId: z.string().uuid(),
});

export const removeProjectDomainOutput = z.object({
  success: z.boolean(),
  message: z.string(),
  affectedServices: z.number(),
});

export const removeProjectDomainContract = oc
  .route({
    path: '/:projectId/domains/:domainId',
    method: 'DELETE',
    summary: 'Remove a domain from project (will cascade delete service mappings)',
  })
  .input(removeProjectDomainInput)
  .output(removeProjectDomainOutput);
