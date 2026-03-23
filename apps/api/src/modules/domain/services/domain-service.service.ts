import { Injectable } from "@nestjs/common";
import { DomainAdapter } from "@/core/modules/domain/adapters/domain.adapter";
import { DomainConflictService } from "@/core/modules/domain/services/domain-conflict.service";
import { ProjectAccessService } from "@/core/modules/project/services/project-access.service";
import {
    OrganizationDomainNotFoundError,
    ProjectDomainNotFoundError,
    ServiceDomainMappingDeletionError,
    ServiceDomainMappingNotFoundError,
    ServiceDomainMappingUpdateError,
    ServiceMappingMismatchError,
    SetPrimaryDomainError,
    SubdomainConflictError,
} from "@/core/modules/domain/errors";
import { OrganizationDomainRepository } from "@/core/modules/domain/repositories/organization-domain.repository";
import { ProjectDomainRepository } from "@/core/modules/domain/repositories/project-domain.repository";
import { ServiceDomainMappingRepository } from "@/core/modules/domain/repositories/service-domain-mapping.repository";

@Injectable()
export class DomainServiceService {
    constructor(
        private readonly serviceDomainMappingRepository: ServiceDomainMappingRepository,
        private readonly projectDomainRepository: ProjectDomainRepository,
        private readonly organizationDomainRepository: OrganizationDomainRepository,
        private readonly domainConflictService: DomainConflictService,
        private readonly projectAccessService: ProjectAccessService,
    ) {}

    private async assertProjectAccess(projectId: string, requesterId: string) {
        await this.projectAccessService.assertProjectAccess(
            projectId,
            requesterId,
            ["owner", "admin"],
            "You do not have permission to manage domains for this project",
        );
    }

    async checkSubdomainAvailability(input: {
        projectDomainId: string;
        subdomain: string | null;
        basePath: string | null;
        excludeServiceId?: string;
    }) {
        return this.domainConflictService.checkSubdomainAvailability(
            input.projectDomainId,
            input.subdomain,
            input.basePath,
            input.excludeServiceId,
        );
    }

    async listServiceDomains(input: { serviceId: string }) {
        const mappings = await this.serviceDomainMappingRepository.findByServiceIdWithUrls(input.serviceId);

        return Promise.all(
            mappings.map(async (mapping) => {
                const projectDomain = await this.projectDomainRepository.findById(mapping.projectDomainId);
                if (!projectDomain) {
                    throw new ProjectDomainNotFoundError(mapping.projectDomainId);
                }

                const organizationDomain = await this.organizationDomainRepository.findById(
                    projectDomain.organizationDomainId,
                );
                if (!organizationDomain) {
                    throw new OrganizationDomainNotFoundError(projectDomain.organizationDomainId);
                }

                return {
                    ...DomainAdapter.toServiceDomainMappingWithUrl(mapping, mapping.fullUrl),
                    organizationDomain: {
                        id: organizationDomain.id,
                        domain: organizationDomain.domain,
                        verificationStatus: organizationDomain.verificationStatus as "verified",
                    },
                };
            }),
        );
    }

