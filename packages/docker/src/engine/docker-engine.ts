import { Context, Effect, Layer } from "effect";

import { DockerClient } from "../client/docker-client";

import { engineCall } from "./call";
import { makeContainers, type ContainersShape } from "./containers/containers";
import { makeExec, type ExecShape } from "./containers/exec";
import { makeLogs, type LogsShape } from "./containers/logs";
import { makeEvents, type EventsShape } from "./events/events";
import { makeBuild, type BuildShape } from "./images/build";
import { makeImages, type ImagesShape } from "./images/images";
import { makeNetworks, type NetworksShape } from "./networking/networks";
import { makeVolumes, type VolumesShape } from "./networking/volumes";
import {
	makeSwarmCluster,
	makeSwarmConfigs,
	makeSwarmNodes,
	makeSwarmSecrets,
	type SwarmClusterShape,
	type SwarmConfigsShape,
	type SwarmNodesShape,
	type SwarmSecretsShape,
} from "./swarm/swarm-cluster";
import { makeSwarmServices, type SwarmServicesShape } from "./swarm/swarm-services";

import type { DockerError } from "../errors/errors";
import type Docker from "dockerode";

/**
 * The Docker engine, grouped by what it manages. Every operation is an Effect failing with a typed
 * `DockerError`; nothing here knows what a deployment is beyond the `deployer.deployment_id` label.
 */
/** The daemon facts this platform reads from `GET /info`. Dockerode types the whole reply `any`. */
export interface DockerEngineInfo {
	readonly ID?: string;
	readonly ServerVersion?: string;
	readonly NodeID?: string;
	readonly [field: string]: unknown;
}

export type DockerEngineShape = {
	readonly containers: ContainersShape;
	readonly images: ImagesShape;
	readonly swarmServices: SwarmServicesShape;
	readonly networks: NetworksShape;
	readonly volumes: VolumesShape;
	readonly exec: ExecShape;
	readonly logs: LogsShape;
	readonly events: EventsShape;
	readonly build: BuildShape;
	/** The daemon's `GET /info`. */
	readonly info: () => Effect.Effect<DockerEngineInfo, DockerError>;
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
		events: makeEvents(client),
		build: makeBuild(client),
		info: () => engineCall("read engine info", () => client.info()),
		ping: () =>
			// `ping` takes no options, so there is no signal to pass on.
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
