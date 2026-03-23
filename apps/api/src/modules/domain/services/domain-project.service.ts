import { Injectable } from "@nestjs/common";
import { DomainAdapter } from "@/core/modules/domain/adapters/domain.adapter";
import { ProjectAccessService } from "@/core/modules/project/services/project-access.service";
import {
    DomainNotVerifiedError,
    OrganizationDomainNotFoundError,
    ProjectDomainAlreadyExistsError,
    ProjectDomainDeletionError,
    ProjectDomainNotFoundError,
    ProjectDomainUpdateError,
} from "@/core/modules/domain/errors";
import { OrganizationDomainRepository } from "@/core/modules/domain/repositories/organization-domain.repository";
import { ProjectDomainRepository } from "@/core/modules/domain/repositories/project-domain.repository";
import { ServiceDomainMappingRepository } from "@/core/modules/domain/repositories/service-domain-mapping.repository";

@Injectable()
export class DomainProjectService {
    constructor(
        private readonly projectDomainRepository: ProjectDomainRepository,
        private readonly organizationDomainRepository: OrganizationDomainRepository,
        private readonly serviceDomainMappingRepository: ServiceDomainMappingRepository,
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

    async addProjectDomain(
        input: {
            projectId: string;
            organizationDomainId: string;
            allowedSubdomains: string[];
            isPrimary: boolean;
        },
        requesterId: string,
    ) {
        await this.assertProjectAccess(input.projectId, requesterId);

        const organizationDomain = await this.organizationDomainRepository.findById(input.organizationDomainId);
        if (!organizationDomain) {
            throw new OrganizationDomainNotFoundError(input.organizationDomainId);
        }

        if (organizationDomain.verificationStatus !== "verified") {
            throw new DomainNotVerifiedError(organizationDomain.domain);
        }

        const existing = await this.projectDomainRepository.findByProjectAndOrgDomain(
            input.projectId,
            input.organizationDomainId,
        );

        if (existing) {
            throw new ProjectDomainAlreadyExistsError(input.projectId, organizationDomain.domain);
        }

        const projectDomain = await this.projectDomainRepository.create({
            projectId: input.projectId,
            organizationDomainId: input.organizationDomainId,
            allowedSubdomains: input.allowedSubdomains,
            isPrimary: input.isPrimary,
        });

        return {
            projectDomain: {
                ...DomainAdapter.toProjectDomainContract(projectDomain),
                organizationDomain: DomainAdapter.toOrganizationDomainContract(organizationDomain),
            },
            suggestions: {
                commonSubdomains: ["api", "www", "app", "admin", "staging"],
                wildcardOption: "*",
            },
        };
    }

    async listProjectDomains(input: { projectId: string }) {
        const projectDomains = await this.projectDomainRepository.findByProjectId(input.projectId);

        return Promise.all(
            projectDomains.map(async (projectDomain) => {
                const organizationDomain = await this.organizationDomainRepository.findById(
                    projectDomain.organizationDomainId,
                );

                if (!organizationDomain) {
                    throw new OrganizationDomainNotFoundError(projectDomain.organizationDomainId);
                }

                return {
                    ...DomainAdapter.toProjectDomainContract(projectDomain),
                    organizationDomain: DomainAdapter.toOrganizationDomainContract(organizationDomain),
                };
            }),
        );
    }

    async getAvailableDomains(input: { projectId: string }) {
        const availableDomains = await this.projectDomainRepository.getAvailableDomainsForProject(input.projectId);

        const domainsWithDetails = await Promise.all(
            availableDomains.map(async (availableDomain) => {
                const organizationDomain = await this.organizationDomainRepository.findById(
                    availableDomain.organizationDomainId,
                );

                if (
                    organizationDomain?.verificationStatus !== "verified" ||
                    !organizationDomain.verifiedAt
                ) {
                    return null;
                }

                const alreadySelected = await this.projectDomainRepository.hasProjectDomainMapping(
                    input.projectId,
                    availableDomain.organizationDomainId,
                );

                return {
                    id: organizationDomain.id,
                    domain: organizationDomain.domain,
                    verificationStatus: "verified" as const,
                    verifiedAt: organizationDomain.verifiedAt,
                    alreadySelected,
                };
            }),
        );

        return domainsWithDetails.filter((domain): domain is NonNullable<typeof domain> => domain !== null);
    }

    async getAvailableDomainsForService(input: { projectId: string; serviceId?: string }) {
        const projectDomains = await this.projectDomainRepository.findByProjectId(input.projectId);

        return Promise.all(
            projectDomains.map(async (projectDomain) => {
                const mappings = await this.serviceDomainMappingRepository.findByProjectDomainId(projectDomain.id);

                const existingMappings = await Promise.all(
                    mappings
                        .filter((mapping) => !input.serviceId || mapping.serviceId !== input.serviceId)
                        .map(async (mapping) => ({
                            serviceId: mapping.serviceId,
                            serviceName: mapping.serviceId,
                            subdomain: mapping.subdomain,
                            basePath: mapping.basePath,
                            fullUrl: (await this.serviceDomainMappingRepository.getFullUrl(mapping.id)) ?? "",
                        })),
                );

                const organizationDomain = await this.organizationDomainRepository.findById(
                    projectDomain.organizationDomainId,
                );

                return {
                    projectDomainId: projectDomain.id,
                    domain: organizationDomain?.domain ?? "",
                    allowedSubdomains: projectDomain.allowedSubdomains,
                    isPrimary: projectDomain.isPrimary,
                    existingMappings,
                };
            }),
        );
    }

    async updateProjectDomain(
        input: {
            domainId: string;
            allowedSubdomains?: string[];
            isPrimary?: boolean;
        },
        requesterId: string,
    ) {
        const projectDomain = await this.projectDomainRepository.findById(input.domainId);
        if (!projectDomain) {
            throw new ProjectDomainNotFoundError(input.domainId);
        }

        await this.assertProjectAccess(projectDomain.projectId, requesterId);

        const updated = await this.projectDomainRepository.update(input.domainId, {
            ...(input.allowedSubdomains !== undefined ? { allowedSubdomains: input.allowedSubdomains } : {}),
            ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
        });

        if (!updated) {
            throw new ProjectDomainUpdateError(input.domainId);
        }

        const organizationDomain = await this.organizationDomainRepository.findById(updated.organizationDomainId);
        if (!organizationDomain) {
            throw new OrganizationDomainNotFoundError(updated.organizationDomainId);
        }

        return {
            ...DomainAdapter.toProjectDomainContract(updated),
            organizationDomain: DomainAdapter.toOrganizationDomainContract(organizationDomain),
        };
    }

    async removeProjectDomain(input: { domainId: string; requesterId: string }) {
        const projectDomain = await this.projectDomainRepository.findById(input.domainId);
        if (!projectDomain) {
            throw new ProjectDomainNotFoundError(input.domainId);
        }

        await this.assertProjectAccess(projectDomain.projectId, input.requesterId);
        const affectedServices = await this.serviceDomainMappingRepository.countByProjectDomainId(input.domainId);
        const deleted = await this.projectDomainRepository.delete(input.domainId);

        if (!deleted) {
            throw new ProjectDomainDeletionError(input.domainId);
        }

        return {
            success: true,
            message: "Domain removed from project successfully",
            affectedServices,
        };
    }
}