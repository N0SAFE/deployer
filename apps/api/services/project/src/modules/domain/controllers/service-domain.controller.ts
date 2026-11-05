import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";

import { procedure } from "@deployer/nest-effect";
import { domainContract } from "@deployer/project-contracts";
import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { actorFromContext } from "@project/core/utils/actor.utils";

import { DomainServiceService } from "../services/domain-service.service";

/** Service-domain mapping procedures. Rules live in the service. */
@Controller()
export class ServiceDomainController {
	@Implement(domainContract.checkSubdomainAvailability)
	checkSubdomainAvailability() {
		return procedure(domainContract.checkSubdomainAvailability)
			.use(requireAuth())
			.effect(function* ({ input }) {
				const domains = yield* DomainServiceService;
				return yield* domains
					.checkSubdomainAvailability(input);
			});
	}

	@Implement(domainContract.listServiceDomains)
	listServiceDomains() {
		return procedure(domainContract.listServiceDomains)
			.use(requireAuth())
			.effect(function* ({ input }) {
				const domains = yield* DomainServiceService;
				return yield* domains
					.listServiceDomains(input.params);
			});
	}

	@Implement(domainContract.addServiceDomain)
	addServiceDomain() {
		return procedure(domainContract.addServiceDomain)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const domains = yield* DomainServiceService;
				return yield* domains
					.addServiceDomain(
						{ ...input.params, ...input.body },
						actorFromContext(context).userId,
					);
			});
	}

	@Implement(domainContract.updateServiceDomain)
	updateServiceDomain() {
		return procedure(domainContract.updateServiceDomain)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const domains = yield* DomainServiceService;
				return yield* domains
					.updateServiceDomain(
						{ ...input.params, ...input.body },
						actorFromContext(context).userId,
					);
			});
	}

	@Implement(domainContract.setPrimaryServiceDomain)
	setPrimaryServiceDomain() {
		return procedure(domainContract.setPrimaryServiceDomain)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const domains = yield* DomainServiceService;
				return yield* domains
					.setPrimaryServiceDomain({
						...input.params,
						requesterId: actorFromContext(context).userId,
					});
			});
	}

	@Implement(domainContract.removeServiceDomain)
	removeServiceDomain() {
		return procedure(domainContract.removeServiceDomain)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const domains = yield* DomainServiceService;
				return yield* domains
					.removeServiceDomain({
						...input.params,
						requesterId: actorFromContext(context).userId,
					});
			});
	}
}
