import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { DomainProjectService } from "../services/domain-project.service";

@Controller()
export class ProjectDomainController {
    constructor(private readonly domainProjectService: DomainProjectService) {}

    @Implement(appContract.domain.listProjectDomains)
    listProjectDomains() {
        return implement(appContract.domain.listProjectDomains)
            .use(requireAuth())
            .handler(({ input }) => this.domainProjectService.listProjectDomains(input));
    }

    @Implement(appContract.domain.getAvailableDomains)
    getAvailableDomains() {
        return implement(appContract.domain.getAvailableDomains)
            .use(requireAuth())
            .handler(({ input }) => this.domainProjectService.getAvailableDomains(input));
    }

    @Implement(appContract.domain.getAvailableDomainsForService)
    getAvailableDomainsForService() {
        return implement(appContract.domain.getAvailableDomainsForService)
            .use(requireAuth())
            .handler(({ input }) => this.domainProjectService.getAvailableDomainsForService(input));
    }

    @Implement(appContract.domain.addProjectDomain)
    addProjectDomain() {
        return implement(appContract.domain.addProjectDomain)
            .use(requireAuth())
            .handler(({ input, context }) =>
                this.domainProjectService.addProjectDomain(input, context.auth.user.id),
            );
    }

    @Implement(appContract.domain.updateProjectDomain)
    updateProjectDomain() {
        return implement(appContract.domain.updateProjectDomain)
            .use(requireAuth())
            .handler(({ input, context }) =>
                this.domainProjectService.updateProjectDomain(input, context.auth.user.id),
            );
    }

    @Implement(appContract.domain.removeProjectDomain)
    removeProjectDomain() {
        return implement(appContract.domain.removeProjectDomain)
            .use(requireAuth())
            .handler(({ input, context }) =>
                this.domainProjectService.removeProjectDomain(
                    { ...input, requesterId: context.auth.user.id },
                ),
            );
    }
}