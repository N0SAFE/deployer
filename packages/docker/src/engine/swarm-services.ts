import type Docker from "dockerode";
import {
	dockerodeServiceSummarySchema,
	dockerodeTaskSummarySchema,
	type DockerodeServiceSummary,
	type DockerodeTaskSummary,
} from "@deployer/contracts-entities";
import { Effect } from "effect";
import z from "zod/v4";

import type { DockerError } from "../errors";
import { engineCall } from "./call";

export type SwarmServicesShape = {
	/** The service as the engine reports it; `DockerNotFound` when there is none. */
	readonly inspect: (idOrName: string) => Effect.Effect<DockerodeServiceSummary, DockerError>;
	readonly create: (spec: Docker.ServiceSpec) => Effect.Effect<DockerodeServiceSummary, DockerError>;
	/**
	 * Applies `spec` to the service. `version` must be the service's current `Version.Index` (from
	 * `inspect`). The engine answers with warnings, not a service: inspect again for the new state.
	 */
	readonly update: (
		idOrName: string,
		version: number,
		spec: Docker.ServiceSpec,
		rollback?: boolean,
	) => Effect.Effect<void, DockerError>;
	/** Removes the service, draining its tasks. One that is already gone counts as removed. */
	readonly remove: (idOrName: string) => Effect.Effect<void, DockerError>;
	/** Sets the replica count (floored, never below zero). */
	readonly scale: (idOrName: string, replicas: number) => Effect.Effect<void, DockerError>;
	/** Re-applies the service's own `RollbackConfig` target, the previous good spec. */
	readonly rollback: (idOrName: string) => Effect.Effect<void, DockerError>;
	readonly listTasks: (idOrName: string) => Effect.Effect<DockerodeTaskSummary[], DockerError>;
};

/** The part of an inspected service that scale and rollback rewrite. */
const serviceVersionAndSpecSchema = z.object({
	Version: z.object({ Index: z.number() }),
	Spec: z.record(z.string(), z.unknown()),
});

export function makeSwarmServices(client: Docker): SwarmServicesShape {
	const resource = (idOrName: string) => `swarm service '${idOrName}'`;

	const inspect: SwarmServicesShape["inspect"] = Effect.fn("DockerSwarmServices.inspect")(function* (idOrName) {
		return yield* engineCall(
			`inspect Swarm service ${idOrName}`,
			async () => dockerodeServiceSummarySchema.parse(await client.getService(idOrName).inspect()),
			resource(idOrName),
		);
	});

	const create: SwarmServicesShape["create"] = Effect.fn("DockerSwarmServices.create")(function* (spec) {
		return yield* engineCall("create Swarm service", async () =>
			dockerodeServiceSummarySchema.parse(await client.createService(spec)),
		);
	});

	const update: SwarmServicesShape["update"] = Effect.fn("DockerSwarmServices.update")(function* (
		idOrName,
		version,
		spec,
		rollback = false,
	) {
		yield* engineCall(
			`update Swarm service ${idOrName}`,
			() => client.getService(idOrName).update({ version, ...(rollback ? { rollback: true } : {}), ...spec }),
			resource(idOrName),
		);
	});

	const remove: SwarmServicesShape["remove"] = Effect.fn("DockerSwarmServices.remove")(function* (idOrName) {
		yield* engineCall(`remove Swarm service ${idOrName}`, () => client.getService(idOrName).remove(), resource(idOrName)).pipe(
			Effect.catchTag("DockerNotFound", () => Effect.void),
		);
		yield* Effect.logInfo(`Removed Swarm service ${idOrName}`);
	});

	const scale: SwarmServicesShape["scale"] = Effect.fn("DockerSwarmServices.scale")(function* (idOrName, replicas) {
		const target = Math.max(0, Math.floor(replicas));
		yield* engineCall(
			`scale Swarm service ${idOrName}`,
			async () => {
				const service = client.getService(idOrName);
				const current = serviceVersionAndSpecSchema.parse(await service.inspect());
				await service.update({
					version: current.Version.Index,
					...current.Spec,
					Mode: { Replicated: { Replicas: target } },
				});
			},
			resource(idOrName),
		);
		yield* Effect.logInfo(`Scaled Swarm service ${idOrName} → ${String(target)} replicas`);
	});

	const rollback: SwarmServicesShape["rollback"] = Effect.fn("DockerSwarmServices.rollback")(function* (idOrName) {
		yield* engineCall(
			`roll back Swarm service ${idOrName}`,
			async () => {
				const service = client.getService(idOrName);
				const current = serviceVersionAndSpecSchema.parse(await service.inspect());
				await service.update({ version: current.Version.Index, rollback: true, ...current.Spec });
			},
			resource(idOrName),
		);
		yield* Effect.logInfo(`Rolled back Swarm service ${idOrName}`);
	});

	const listTasks: SwarmServicesShape["listTasks"] = Effect.fn("DockerSwarmServices.listTasks")(function* (idOrName) {
		return yield* engineCall(`list tasks for Swarm service ${idOrName}`, async () =>
			z.array(dockerodeTaskSummarySchema).parse(await client.listTasks({ filters: { service: [idOrName] } })),
		);
	});

	return { inspect, create, update, remove, scale, rollback, listTasks };
}

