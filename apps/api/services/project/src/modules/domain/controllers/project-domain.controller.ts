import { Controller } from "@nestjs/common";
import { domainContract } from "@deployer/project-contracts";
import { procedure } from "@deployer/nest-effect";
import { Implement } from "@orpc/nest";

import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";
import { serve } from "@project/core/orpc/serve";
import { actorFromContext } from "@project/core/utils/actor.utils";

import { DomainProjectService } from "../services/domain-project.service";

/**
 * Project-domain procedures.
 *
 * Each method binds a contract procedure, takes the actor from the context and
 * delegates to `DomainProjectService` resolved from the module's Effect
 * context. Rules live in the service; `serve` is the request boundary that maps failures.
 */
@Controller()
export class ProjectDomainController {
	@Implement(domainContract.listProjectDomains)
	listProjectDomains() {
		return procedure(domainContract.listProjectDomains)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const domains = yield* DomainProjectService;
				return yield* domains
					.listProjectDomains(input.params)
					.pipe(serve(context));
			});
	}

	@Implement(domainContract.getAvailableDomains)
	getAvailableDomains() {
		return procedure(domainContract.getAvailableDomains)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const domains = yield* DomainProjectService;
				return yield* domains
					.getAvailableDomains(input.params)
					.pipe(serve(context));
			});
	}

	@Implement(domainContract.getAvailableDomainsForService)
	getAvailableDomainsForService() {
		return procedure(domainContract.getAvailableDomainsForService)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const domains = yield* DomainProjectService;
				return yield* domains
					.getAvailableDomainsForService({
						...input.params,
						serviceId: undefined,
					})
					.pipe(serve(context));
			});
	}

	@Implement(domainContract.addProjectDomain)
	addProjectDomain() {
		return procedure(domainContract.addProjectDomain)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const domains = yield* DomainProjectService;
				return yield* domains
					.addProjectDomain(
						{ ...input.params, ...input.body },
						actorFromContext(context).userId,
					)
					.pipe(serve(context));
			});
	}

	@Implement(domainContract.updateProjectDomain)
	updateProjectDomain() {
		return procedure(domainContract.updateProjectDomain)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const domains = yield* DomainProjectService;
				return yield* domains
					.updateProjectDomain(
						{ ...input.params, ...input.body },
						actorFromContext(context).userId,
					)
					.pipe(serve(context));
			});
	}

	@Implement(domainContract.removeProjectDomain)
	removeProjectDomain() {
		return procedure(domainContract.removeProjectDomain)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const domains = yield* DomainProjectService;
				return yield* domains
					.removeProjectDomain({
						...input.params,
						requesterId: actorFromContext(context).userId,
					})
					.pipe(serve(context));
			});
	}

	@Implement(domainContract.verifyProjectDomain)
	verifyProjectDomain() {
		return procedure(domainContract.verifyProjectDomain)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const domains = yield* DomainProjectService;
				return yield* domains
					.verifyProjectDomain({
						...input.params,
						requesterId: actorFromContext(context).userId,
					})
					.pipe(serve(context));
			});
	}
}
