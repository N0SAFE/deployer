import type { projectDomains, serviceDomainMappings } from '@/config/drizzle/global/schema/domain';
import type { z } from 'zod';
import type {
  projectDomainSchema,
  serviceDomainMappingSchema,
  addDomainResponseSchema,
  verifyDomainResponseSchema,
  verificationInstructionsSchema,
} from '@repo/api-contracts';

type ProjectDomain = typeof projectDomains.$inferSelect;
type ServiceDomainMapping = typeof serviceDomainMappings.$inferSelect;

type ProjectDomainContract = z.infer<typeof projectDomainSchema>;
type ServiceDomainMappingContract = z.infer<typeof serviceDomainMappingSchema>;
type AddDomainResponse = z.infer<typeof addDomainResponseSchema>;
type VerifyDomainResponse = z.infer<typeof verifyDomainResponseSchema>;
type VerificationInstructions = z.infer<typeof verificationInstructionsSchema>;

export class DomainAdapter {
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
      domain: entity.domain,
      verificationStatus: entity.verificationStatus,
      verificationMethod: entity.verificationMethod,
      verificationToken: entity.verificationToken,
      dnsRecordChecked: entity.dnsRecordChecked,
      lastVerificationAttempt: entity.lastVerificationAttempt,
      verifiedAt: entity.verifiedAt,
      allowedSubdomains: entity.allowedSubdomains,
      isPrimary: entity.isPrimary,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      metadata: entity.metadata ?? undefined,
    };
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
      metadata: entity.metadata ?? undefined,
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
    conflicts?: {
      subdomain: string | null;
      basePath: string;
      serviceId: string;
    }[];
    suggestions?: {
      subdomain: string | null;
      basePath: string;
    }[];
  }): {
    available: boolean;
    conflicts?: {
      subdomain: string | null;
      basePath: string;
      serviceId: string;
    }[];
    suggestions?: {
      subdomain: string | null;
      basePath: string;
    }[];
  } {
    return result;
  }
}
