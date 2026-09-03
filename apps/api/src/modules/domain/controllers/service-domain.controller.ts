import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { DomainServiceService } from "../services/domain-service.service";

@Controller()
export class ServiceDomainController {
    constructor(private readonly domainServiceService: DomainServiceService) {}

    @Implement(appContract.domain.checkSubdomainAvailability)
    checkSubdomainAvailability() {
        return implement(appContract.domain.checkSubdomainAvailability)
            .use(requireAuth())
            .handler(({ input }) =>
                // Compact input (body-only) — `input` IS the payload.
                this.domainServiceService.checkSubdomainAvailability(input),
            );
    }

    @Implement(appContract.domain.listServiceDomains)
    listServiceDomains() {
        return implement(appContract.domain.listServiceDomains)
            .use(requireAuth())
            .handler(({ input }) => this.domainServiceService.listServiceDomains(input.params));
    }

    @Implement(appContract.domain.addServiceDomain)
    addServiceDomain() {
        return implement(appContract.domain.addServiceDomain)
            .use(requireAuth())
            .handler(({ input, context }) =>
                this.domainServiceService.addServiceDomain(
                    { ...input.params, ...input.body },
                    context.auth.user.id,
                ),
            );
    }

    @Implement(appContract.domain.updateServiceDomain)
    updateServiceDomain() {
        return implement(appContract.domain.updateServiceDomain)
            .use(requireAuth())
            .handler(({ input, context }) =>
                this.domainServiceService.updateServiceDomain(
                    { ...input.params, ...input.body },
                    context.auth.user.id,
                ),
            );
    }

    @Implement(appContract.domain.setPrimaryServiceDomain)
    setPrimaryServiceDomain() {
        return implement(appContract.domain.setPrimaryServiceDomain)
            .use(requireAuth())
            .handler(({ input, context }) =>
                this.domainServiceService.setPrimaryServiceDomain({
                    ...input.params,
                    requesterId: context.auth.user.id,
                }),
            );
    }

    @Implement(appContract.domain.removeServiceDomain)
    removeServiceDomain() {
        return implement(appContract.domain.removeServiceDomain)
            .use(requireAuth())
            .handler(({ input, context }) =>
                this.domainServiceService.removeServiceDomain({
                    ...input.params,
                    requesterId: context.auth.user.id,
                }),
            );
    }
}