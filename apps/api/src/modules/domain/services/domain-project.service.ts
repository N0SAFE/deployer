import { Injectable } from "@nestjs/common";
import { DomainAdapter } from "@/core/modules/domain/adapters/domain.adapter";
import { ProjectAccessService } from "@/core/modules/project/services/project-access.service";
import { DomainVerificationService } from "@/core/modules/domain/services/domain-verification.service";
import {
    DomainAlreadyExistsError,
    DomainNotVerifiedError,
    ProjectDomainDeletionError,
    ProjectDomainNotFoundError,
    ProjectDomainUpdateError,
} from "@/core/modules/domain/errors";
import { ProjectDomainRepository } from "@/core/modules/domain/repositories/project-domain.repository";
import { ServiceDomainMappingRepository } from "@/core/modules/domain/repositories/service-domain-mapping.repository";

@Injectable()
export class DomainProjectService {
    constructor(
        private readonly projectDomainRepository: ProjectDomainRepository,
        private readonly serviceDomainMappingRepository: ServiceDomainMappingRepository,
        private readonly projectAccessService: ProjectAccessService,
        private readonly domainVerificationService: DomainVerificationService,
    ) {}

    private async assertProjectAccess(projectId: string, requesterId: string) {
        await this.projectAccessService.assertProjectAccess(
            projectId,
            requesterId,
            ["owner", "maintainer"],
            "You do not have permission to manage domains for this project",
        );
    }

    async addProjectDomain(
        input: {
            projectId: string;
            domain: string;
            verificationMethod: "txt_record" | "cname_record";
            allowedSubdomains: string[];
            isPrimary: boolean;
        },
        requesterId: string,
    ) {
        await this.assertProjectAccess(input.projectId, requesterId);

        const existing = await this.projectDomainRepository.findByProjectAndDomain(
            input.projectId,
            input.domain,
        );
        if (existing) {
            throw new DomainAlreadyExistsError(input.projectId, input.domain);
        }

        const verificationToken = crypto.randomUUID().replace(/-/g, "");
        const projectDomain = await this.projectDomainRepository.create({
            projectId: input.projectId,
            domain: input.domain,
            verificationMethod: input.verificationMethod,
            verificationToken,
            dnsRecordChecked: false,
            verificationStatus: "pending",
            allowedSubdomains: input.allowedSubdomains,
            isPrimary: input.isPrimary,
        });

        const recordName =
            input.verificationMethod === "cname_record"
                ? `_deployer.${input.domain}`
                : "_deployer-challenge";
        const recordValue =
            input.verificationMethod === "cname_record"
                ? `verify.deployer.${verificationToken}.acme.`
                : `deployer-verification=${verificationToken}`;

        const projectDomainContract = DomainAdapter.toProjectDomainContract(projectDomain);
        const verificationInstructions = {
            method: input.verificationMethod,
            recordName,
            recordValue,
            instructions: `Create a ${input.verificationMethod.toUpperCase()} record: name "${recordName}" -> value "${recordValue}", then verify.`,
        };

        // addDomainResponse contract: projectDomain carries verificationInstructions
        return {
            projectDomain: {
                ...projectDomainContract,
                verificationInstructions,
            },
            verificationInstructions,
            suggestions: {
                commonSubdomains: ["api", "www", "app", "admin", "staging"],
                wildcardOption: "*",
            },
        };
    }

    async listProjectDomains(input: { projectId: string }) {
        const projectDomains = await this.projectDomainRepository.findByProjectId(input.projectId);
        return projectDomains.map(DomainAdapter.toProjectDomainContract);
    }

    async getAvailableDomains(input: { projectId: string }) {
        const availableDomains = await this.projectDomainRepository.getAvailableDomainsForProject(input.projectId);

        return Promise.all(
            availableDomains.map(async (availableDomain) => {
                const alreadySelected = await this.serviceDomainMappingRepository.hasProjectDomainMappings(availableDomain.id);
                return {
                    id: availableDomain.id,
                    domain: availableDomain.domain,
                    verificationStatus: "verified" as const,
                    verifiedAt: availableDomain.verifiedAt,
                    alreadySelected,
                };
            }),
        );
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

                return {
                    projectDomainId: projectDomain.id,
                    domain: projectDomain.domain,
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

        return DomainAdapter.toProjectDomainContract(updated);
    }

    async verifyProjectDomain(input: { projectId: string; domainId: string }) {
        await this.assertProjectAccess(input.projectId, "verify");
        return this.domainVerificationService.verifyProjectDomain(input.projectId, input.domainId);
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