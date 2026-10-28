import type Docker from "dockerode";
import { Context, Effect, Layer } from "effect";

import { DockerClient } from "./docker-client";
import { makeContainers, type ContainersShape } from "./engine/containers";
import { makeImages, type ImagesShape } from "./engine/images";
import { makeNetworks, type NetworksShape } from "./engine/networks";
import { makeSwarmServices, type SwarmServicesShape } from "./engine/swarm-services";

/**
 * The Docker engine, grouped by what it manages. Every operation is an Effect failing with a typed
 * `DockerError`; nothing here knows what a deployment is beyond the `deployer.deployment_id` label.
 */
export type DockerEngineShape = {
	readonly containers: ContainersShape;
	readonly images: ImagesShape;
	readonly swarmServices: SwarmServicesShape;
	readonly networks: NetworksShape;
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
	return {
		containers: makeContainers(client, images),
		images,
		swarmServices: makeSwarmServices(client),
		networks: makeNetworks(client),
	};
}
