import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { domainContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { DomainProjectService } from "../services/domain-project.service";

@Controller()
export class ProjectDomainController {
    constructor(private readonly domainProjectService: DomainProjectService) {}

    @Implement(domainContract.listProjectDomains)
    listProjectDomains() {
        return implement(domainContract.listProjectDomains)
            .use(requireAuth())
            .handler(({ input }) => this.domainProjectService.listProjectDomains(input.params));
    }

    @Implement(domainContract.getAvailableDomains)
    getAvailableDomains() {
        return implement(domainContract.getAvailableDomains)
            .use(requireAuth())
            .handler(({ input }) =>
                this.domainProjectService.getAvailableDomains(input.params),
            );
    }

    @Implement(domainContract.getAvailableDomainsForService)
    getAvailableDomainsForService() {
        return implement(domainContract.getAvailableDomainsForService)
            .use(requireAuth())
            .handler(({ input }) =>
                this.domainProjectService.getAvailableDomainsForService({
                    ...input.params,
                    serviceId: undefined,
                }),
            );
    }

    @Implement(domainContract.addProjectDomain)
    addProjectDomain() {
        return implement(domainContract.addProjectDomain)
            .use(requireAuth())
            .handler(({ input, context }) =>
                this.domainProjectService.addProjectDomain({ ...input.params, ...input.body }, context.auth.user.id),
            );
    }

    @Implement(domainContract.updateProjectDomain)
    updateProjectDomain() {
        return implement(domainContract.updateProjectDomain)
            .use(requireAuth())
            .handler(({ input, context }) =>
                this.domainProjectService.updateProjectDomain({ ...input.params, ...input.body }, context.auth.user.id),
            );
    }

    @Implement(domainContract.removeProjectDomain)
    removeProjectDomain() {
        return implement(domainContract.removeProjectDomain)
            .use(requireAuth())
            .handler(({ input, context }) =>
                this.domainProjectService.removeProjectDomain({
                    ...input.params,
                    requesterId: context.auth.user.id,
                }),
            );
    }

    @Implement(domainContract.verifyProjectDomain)
    verifyProjectDomain() {
        return implement(domainContract.verifyProjectDomain)
            .use(requireAuth())
            .handler(({ input }) =>
                this.domainProjectService.verifyProjectDomain(input.params),
            );
    }
}