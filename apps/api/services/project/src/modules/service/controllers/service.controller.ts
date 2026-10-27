import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { serviceContract, servicePreviewTopologyContract } from "@deployer/project-contracts";
import { EffectContextOf } from "@deployer/nest-effect";
import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";
import { actorFromContext } from "@project/core/utils/actor.utils";

import { ServiceDomainModule } from "../service.module";
import { ServiceNetworkService } from "../services/service-network.service";
import { ServiceService } from "../services/service.service";
import { mapServiceFailures } from "./service.error-mapper";

/**
 * The service domain's oRPC surface.
 *
 * Every method binds a contract procedure, takes the actor from the context and
 * delegates to a service resolved from the module's Effect context. Rules live
 * in the service; this class only maps failures.
 */
@Controller()
export class ServiceController {
	// ========================================
	// CORE CRUD
	// ========================================

	@Implement(serviceContract.crud.list)
	list() {
		return implement(serviceContract.crud.list)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const services = yield* ServiceService;
				return yield* services.listServices(input.query).pipe(mapServiceFailures);
			});
	}

	@Implement(serviceContract.crud.findById)
	findById() {
		return implement(serviceContract.crud.findById)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const services = yield* ServiceService;
				return yield* services.getServiceById(input.params.id).pipe(mapServiceFailures);
			});
	}

	@Implement(serviceContract.crud.create)
	create() {
		return implement(serviceContract.crud.create)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				const service = yield* services
					.createService(input, actorFromContext(context).userId)
					.pipe(mapServiceFailures);
				return { status: 201 as const, headers: {}, body: service };
			});
	}

	@Implement(serviceContract.crud.update)
	update() {
		return implement(serviceContract.crud.update)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				const { id, ...data } = input;
				return yield* services
					.updateService(id, data, actorFromContext(context).userId)
					.pipe(mapServiceFailures);
			});
	}

	@Implement(serviceContract.crud.delete)
	delete() {
		return implement(serviceContract.crud.delete)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				yield* services
					.deleteService(input.params.id, actorFromContext(context).userId)
					.pipe(mapServiceFailures);
				return { success: true };
			});
	}

	@Implement(serviceContract.crud.children)
	children() {
		return implement(serviceContract.crud.children)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				return yield* services
					.listChildren(input.params.id, actorFromContext(context).userId)
					.pipe(mapServiceFailures);
			});
	}

	@Implement(serviceContract.crud.subtree)
	subtree() {
		return implement(serviceContract.crud.subtree)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				return yield* services
					.getSubtree(input.params.id, actorFromContext(context).userId)
					.pipe(mapServiceFailures);
			});
	}

	// ========================================
	// LIFECYCLE
	// ========================================

	@Implement(serviceContract.lifecycle.toggleActive)
	toggleActive() {
		return implement(serviceContract.lifecycle.toggleActive)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				return yield* services
					.toggleActive(input.params.id, input.body.isActive, actorFromContext(context).userId)
					.pipe(mapServiceFailures);
			});
	}

	// ========================================
	// DEPENDENCIES
	// ========================================

	@Implement(serviceContract.dependencies.list)
	getDependencies() {
		return implement(serviceContract.dependencies.list)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const services = yield* ServiceService;
				return yield* services.getDependencies(input.params.id).pipe(mapServiceFailures);
			});
	}

	@Implement(serviceContract.dependencies.add)
	addDependency() {
		return implement(serviceContract.dependencies.add)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				return yield* services
					.addDependency(
						input.params.id,
						input.body.dependsOnServiceId,
						input.body.isRequired,
						actorFromContext(context).userId,
					)
					.pipe(mapServiceFailures);
			});
	}

	@Implement(serviceContract.dependencies.remove)
	removeDependency() {
		return implement(serviceContract.dependencies.remove)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				yield* services
					.removeDependency(
						input.params.id,
						input.params.dependencyId,
						actorFromContext(context).userId,
					)
					.pipe(mapServiceFailures);
				return { success: true };
			});
	}

	// ========================================
	// STREAMS
	// ========================================

	@Implement(serviceContract.streams.query)
	streamQuery() {
		return implement(serviceContract.streams.query)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const services = yield* ServiceService;
				return yield* services.streamQueryEvents(input.query).pipe(mapServiceFailures);
			});
	}

	// ========================================
	// PREVIEW TOPOLOGY
	// ========================================

	@Implement(servicePreviewTopologyContract.resolve)
	previewTopologyResolve() {
		return implement(servicePreviewTopologyContract.resolve)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				return yield* services
					.resolvePreviewTopology(
						input.params.serviceId,
						actorFromContext(context).userId,
						input.body,
					)
					.pipe(mapServiceFailures);
			});
	}

	// ========================================
	// NETWORK CONFIGURATION (DNS provider + zone + records)
	// ========================================

	@Implement(serviceContract.network.get)
	networkGet() {
		return implement(serviceContract.network.get)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const network = yield* ServiceNetworkService;
				return yield* network.getNetwork(input.params.id).pipe(mapServiceFailures);
			});
	}

	@Implement(serviceContract.network.update)
	networkUpdate() {
		return implement(serviceContract.network.update)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const network = yield* ServiceNetworkService;
				// Optional update body — coalesce to {}.
				return yield* network
					.updateNetwork(input.params.id, input.body ?? {})
					.pipe(mapServiceFailures);
			});
	}

	@Implement(serviceContract.network.provisionRecord)
	networkProvisionRecord() {
		return implement(serviceContract.network.provisionRecord)
			.use(requireAuth())
			.use(ServiceDomainModule[EffectContextOf])
			.effect(function* ({ input }) {
				const network = yield* ServiceNetworkService;
				return yield* network
					.provisionDnsRecord(input.params.id, input.body)
					.pipe(mapServiceFailures);
			});
	}
}
