import {
	swarmNodeResourcesSchema,
	type SwarmNodeResources,
	type SwarmServiceRuntime,
	type SwarmTaskRuntime,
} from "@deployer/contracts-entities";
import { DockerEngine, type DockerEngineShape, type DockerError } from "@deployer/docker";
import { Context, Effect, Layer } from "effect";

import { toServiceRuntime, toTaskRuntime } from "./runtime-views";

export type SwarmFleetShape = {
	/** Every swarm service with its desired and running task counts. */
	readonly listServices: () => Effect.Effect<SwarmServiceRuntime[], DockerError>;
	/** Swarm tasks, optionally narrowed to a service and/or a node (swarm NodeID). */
	readonly listTasks: (filter?: { serviceId?: string; nodeId?: string }) => Effect.Effect<SwarmTaskRuntime[], DockerError>;
	/**
	 * One node's resources: the global services plus replicated ones with a task there, its tasks, and,
	 * only when the node is the engine this API answers for (`dockerScope: "local"`), that engine's own
	 * images, networks and volumes.
	 */
	readonly getNodeResources: (nodeId: string) => Effect.Effect<SwarmNodeResources, DockerError>;
};

/** Mesh-wide fleet aggregation for the `cluster` contract: services are cluster objects, tasks carry the slot and node. */
export class SwarmFleet extends Context.Service<SwarmFleet, SwarmFleetShape>()("swarm/SwarmFleet") {
	static readonly layer: Layer.Layer<SwarmFleet, never, DockerEngine> = Layer.effect(
		SwarmFleet,
		Effect.gen(function* () {
			return makeSwarmFleet(yield* DockerEngine);
		}),
	);
}

export function makeSwarmFleet(docker: DockerEngineShape): SwarmFleetShape {
	return {
		listServices: Effect.fn("SwarmFleet.listServices")(function* () {
			const [services, tasks] = yield* Effect.all(
				[docker.swarmServices.list(), docker.swarmServices.listAllTasks().pipe(Effect.catch(() => Effect.succeed([])))],
				{ concurrency: "unbounded" },
			);
			return services.map((service) => toServiceRuntime(service, tasks));
		}),

		listTasks: Effect.fn("SwarmFleet.listTasks")(function* (filter = {}) {
			const [tasks, services] = yield* Effect.all(
				[
					docker.swarmServices.listAllTasks({
						...(filter.serviceId === undefined ? {} : { serviceId: filter.serviceId }),
						...(filter.nodeId === undefined ? {} : { nodeId: filter.nodeId }),
					}),
					docker.swarmServices.list(),
				],
				{ concurrency: "unbounded" },
			);
			const byId = new Map(services.map((service) => [service.ID, service]));
			return tasks.map((task) => toTaskRuntime(task, byId.get(task.ServiceID)));
		}),

		getNodeResources: Effect.fn("SwarmFleet.getNodeResources")(function* (nodeId) {
			const [info, services, tasks] = yield* Effect.all(
				[docker.swarmCluster.info(), docker.swarmServices.list(), docker.swarmServices.listAllTasks({ nodeId })],
				{ concurrency: "unbounded" },
			);
			const isLocal = info.NodeID === nodeId;
			const taskServiceIds = new Set(tasks.map((task) => task.ServiceID));
			const base = {
				nodeId,
				dockerScope: isLocal ? "local" : "remote",
				services: services
					.filter((service) => Boolean(service.Spec.Mode?.Global) || (service.ID !== undefined && taskServiceIds.has(service.ID)))
					.map((service) => toServiceRuntime(service, tasks)),
				tasks: tasks.map((task) => toTaskRuntime(task, services.find((service) => service.ID === task.ServiceID))),
			};
			if (!isLocal) return swarmNodeResourcesSchema.parse({ ...base, images: [], networks: [], volumes: [] });

			// A failed engine listing leaves that list empty rather than failing the whole view.
			const [images, networks, volumes] = yield* Effect.all(
				[
					docker.images.list().pipe(Effect.catch(() => Effect.succeed([]))),
					docker.networks.list().pipe(Effect.catch(() => Effect.succeed([]))),
					docker.volumes.list().pipe(Effect.catch(() => Effect.succeed([]))),
				],
				{ concurrency: "unbounded" },
			);
			return swarmNodeResourcesSchema.parse({
				...base,
				images: images.map((image) => ({ id: image.Id, repoTags: image.RepoTags, sizeBytes: image.Size ?? null })),
				networks: networks.map((network) => ({ id: network.Id, name: network.Name, driver: network.Driver ?? "", scope: network.Scope ?? "" })),
				volumes: volumes.map((volume) => ({ name: volume.Name, driver: volume.Driver ?? "", mountpoint: volume.Mountpoint ?? "" })),
			});
		}),
	};
}
