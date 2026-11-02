import { Effect } from "effect";
import z from "zod/v4";

import {
	dockerodeConfigSummarySchema,
	dockerodeNodeSummarySchema,
	dockerodeSecretSummarySchema,
	dockerodeSwarmInfoSchema,
	dockerodeSwarmInitResponseSchema,
	dockerodeSwarmInspectSchema,
	type DockerodeConfigSummary,
	type DockerodeNodeSummary,
	type DockerodeSecretSummary,
	type DockerodeSwarmInfo,
	type DockerodeSwarmInitResponse,
	type DockerodeSwarmInspect,
	type SwarmInitOptions,
	type SwarmJoinOptions,
} from "@deployer/contracts-entities";

import { engineCall } from "../call";

import { buildSwarmNodeSpecPayload, type SwarmNodeSpecChange, type SwarmNodeSpecOperation } from "./swarm-node";

import type { DockerError } from "../../errors/errors";
import type Docker from "dockerode";

export type SwarmClusterShape = {
	/** The local engine's Swarm state (`GET /info`); `LocalNodeState` tells whether it is in a cluster. */
	readonly info: () => Effect.Effect<DockerodeSwarmInfo, DockerError>;
	/** True when this engine is an active member of a swarm; false when it is not or cannot say. */
	readonly isActive: () => Effect.Effect<boolean>;
	/** The cluster the engine belongs to; `DockerNotFound` when it is in none. */
	readonly inspect: () => Effect.Effect<DockerodeSwarmInspect, DockerError>;
	/**
	 * Starts a cluster on this engine. The engine answers with the bare id of the founding node, not
	 * a swarm object. Gate on `info().LocalNodeState` to stay idempotent.
	 */
	readonly init: (options: SwarmInitOptions) => Effect.Effect<DockerodeSwarmInitResponse, DockerError>;
	readonly join: (options: SwarmJoinOptions) => Effect.Effect<void, DockerError>;
	/** `force` leaves even as a manager: a last resort for decommissioning. */
	readonly leave: (force?: boolean) => Effect.Effect<void, DockerError>;
};

export type SwarmNodesShape = {
	readonly list: () => Effect.Effect<DockerodeNodeSummary[], DockerError>;
	readonly inspect: (nodeId: string) => Effect.Effect<DockerodeNodeSummary, DockerError>;
	/** Replaces the node's labels with exactly `labels`. `version` is the node's current `Version.Index`. */
	readonly updateLabels: (
		nodeId: string,
		version: number,
		labels: Record<string, string>,
	) => Effect.Effect<void, DockerError>;
	readonly updateRoleAvailability: (
		nodeId: string,
		version: number,
		change: Pick<SwarmNodeSpecChange, "role" | "availability">,
	) => Effect.Effect<void, DockerError>;
};

export type SwarmDataObject = {
	readonly name: string;
	/** Plain text; the engine receives it base64-encoded. */
	readonly data: string;
	readonly labels?: Record<string, string>;
};

export type SwarmSecretsShape = {
	readonly create: (options: SwarmDataObject) => Effect.Effect<DockerodeSecretSummary, DockerError>;
	readonly list: () => Effect.Effect<DockerodeSecretSummary[], DockerError>;
};

export type SwarmConfigsShape = {
	readonly create: (options: SwarmDataObject) => Effect.Effect<DockerodeConfigSummary, DockerError>;
	readonly list: () => Effect.Effect<DockerodeConfigSummary[], DockerError>;
};

const encode = (options: SwarmDataObject) => ({
	Name: options.name,
	Data: Buffer.from(options.data, "utf8").toString("base64"),
	Labels: options.labels ?? {},
});

