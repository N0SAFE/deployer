import { Injectable } from "@nestjs/common";
import { DomainAdapter } from "@/core/modules/domain/adapters/domain.adapter";
import {
    DomainAlreadyExistsError,
    DomainDeletionError,
    OrganizationDomainNotFoundError,
} from "@/core/modules/domain/errors";
import { OrganizationDomainRepository } from "@/core/modules/domain/repositories/organization-domain.repository";
import { DomainVerificationService } from "@/core/modules/domain/services/domain-verification.service";

@Injectable()
export class DomainOrganizationService {
    constructor(
        private readonly organizationDomainRepository: OrganizationDomainRepository,
        private readonly domainVerificationService: DomainVerificationService,
    ) {}

    async addOrganizationDomain(input: {
        organizationId: string;
        domain: string;
        verificationMethod: "txt_record" | "cname_record";
    }) {
        const existing = await this.organizationDomainRepository.findByDomain(input.domain);
        if (existing) {
            throw new DomainAlreadyExistsError(input.domain);
        }

        const token = this.domainVerificationService.generateVerificationToken(input.domain);
        const instructions = this.domainVerificationService.getVerificationInstructions(
            input.domain,
            token,
            input.verificationMethod,
        );

        const domain = await this.organizationDomainRepository.create({
            organizationId: input.organizationId,
            domain: input.domain,
            verificationToken: token,
            verificationStatus: "pending",
            verificationMethod: input.verificationMethod,
        });

        return DomainAdapter.toAddDomainResponse(domain, instructions);
    }

    async listOrganizationDomains(input: {
        organizationId: string;
        verificationStatus?: "pending" | "verified" | "failed";
    }) {
        let domains = await this.organizationDomainRepository.findByOrganizationId(input.organizationId);
        if (input.verificationStatus) {
            domains = domains.filter((domain) => domain.verificationStatus === input.verificationStatus);
        }

        return domains.map((domain) => DomainAdapter.toOrganizationDomainContract(domain));
    }

    async getOrganizationDomain(input: { domainId: string }) {
        const domain = await this.organizationDomainRepository.findById(input.domainId);
        if (!domain) {
            throw new OrganizationDomainNotFoundError(input.domainId);
        }

        return DomainAdapter.toOrganizationDomainContract(domain);
    }

    async verifyOrganizationDomain(input: { domainId: string }) {
        const domain = await this.organizationDomainRepository.findById(input.domainId);
        if (!domain) {
            throw new OrganizationDomainNotFoundError(input.domainId);
        }

        const result = await this.domainVerificationService.verifyDomain(domain.id);

        if (result.success && result.status === "verified") {
            await this.organizationDomainRepository.updateVerificationStatus(
                domain.id,
                "verified",
                domain.verificationMethod,
                result.verifiedAt,
            );
        } else {
            await this.organizationDomainRepository.updateVerificationStatus(
                domain.id,
                "failed",
                domain.verificationMethod,
            );
        }

        return DomainAdapter.toVerifyDomainResponse(result);
    }

    async deleteOrganizationDomain(input: { domainId: string }) {
        const domain = await this.organizationDomainRepository.findById(input.domainId);
        if (!domain) {
            throw new OrganizationDomainNotFoundError(input.domainId);
        }

        const deleted = await this.organizationDomainRepository.delete(input.domainId);
        if (!deleted) {
            throw new DomainDeletionError(input.domainId);
        }

        return {
            success: true,
            message: `Domain ${domain.domain} deleted successfully`,
        };
    }
}