    async addServiceDomain(
        input: {
            serviceId: string;
            projectDomainId: string;
            subdomain: string | null;
            basePath: string | null;
            isPrimary: boolean;
            sslEnabled: boolean;
            sslProvider: "letsencrypt" | "custom" | "none";
        },
        requesterId: string,
    ) {
        const projectDomain = await this.projectDomainRepository.findById(input.projectDomainId);
        if (!projectDomain) {
            throw new ProjectDomainNotFoundError(input.projectDomainId);
        }

        await this.assertProjectAccess(projectDomain.projectId, requesterId);

        const availability = await this.domainConflictService.checkSubdomainAvailability(
            input.projectDomainId,
            input.subdomain,
            input.basePath,
        );

        if (!availability.available) {
            const conflicts = availability.conflicts.map(
                (conflict) => `${conflict.subdomain ?? "root"}.domain${conflict.basePath ?? "/"} (${conflict.serviceName})`,
            );

            throw new SubdomainConflictError(
                input.subdomain,
                input.basePath,
                conflicts,
                availability.suggestions.availableBasePaths,
            );
        }

        const mapping = await this.serviceDomainMappingRepository.create({
            serviceId: input.serviceId,
            projectDomainId: input.projectDomainId,
            subdomain: input.subdomain,
            basePath: input.basePath,
            isPrimary: input.isPrimary,
            sslEnabled: input.sslEnabled,
            sslProvider: input.sslProvider,
        });

        const fullUrl = await this.serviceDomainMappingRepository.getFullUrl(mapping.id);
        if (!fullUrl) {
            throw new ServiceDomainMappingNotFoundError(mapping.id);
        }

        const organizationDomain = await this.organizationDomainRepository.findById(
            projectDomain.organizationDomainId,
        );
        if (!organizationDomain) {
            throw new OrganizationDomainNotFoundError(projectDomain.organizationDomainId);
        }

        const sharedMappings = await this.serviceDomainMappingRepository.findBySubdomain(
            input.projectDomainId,
            input.subdomain,
        );

        const warning =
            sharedMappings.length > 1
                ? {
                      message: `This subdomain is shared with ${String(sharedMappings.length - 1)} other service(s)`,
                      sharedWith: sharedMappings
                          .filter((shared) => shared.id !== mapping.id)
                          .slice(0, 5)
                          .map((shared) => ({
                              serviceName: shared.serviceId,
                              fullUrl,
                          })),
                  }
                : undefined;

        return {
            mapping: {
                ...DomainAdapter.toServiceDomainMappingWithUrl(mapping, fullUrl),
                organizationDomain: {
                    id: organizationDomain.id,
                    domain: organizationDomain.domain,
                    verificationStatus: organizationDomain.verificationStatus as "verified",
                },
            },
            fullUrl,
            warning,
        };
    }

    async updateServiceDomain(
        input: {
            mappingId: string;
            subdomain?: string | null;
            basePath?: string | null;
            isPrimary?: boolean;
            sslEnabled?: boolean;
            sslProvider?: "letsencrypt" | "custom" | "none";
        },
        requesterId: string,
    ) {
        const mapping = await this.serviceDomainMappingRepository.findById(input.mappingId);
        if (!mapping) {
            throw new ServiceDomainMappingNotFoundError(input.mappingId);
        }

        const projectDomain = await this.projectDomainRepository.findById(mapping.projectDomainId);
        if (!projectDomain) {
            throw new ProjectDomainNotFoundError(mapping.projectDomainId);
        }
        await this.assertProjectAccess(projectDomain.projectId, requesterId);

        if (input.subdomain !== undefined || input.basePath !== undefined) {
            const availability = await this.domainConflictService.checkSubdomainAvailability(
                mapping.projectDomainId,
                input.subdomain ?? mapping.subdomain,
                input.basePath ?? mapping.basePath,
            );

            if (!availability.available) {
                const conflicts = availability.conflicts.map(
                    (conflict) => `${conflict.subdomain ?? "root"}.domain${conflict.basePath ?? "/"} (${conflict.serviceName})`,
                );

                throw new SubdomainConflictError(
                    input.subdomain ?? mapping.subdomain,
                    input.basePath ?? mapping.basePath,
                    conflicts,
                    availability.suggestions.availableBasePaths,
                );
            }
        }

        const updated = await this.serviceDomainMappingRepository.update(input.mappingId, {
            ...(input.subdomain !== undefined ? { subdomain: input.subdomain } : {}),
            ...(input.basePath !== undefined ? { basePath: input.basePath } : {}),
            ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
            ...(input.sslEnabled !== undefined ? { sslEnabled: input.sslEnabled } : {}),
            ...(input.sslProvider !== undefined ? { sslProvider: input.sslProvider } : {}),
        });

        if (!updated) {
            throw new ServiceDomainMappingUpdateError(input.mappingId);
        }

        const fullUrl = await this.serviceDomainMappingRepository.getFullUrl(updated.id);
        if (!fullUrl) {
            throw new ServiceDomainMappingNotFoundError(updated.id);
        }

        const organizationDomain = await this.organizationDomainRepository.findById(
            projectDomain.organizationDomainId,
        );
        if (!organizationDomain) {
            throw new OrganizationDomainNotFoundError(projectDomain.organizationDomainId);
        }

        return {
            ...DomainAdapter.toServiceDomainMappingWithUrl(updated, fullUrl),
            organizationDomain: {
                id: organizationDomain.id,
                domain: organizationDomain.domain,
                verificationStatus: organizationDomain.verificationStatus as "verified",
            },
        };
    }

