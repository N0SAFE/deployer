import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";

import { procedure } from "@deployer/nest-effect";
import { serviceContract, servicePreviewTopologyContract } from "@deployer/project-contracts";
import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { actorFromContext } from "@project/core/utils/actor.utils";

import { ServiceNetworkService } from "../services/service-network.service";
import { ServiceService } from "../services/service.service";

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
		return procedure(serviceContract.crud.list)
			.use(requireAuth())
			.effect(function* ({ input }) {
				const services = yield* ServiceService;
				return yield* services.listServices(input.query);
			});
	}

	@Implement(serviceContract.crud.findById)
	findById() {
		return procedure(serviceContract.crud.findById)
			.use(requireAuth())
			.effect(function* ({ input }) {
				const services = yield* ServiceService;
				return yield* services.getServiceById(input.params.id);
			});
	}

	@Implement(serviceContract.crud.create)
	create() {
		return procedure(serviceContract.crud.create)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				const service = yield* services
					.createService(input, actorFromContext(context).userId);
				return { status: 201 as const, headers: {}, body: service };
			});
	}

	@Implement(serviceContract.crud.update)
	update() {
		return procedure(serviceContract.crud.update)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				const { id, ...data } = input;
				return yield* services
					.updateService(id, data, actorFromContext(context).userId);
			});
	}

	@Implement(serviceContract.crud.delete)
	delete() {
		return procedure(serviceContract.crud.delete)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				yield* services
					.deleteService(input.params.id, actorFromContext(context).userId);
				return { success: true };
			});
	}

	@Implement(serviceContract.crud.children)
	children() {
		return procedure(serviceContract.crud.children)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				return yield* services
					.listChildren(input.params.id, actorFromContext(context).userId);
			});
	}

	@Implement(serviceContract.crud.subtree)
	subtree() {
		return procedure(serviceContract.crud.subtree)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				return yield* services
					.getSubtree(input.params.id, actorFromContext(context).userId);
			});
	}

	// ========================================
	// LIFECYCLE
	// ========================================

	@Implement(serviceContract.lifecycle.toggleActive)
	toggleActive() {
		return procedure(serviceContract.lifecycle.toggleActive)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				return yield* services
					.toggleActive(input.params.id, input.body.isActive, actorFromContext(context).userId);
			});
	}

	// ========================================
	// DEPENDENCIES
	// ========================================

	@Implement(serviceContract.dependencies.list)
	getDependencies() {
		return procedure(serviceContract.dependencies.list)
			.use(requireAuth())
			.effect(function* ({ input }) {
				const services = yield* ServiceService;
				return yield* services.getDependencies(input.params.id);
			});
	}

	@Implement(serviceContract.dependencies.add)
	addDependency() {
		return procedure(serviceContract.dependencies.add)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				return yield* services
					.addDependency(
						input.params.id,
						input.body.dependsOnServiceId,
						input.body.isRequired,
						actorFromContext(context).userId,
					);
			});
	}

	@Implement(serviceContract.dependencies.remove)
	removeDependency() {
		return procedure(serviceContract.dependencies.remove)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				yield* services
					.removeDependency(
						input.params.id,
						input.params.dependencyId,
						actorFromContext(context).userId,
					);
				return { success: true };
			});
	}

	// ========================================
	// STREAMS
	// ========================================

	@Implement(serviceContract.streams.query)
	streamQuery() {
		return procedure(serviceContract.streams.query)
			.use(requireAuth())
			.effect(function* ({ input }) {
				const services = yield* ServiceService;
				return yield* services.streamQueryEvents(input.query);
			});
	}

	// ========================================
	// PREVIEW TOPOLOGY
	// ========================================

	@Implement(servicePreviewTopologyContract.resolve)
	previewTopologyResolve() {
		return procedure(servicePreviewTopologyContract.resolve)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const services = yield* ServiceService;
				return yield* services
					.resolvePreviewTopology(
						input.params.serviceId,
						actorFromContext(context).userId,
						input.body,
					);
			});
	}

	// ========================================
	// NETWORK CONFIGURATION (DNS provider + zone + records)
	// ========================================

	@Implement(serviceContract.network.get)
	networkGet() {
		return procedure(serviceContract.network.get)
			.use(requireAuth())
			.effect(function* ({ input }) {
				const network = yield* ServiceNetworkService;
				return yield* network.getNetwork(input.params.id);
			});
	}

	@Implement(serviceContract.network.update)
	networkUpdate() {
		return procedure(serviceContract.network.update)
			.use(requireAuth())
			.effect(function* ({ input }) {
				const network = yield* ServiceNetworkService;
				// Optional update body — coalesce to {}.
				return yield* network
					.updateNetwork(input.params.id, input.body ?? {});
			});
	}

	@Implement(serviceContract.network.provisionRecord)
	networkProvisionRecord() {
		return procedure(serviceContract.network.provisionRecord)
			.use(requireAuth())
			.effect(function* ({ input }) {
				const network = yield* ServiceNetworkService;
				return yield* network
					.provisionDnsRecord(input.params.id, input.body);
			});
	}
}
