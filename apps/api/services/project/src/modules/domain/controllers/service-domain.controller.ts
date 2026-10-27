import { Controller } from "@nestjs/common";
import { domainContract } from "@deployer/project-contracts";
import { EffectContextOf } from "@deployer/nest-effect";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";

import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";
import { actorFromContext } from "@project/core/utils/actor.utils";

import { DomainModule } from "../domain.module";
import { DomainServiceService } from "../services/domain-service.service";
import { mapDomainFailures } from "./domain.error-mapper";

/** Service-domain mapping procedures. Rules live in the service. */
@Controller()
export class ServiceDomainController {
	@Implement(domainContract.checkSubdomainAvailability)
	checkSubdomainAvailability() {
		return implement(domainContract.checkSubdomainAvailability)
			.use(requireAuth())
			.use(DomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const domains = yield* DomainServiceService;
				return yield* domains
					.checkSubdomainAvailability(input)
					.pipe(mapDomainFailures);
			});
	}

	@Implement(domainContract.listServiceDomains)
	listServiceDomains() {
		return implement(domainContract.listServiceDomains)
			.use(requireAuth())
			.use(DomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const domains = yield* DomainServiceService;
				return yield* domains
					.listServiceDomains(input.params)
					.pipe(mapDomainFailures);
			});
	}

	@Implement(domainContract.addServiceDomain)
	addServiceDomain() {
		return implement(domainContract.addServiceDomain)
			.use(requireAuth())
			.use(DomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const domains = yield* DomainServiceService;
				return yield* domains
					.addServiceDomain(
						{ ...input.params, ...input.body },
						actorFromContext(context).userId,
					)
					.pipe(mapDomainFailures);
			});
	}

	@Implement(domainContract.updateServiceDomain)
	updateServiceDomain() {
		return implement(domainContract.updateServiceDomain)
			.use(requireAuth())
			.use(DomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const domains = yield* DomainServiceService;
				return yield* domains
					.updateServiceDomain(
						{ ...input.params, ...input.body },
						actorFromContext(context).userId,
					)
					.pipe(mapDomainFailures);
			});
	}

	@Implement(domainContract.setPrimaryServiceDomain)
	setPrimaryServiceDomain() {
		return implement(domainContract.setPrimaryServiceDomain)
			.use(requireAuth())
			.use(DomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const domains = yield* DomainServiceService;
				return yield* domains
					.setPrimaryServiceDomain({
						...input.params,
						requesterId: actorFromContext(context).userId,
					})
					.pipe(mapDomainFailures);
			});
	}

	@Implement(domainContract.removeServiceDomain)
	removeServiceDomain() {
		return implement(domainContract.removeServiceDomain)
			.use(requireAuth())
			.use(DomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const domains = yield* DomainServiceService;
				return yield* domains
					.removeServiceDomain({
						...input.params,
						requesterId: actorFromContext(context).userId,
					})
					.pipe(mapDomainFailures);
			});
	}
}