    async setPrimaryServiceDomain(input: { serviceId: string; mappingId: string; requesterId: string }) {
        const mapping = await this.serviceDomainMappingRepository.findById(input.mappingId);
        if (!mapping) {
            throw new ServiceDomainMappingNotFoundError(input.mappingId);
        }

        if (mapping.serviceId !== input.serviceId) {
            throw new ServiceMappingMismatchError(input.mappingId, input.serviceId);
        }

        const accessProjectDomain = await this.projectDomainRepository.findById(mapping.projectDomainId);
        if (!accessProjectDomain) {
            throw new ProjectDomainNotFoundError(mapping.projectDomainId);
        }
        await this.assertProjectAccess(accessProjectDomain.projectId, input.requesterId);

        const allMappings = await this.serviceDomainMappingRepository.findByServiceId(input.serviceId);
        await Promise.all(
            allMappings
                .filter((serviceMapping) => serviceMapping.id !== input.mappingId && serviceMapping.isPrimary)
                .map((serviceMapping) =>
                    this.serviceDomainMappingRepository.update(serviceMapping.id, { isPrimary: false }),
                ),
        );

        const updated = await this.serviceDomainMappingRepository.update(input.mappingId, { isPrimary: true });
        if (!updated) {
            throw new SetPrimaryDomainError(input.serviceId, input.mappingId);
        }

        const fullUrl = await this.serviceDomainMappingRepository.getFullUrl(updated.id);
        if (!fullUrl) {
            throw new ServiceDomainMappingNotFoundError(updated.id);
        }

        const projectDomain = await this.projectDomainRepository.findById(updated.projectDomainId);
        if (!projectDomain) {
            throw new ProjectDomainNotFoundError(updated.projectDomainId);
        }

        const organizationDomain = await this.organizationDomainRepository.findById(
            projectDomain.organizationDomainId,
        );
        if (!organizationDomain) {
            throw new OrganizationDomainNotFoundError(projectDomain.organizationDomainId);
        }

        return {
            ...DomainAdapter.toServiceDomainMappingWithUrl(updated, fullUrl),
            organizationDomain: {
                id: organizationDomain.id,
                domain: organizationDomain.domain,
                verificationStatus: organizationDomain.verificationStatus as "verified",
            },
        };
    }

    async removeServiceDomain(input: { serviceId: string; mappingId: string; requesterId: string }) {
        const mapping = await this.serviceDomainMappingRepository.findById(input.mappingId);
        if (!mapping) {
            throw new ServiceDomainMappingNotFoundError(input.mappingId);
        }

        if (mapping.serviceId !== input.serviceId) {
            throw new ServiceMappingMismatchError(input.mappingId, input.serviceId);
        }

        const projectDomain = await this.projectDomainRepository.findById(mapping.projectDomainId);
        if (!projectDomain) {
            throw new ProjectDomainNotFoundError(mapping.projectDomainId);
        }
        await this.assertProjectAccess(projectDomain.projectId, input.requesterId);

        const deleted = await this.serviceDomainMappingRepository.delete(input.mappingId);
        if (!deleted) {
            throw new ServiceDomainMappingDeletionError(input.mappingId);
        }

        return {
            success: true,
            message: "Domain mapping removed from service successfully",
        };
    }
}