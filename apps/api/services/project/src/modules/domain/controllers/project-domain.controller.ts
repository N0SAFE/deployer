import { Controller } from "@nestjs/common";
import { domainContract } from "@deployer/project-contracts";
import { EffectContextOf } from "@deployer/nest-effect";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";

import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";
import { actorFromContext } from "@project/core/utils/actor.utils";

import { DomainModule } from "../domain.module";
import { DomainProjectService } from "../services/domain-project.service";
import { mapDomainFailures } from "./domain.error-mapper";

/**
 * Project-domain procedures.
 *
 * Each method binds a contract procedure, takes the actor from the context and
 * delegates to `DomainProjectService` resolved from the module's Effect
 * context. Rules live in the service; this class only maps failures.
 */
@Controller()
export class ProjectDomainController {
	@Implement(domainContract.listProjectDomains)
	listProjectDomains() {
		return implement(domainContract.listProjectDomains)
			.use(requireAuth())
			.use(DomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const domains = yield* DomainProjectService;
				return yield* domains
					.listProjectDomains(input.params)
					.pipe(mapDomainFailures);
			});
	}

	@Implement(domainContract.getAvailableDomains)
	getAvailableDomains() {
		return implement(domainContract.getAvailableDomains)
			.use(requireAuth())
			.use(DomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const domains = yield* DomainProjectService;
				return yield* domains
					.getAvailableDomains(input.params)
					.pipe(mapDomainFailures);
			});
	}

	@Implement(domainContract.getAvailableDomainsForService)
	getAvailableDomainsForService() {
		return implement(domainContract.getAvailableDomainsForService)
			.use(requireAuth())
			.use(DomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const domains = yield* DomainProjectService;
				return yield* domains
					.getAvailableDomainsForService({
						...input.params,
						serviceId: undefined,
					})
					.pipe(mapDomainFailures);
			});
	}

	@Implement(domainContract.addProjectDomain)
	addProjectDomain() {
		return implement(domainContract.addProjectDomain)
			.use(requireAuth())
			.use(DomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const domains = yield* DomainProjectService;
				return yield* domains
					.addProjectDomain(
						{ ...input.params, ...input.body },
						actorFromContext(context).userId,
					)
					.pipe(mapDomainFailures);
			});
	}

	@Implement(domainContract.updateProjectDomain)
	updateProjectDomain() {
		return implement(domainContract.updateProjectDomain)
			.use(requireAuth())
			.use(DomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const domains = yield* DomainProjectService;
				return yield* domains
					.updateProjectDomain(
						{ ...input.params, ...input.body },
						actorFromContext(context).userId,
					)
					.pipe(mapDomainFailures);
			});
	}

	@Implement(domainContract.removeProjectDomain)
	removeProjectDomain() {
		return implement(domainContract.removeProjectDomain)
			.use(requireAuth())
			.use(DomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const domains = yield* DomainProjectService;
				return yield* domains
					.removeProjectDomain({
						...input.params,
						requesterId: actorFromContext(context).userId,
					})
					.pipe(mapDomainFailures);
			});
	}

	@Implement(domainContract.verifyProjectDomain)
	verifyProjectDomain() {
		return implement(domainContract.verifyProjectDomain)
			.use(requireAuth())
			.use(DomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const domains = yield* DomainProjectService;
				return yield* domains
					.verifyProjectDomain({
						...input.params,
						requesterId: actorFromContext(context).userId,
					})
					.pipe(mapDomainFailures);
			});
	}
}
