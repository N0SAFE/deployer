import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { domainContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { DomainServiceService } from "../services/domain-service.service";

@Controller()
export class ServiceDomainController {
    constructor(private readonly domainServiceService: DomainServiceService) {}

    @Implement(domainContract.checkSubdomainAvailability)
    checkSubdomainAvailability() {
        return implement(domainContract.checkSubdomainAvailability)
            .use(requireAuth())
            .handler(({ input }) =>
                // Compact input (body-only) — `input` IS the payload.
                this.domainServiceService.checkSubdomainAvailability(input),
            );
    }

    @Implement(domainContract.listServiceDomains)
    listServiceDomains() {
        return implement(domainContract.listServiceDomains)
            .use(requireAuth())
            .handler(({ input }) => this.domainServiceService.listServiceDomains(input.params));
    }

    @Implement(domainContract.addServiceDomain)
    addServiceDomain() {
        return implement(domainContract.addServiceDomain)
            .use(requireAuth())
            .handler(({ input, context }) =>
                this.domainServiceService.addServiceDomain(
                    { ...input.params, ...input.body },
                    context.auth.user.id,
                ),
            );
    }

    @Implement(domainContract.updateServiceDomain)
    updateServiceDomain() {
        return implement(domainContract.updateServiceDomain)
            .use(requireAuth())
            .handler(({ input, context }) =>
                this.domainServiceService.updateServiceDomain(
                    { ...input.params, ...input.body },
                    context.auth.user.id,
                ),
            );
    }

    @Implement(domainContract.setPrimaryServiceDomain)
    setPrimaryServiceDomain() {
        return implement(domainContract.setPrimaryServiceDomain)
            .use(requireAuth())
            .handler(({ input, context }) =>
                this.domainServiceService.setPrimaryServiceDomain({
                    ...input.params,
                    requesterId: context.auth.user.id,
                }),
            );
    }

    @Implement(domainContract.removeServiceDomain)
    removeServiceDomain() {
        return implement(domainContract.removeServiceDomain)
            .use(requireAuth())
            .handler(({ input, context }) =>
                this.domainServiceService.removeServiceDomain({
                    ...input.params,
                    requesterId: context.auth.user.id,
                }),
            );
    }
}