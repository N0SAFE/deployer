import { z } from 'zod';

// ==========================================
// ENUMS
// ==========================================

export const verificationStatusSchema = z.enum(['pending', 'verified', 'failed']);
export const verificationMethodSchema = z.enum(['txt_record', 'cname_record']);
export const sslProviderSchema = z.enum(['letsencrypt', 'custom', 'none']);

// ==========================================
// ORGANIZATION DOMAIN SCHEMAS
// ==========================================

export const addOrganizationDomainSchema = z.object({
  organizationId: z.string().uuid(),
  domain: z.string().min(1).max(255).regex(
    /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i,
    'Invalid domain format'
  ),
  verificationMethod: verificationMethodSchema.default('txt_record'),
});

export const organizationDomainSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  domain: z.string(),
  verificationStatus: verificationStatusSchema,
  verificationMethod: verificationMethodSchema,
  verificationToken: z.string(),
  dnsRecordChecked: z.boolean(),
  lastVerificationAttempt: z.date().nullable(),
  verifiedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  metadata: z.object({
    registrar: z.string().optional(),
    expiresAt: z.date().optional(),
    autoRenew: z.boolean().optional(),
  }).catchall(z.any()).optional(),
});

export const verificationInstructionsSchema = z.object({
  method: verificationMethodSchema,
  recordName: z.string(),
  recordValue: z.string(),
  instructions: z.string(),
});

export const addDomainResponseSchema = z.object({
  organizationDomain: organizationDomainSchema,
  verificationInstructions: verificationInstructionsSchema,
});

export const verifyDomainResponseSchema = z.object({
  success: z.boolean(),
  status: verificationStatusSchema,
  message: z.string(),
  verifiedAt: z.date().optional(),
  error: z.object({
    code: z.string(),
    details: z.string(),
  }).optional(),
});

// ==========================================
// PROJECT DOMAIN SCHEMAS
// ==========================================

export const addProjectDomainSchema = z.object({
  projectId: z.string().uuid(),
  organizationDomainId: z.string().uuid(),
  allowedSubdomains: z.array(z.string().max(100)).default([]),
  isPrimary: z.boolean().default(false),
});

export const updateProjectDomainSchema = z.object({
  allowedSubdomains: z.array(z.string().max(100)).optional(),
  isPrimary: z.boolean().optional(),
});

export const projectDomainSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  organizationDomainId: z.string().uuid(),
  allowedSubdomains: z.array(z.string()),
  isPrimary: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  metadata: z.object({
    notes: z.string().optional(),
  }).catchall(z.any()).optional(),
});

export const projectDomainWithOrgDomainSchema = projectDomainSchema.extend({
  organizationDomain: organizationDomainSchema,
});

export const availableDomainSchema = z.object({
  id: z.string().uuid(),
  domain: z.string(),
  verificationStatus: z.literal('verified'),
  verifiedAt: z.date(),
  alreadySelected: z.boolean(),
});

// ==========================================
// SERVICE DOMAIN MAPPING SCHEMAS
// ==========================================

export const checkSubdomainAvailabilitySchema = z.object({
  projectDomainId: z.string().uuid(),
  subdomain: z.string().max(63).nullable(),
  basePath: z.string().max(255).nullable(),
  excludeServiceId: z.string().uuid().optional(),
});

export const serviceDomainConflictSchema = z.object({
  serviceId: z.string().uuid(),
  serviceName: z.string(),
  subdomain: z.string().nullable(),
  basePath: z.string().nullable(),
  fullUrl: z.string(),
});

export const subdomainAvailabilityResponseSchema = z.object({
  available: z.boolean(),
  conflicts: z.array(serviceDomainConflictSchema),
  suggestions: z.object({
    availableBasePaths: z.array(z.string()),
    message: z.string(),
  }),
});

export const addServiceDomainSchema = z.object({
  serviceId: z.string().uuid(),
  projectDomainId: z.string().uuid(),
  subdomain: z.string().max(63).nullable(),
  basePath: z.string().max(255).nullable(),
  isPrimary: z.boolean().default(false),
  sslEnabled: z.boolean().default(true),
  sslProvider: sslProviderSchema.default('letsencrypt'),
});

