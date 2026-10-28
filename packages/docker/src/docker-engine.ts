import type Docker from "dockerode";
import { Context, Effect, Layer } from "effect";

import { DockerClient } from "./docker-client";
import { makeBuild, type BuildShape } from "./engine/build";
import { makeExec, type ExecShape } from "./engine/exec";
import { makeLogs, type LogsShape } from "./engine/logs";
import { makeContainers, type ContainersShape } from "./engine/containers";
import { makeImages, type ImagesShape } from "./engine/images";
import { makeNetworks, type NetworksShape } from "./engine/networks";
import {
	makeSwarmCluster,
	makeSwarmConfigs,
	makeSwarmNodes,
	makeSwarmSecrets,
	type SwarmClusterShape,
	type SwarmConfigsShape,
	type SwarmNodesShape,
	type SwarmSecretsShape,
} from "./engine/swarm-cluster";
import { makeSwarmServices, type SwarmServicesShape } from "./engine/swarm-services";
import { makeVolumes, type VolumesShape } from "./engine/volumes";

/**
 * The Docker engine, grouped by what it manages. Every operation is an Effect failing with a typed
 * `DockerError`; nothing here knows what a deployment is beyond the `deployer.deployment_id` label.
 */
export type DockerEngineShape = {
	readonly containers: ContainersShape;
	readonly images: ImagesShape;
	readonly swarmServices: SwarmServicesShape;
	readonly networks: NetworksShape;
	readonly volumes: VolumesShape;
	readonly exec: ExecShape;
	readonly logs: LogsShape;
	readonly build: BuildShape;
	/** True when the engine answers a ping. */
	readonly ping: () => Effect.Effect<boolean>;
	readonly swarmCluster: SwarmClusterShape;
	readonly swarmNodes: SwarmNodesShape;
	readonly swarmSecrets: SwarmSecretsShape;
	readonly swarmConfigs: SwarmConfigsShape;
};

export class DockerEngine extends Context.Service<DockerEngine, DockerEngineShape>()("docker/DockerEngine") {
	static readonly Live: Layer.Layer<DockerEngine, never, DockerClient> = Layer.effect(
		DockerEngine,
		Effect.gen(function* () {
			return makeDockerEngine(yield* DockerClient);
		}),
	);
}

export function makeDockerEngine(client: Docker): DockerEngineShape {
	const images = makeImages(client);
	const swarmServices = makeSwarmServices(client);
	return {
		containers: makeContainers(client, images),
		images,
		swarmServices,
		networks: makeNetworks(client, swarmServices),
		volumes: makeVolumes(client),
		exec: makeExec(client),
		logs: makeLogs(client),
		build: makeBuild(client),
		ping: () =>
			Effect.tryPromise({ try: () => client.ping(), catch: (cause) => cause }).pipe(
				Effect.as(true),
				Effect.catch(() => Effect.succeed(false)),
			),
		swarmCluster: makeSwarmCluster(client),
		swarmNodes: makeSwarmNodes(client),
		swarmSecrets: makeSwarmSecrets(client),
		swarmConfigs: makeSwarmConfigs(client),
	};
}
