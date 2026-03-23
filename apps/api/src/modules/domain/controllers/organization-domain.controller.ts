import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { DomainOrganizationService } from "../services/domain-organization.service";

@Controller()
export class OrganizationDomainController {
    constructor(private readonly domainOrganizationService: DomainOrganizationService) {}

    @Implement(appContract.domain.listOrganizationDomains)
    listOrganizationDomains() {
        return implement(appContract.domain.listOrganizationDomains)
            .use(requireAuth())
            .handler(({ input }) => this.domainOrganizationService.listOrganizationDomains(input));
    }

    @Implement(appContract.domain.addOrganizationDomain)
    addOrganizationDomain() {
        return implement(appContract.domain.addOrganizationDomain)
            .use(requireAuth())
            .handler(({ input }) => this.domainOrganizationService.addOrganizationDomain(input));
    }

    @Implement(appContract.domain.getOrganizationDomain)
    getOrganizationDomain() {
        return implement(appContract.domain.getOrganizationDomain)
            .use(requireAuth())
            .handler(({ input }) => this.domainOrganizationService.getOrganizationDomain(input));
    }

    @Implement(appContract.domain.verifyOrganizationDomain)
    verifyOrganizationDomain() {
        return implement(appContract.domain.verifyOrganizationDomain)
            .use(requireAuth())
            .handler(({ input }) => this.domainOrganizationService.verifyOrganizationDomain(input));
    }

    @Implement(appContract.domain.deleteOrganizationDomain)
    deleteOrganizationDomain() {
        return implement(appContract.domain.deleteOrganizationDomain)
            .use(requireAuth())
            .handler(({ input }) => this.domainOrganizationService.deleteOrganizationDomain(input));
    }
}