export const updateServiceDomainSchema = z.object({
  subdomain: z.string().max(63).nullable().optional(),
  basePath: z.string().max(255).nullable().optional(),
  isPrimary: z.boolean().optional(),
  sslEnabled: z.boolean().optional(),
  sslProvider: sslProviderSchema.optional(),
});

export const serviceDomainMappingSchema = z.object({
  id: z.string().uuid(),
  serviceId: z.string().uuid(),
  projectDomainId: z.string().uuid(),
  subdomain: z.string().nullable(),
  basePath: z.string().nullable(),
  isPrimary: z.boolean(),
  sslEnabled: z.boolean(),
  sslProvider: sslProviderSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  metadata: z.object({
    healthCheckPath: z.string().optional(),
  }).catchall(z.any()).optional(),
});

export const serviceDomainWithFullUrlSchema = serviceDomainMappingSchema.extend({
  fullUrl: z.string(),
  organizationDomain: z.object({
    id: z.string().uuid(),
    domain: z.string(),
    verificationStatus: z.literal('verified'),
  }),
});

export const addServiceDomainResponseSchema = z.object({
  mapping: serviceDomainWithFullUrlSchema,
  fullUrl: z.string(),
  warning: z.object({
    message: z.string(),
    sharedWith: z.array(z.object({
      serviceName: z.string(),
      fullUrl: z.string(),
    })),
  }).optional(),
});

export const projectDomainWithMappingsSchema = z.object({
  projectDomainId: z.string().uuid(),
  domain: z.string(),
  allowedSubdomains: z.array(z.string()),
  isPrimary: z.boolean(),
  existingMappings: z.array(z.object({
    serviceId: z.string().uuid(),
    serviceName: z.string(),
    subdomain: z.string().nullable(),
    basePath: z.string().nullable(),
    fullUrl: z.string(),
  })),
});

// ==========================================
// TYPE EXPORTS
// ==========================================

export type VerificationStatus = z.infer<typeof verificationStatusSchema>;
export type VerificationMethod = z.infer<typeof verificationMethodSchema>;
export type SslProvider = z.infer<typeof sslProviderSchema>;

export type AddOrganizationDomain = z.infer<typeof addOrganizationDomainSchema>;
export type OrganizationDomain = z.infer<typeof organizationDomainSchema>;
export type VerificationInstructions = z.infer<typeof verificationInstructionsSchema>;
export type AddDomainResponse = z.infer<typeof addDomainResponseSchema>;
export type VerifyDomainResponse = z.infer<typeof verifyDomainResponseSchema>;

export type AddProjectDomain = z.infer<typeof addProjectDomainSchema>;
export type UpdateProjectDomain = z.infer<typeof updateProjectDomainSchema>;
export type ProjectDomain = z.infer<typeof projectDomainSchema>;
export type ProjectDomainWithOrgDomain = z.infer<typeof projectDomainWithOrgDomainSchema>;
export type AvailableDomain = z.infer<typeof availableDomainSchema>;

export type CheckSubdomainAvailability = z.infer<typeof checkSubdomainAvailabilitySchema>;
export type ServiceDomainConflict = z.infer<typeof serviceDomainConflictSchema>;
export type SubdomainAvailabilityResponse = z.infer<typeof subdomainAvailabilityResponseSchema>;
export type AddServiceDomain = z.infer<typeof addServiceDomainSchema>;
export type UpdateServiceDomain = z.infer<typeof updateServiceDomainSchema>;
export type ServiceDomainMapping = z.infer<typeof serviceDomainMappingSchema>;
export type ServiceDomainWithFullUrl = z.infer<typeof serviceDomainWithFullUrlSchema>;
export type AddServiceDomainResponse = z.infer<typeof addServiceDomainResponseSchema>;
export type ProjectDomainWithMappings = z.infer<typeof projectDomainWithMappingsSchema>;
