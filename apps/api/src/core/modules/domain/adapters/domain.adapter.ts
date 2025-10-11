import type { organizationDomains, projectDomains, serviceDomainMappings } from '@/config/drizzle/schema/domain';
import type { z } from 'zod';
import type {
  organizationDomainSchema,
  projectDomainSchema,
  serviceDomainMappingSchema,
  addDomainResponseSchema,
  verifyDomainResponseSchema,
  verificationInstructionsSchema,
} from '@repo/api-contracts/modules/domain/schemas';

type OrganizationDomain = typeof organizationDomains.$inferSelect;
type ProjectDomain = typeof projectDomains.$inferSelect;
type ServiceDomainMapping = typeof serviceDomainMappings.$inferSelect;

type OrganizationDomainContract = z.infer<typeof organizationDomainSchema>;
type ProjectDomainContract = z.infer<typeof projectDomainSchema>;
type ServiceDomainMappingContract = z.infer<typeof serviceDomainMappingSchema>;
type AddDomainResponse = z.infer<typeof addDomainResponseSchema>;
type VerifyDomainResponse = z.infer<typeof verifyDomainResponseSchema>;
type VerificationInstructions = z.infer<typeof verificationInstructionsSchema>;

export class DomainAdapter {
  /**
   * Adapt organization domain entity to contract schema
   */
  static toOrganizationDomainContract(entity: OrganizationDomain): OrganizationDomainContract {
    return {
      id: entity.id,
      organizationId: entity.organizationId,
      domain: entity.domain,
      verificationStatus: entity.verificationStatus,
      verificationMethod: entity.verificationMethod,
      verificationToken: entity.verificationToken,
      dnsRecordChecked: entity.dnsRecordChecked,
      lastVerificationAttempt: entity.lastVerificationAttempt,
      verifiedAt: entity.verifiedAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      metadata: entity.metadata || undefined,
    };
  }

  /**
   * Adapt organization domain with verification instructions
   */
  static toAddDomainResponse(
    entity: OrganizationDomain,
    instructions: VerificationInstructions
  ): AddDomainResponse {
    return {
      organizationDomain: DomainAdapter.toOrganizationDomainContract(entity),
      verificationInstructions: instructions,
    };
  }

  /**
   * Adapt verification result to contract schema
   */
  static toVerifyDomainResponse(result: {
    success: boolean;
    status: 'pending' | 'verified' | 'failed';
    message: string;
    verifiedAt?: Date;
    error?: {
      code: string;
      details: string;
    };
  }): VerifyDomainResponse {
    return {
      success: result.success,
      status: result.status,
      message: result.message,
      verifiedAt: result.verifiedAt,
      error: result.error,
    };
  }

  /**
   * Adapt project domain entity to contract schema
   */
  static toProjectDomainContract(entity: ProjectDomain): ProjectDomainContract {
    return {
      id: entity.id,
      projectId: entity.projectId,
      organizationDomainId: entity.organizationDomainId,
      allowedSubdomains: entity.allowedSubdomains,
      isPrimary: entity.isPrimary,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      metadata: entity.metadata || undefined,
    };
  }

  /**
   * Adapt available domains response
   */
  static toAvailableDomainsResponse(domains: {
    organizationDomainId: string;
    domain: string;
    organizationId: string;
  }[]): Array<{
    organizationDomainId: string;
    domain: string;
  }> {
    return domains.map(d => ({
      organizationDomainId: d.organizationDomainId,
      domain: d.domain,
    }));
  }

  /**
   * Adapt service domain mapping entity to contract schema
   */
  static toServiceDomainMappingContract(entity: ServiceDomainMapping): ServiceDomainMappingContract {
    return {
      id: entity.id,
      serviceId: entity.serviceId,
      projectDomainId: entity.projectDomainId,
      subdomain: entity.subdomain,
      basePath: entity.basePath,
      isPrimary: entity.isPrimary,
      sslEnabled: entity.sslEnabled,
      sslProvider: entity.sslProvider,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      metadata: entity.metadata || undefined,
    };
  }

  /**
   * Adapt service domain mapping with full URL
   */
  static toServiceDomainMappingWithUrl(
    entity: ServiceDomainMapping,
    fullUrl: string
  ): ServiceDomainMappingContract & { fullUrl: string } {
    return {
      ...DomainAdapter.toServiceDomainMappingContract(entity),
      fullUrl,
    };
  }

  /**
   * Adapt conflict check result
   */
  static toConflictCheckResult(result: {
    available: boolean;
    conflicts?: Array<{
      subdomain: string | null;
      basePath: string;
      serviceId: string;
    }>;
    suggestions?: Array<{
      subdomain: string | null;
      basePath: string;
    }>;
  }): {
    available: boolean;
    conflicts?: Array<{
      subdomain: string | null;
      basePath: string;
      serviceId: string;
    }>;
    suggestions?: Array<{
      subdomain: string | null;
      basePath: string;
    }>;
  } {
    return result;
  }
}