export function makeSwarmCluster(client: Docker): SwarmClusterShape {
	const info: SwarmClusterShape["info"] = Effect.fn("DockerSwarmCluster.info")(function* () {
		return yield* engineCall("read Swarm info", async () => {
			const raw: unknown = await client.info();
			const swarm = typeof raw === "object" && raw !== null && "Swarm" in raw ? raw.Swarm : undefined;
			return dockerodeSwarmInfoSchema.parse(typeof swarm === "object" && swarm !== null ? swarm : {});
		});
	});

	return {
		info,
		isActive: () =>
			info().pipe(
				Effect.map((swarm) => swarm.LocalNodeState === "active"),
				Effect.catch(() => Effect.succeed(false)),
			),
		inspect: Effect.fn("DockerSwarmCluster.inspect")(function* () {
			return yield* engineCall(
				"inspect Swarm cluster",
				async () => dockerodeSwarmInspectSchema.parse(await client.swarmInspect()),
				"Swarm cluster",
			);
		}),
		init: Effect.fn("DockerSwarmCluster.init")(function* (options) {
			return yield* engineCall("initialize Swarm cluster", async () =>
				dockerodeSwarmInitResponseSchema.parse(await client.swarmInit(options)),
			);
		}),
		join: Effect.fn("DockerSwarmCluster.join")(function* (options) {
			yield* engineCall("join Swarm cluster", () => client.swarmJoin(options));
			yield* Effect.logInfo(`Joined Swarm cluster via ${options.RemoteAddrs.join(", ")}`);
		}),
		leave: Effect.fn("DockerSwarmCluster.leave")(function* (force = false) {
			yield* engineCall("leave Swarm cluster", () => client.swarmLeave({ Force: force }));
			yield* Effect.logInfo(`Left Swarm cluster (force=${String(force)})`);
		}),
	};
}

export function makeSwarmNodes(client: Docker): SwarmNodesShape {
	const list: SwarmNodesShape["list"] = Effect.fn("DockerSwarmNodes.list")(function* () {
		return yield* engineCall("list Swarm nodes", async () =>
			z.array(dockerodeNodeSummarySchema).parse(await client.listNodes()),
		);
	});

	const inspect: SwarmNodesShape["inspect"] = Effect.fn("DockerSwarmNodes.inspect")(function* (nodeId) {
		return yield* engineCall(
			`inspect Swarm node ${nodeId}`,
			async () => dockerodeNodeSummarySchema.parse(await client.getNode(nodeId).inspect()),
			`swarm node '${nodeId}'`,
		);
	});

	/** Applies `change` over the node's CURRENT spec, so what the caller did not name is kept. */
	const apply = (nodeId: string, version: number, change: SwarmNodeSpecChange, operation: SwarmNodeSpecOperation) =>
		Effect.gen(function* () {
			const node = yield* inspect(nodeId);
			yield* engineCall(
				`update ${operation} on Swarm node ${nodeId}`,
				() => client.getNode(nodeId).update({ _query: { version }, _body: buildSwarmNodeSpecPayload(node, change) }),
				`swarm node '${nodeId}'`,
			);
			yield* Effect.logInfo(`Updated ${operation} on Swarm node ${nodeId}`);
		});

	return {
		list,
		inspect,
		updateLabels: (nodeId, version, labels) => apply(nodeId, version, { labels }, "labels"),
		updateRoleAvailability: (nodeId, version, change) => apply(nodeId, version, change, "role/availability"),
	};
}

export function makeSwarmSecrets(client: Docker): SwarmSecretsShape {
	return {
		create: Effect.fn("DockerSwarmSecrets.create")(function* (options) {
			return yield* engineCall(`create Swarm secret ${options.name}`, async () =>
				dockerodeSecretSummarySchema.parse(await client.createSecret(encode(options))),
			);
		}),
		list: Effect.fn("DockerSwarmSecrets.list")(function* () {
			return yield* engineCall("list Swarm secrets", async () =>
				z.array(dockerodeSecretSummarySchema).parse(await client.listSecrets()),
			);
		}),
	};
}

export function makeSwarmConfigs(client: Docker): SwarmConfigsShape {
	return {
		create: Effect.fn("DockerSwarmConfigs.create")(function* (options) {
			return yield* engineCall(`create Swarm config ${options.name}`, async () =>
				dockerodeConfigSummarySchema.parse(await client.createConfig(encode(options))),
			);
		}),
		list: Effect.fn("DockerSwarmConfigs.list")(function* () {
			return yield* engineCall("list Swarm configs", async () =>
				z.array(dockerodeConfigSummarySchema).parse(await client.listConfigs()),
			);
		}),
	};
}
