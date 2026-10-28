import type Docker from "dockerode";
import { Effect } from "effect";

import { engineMessage } from "../classify";
import { DockerInvalid, DockerUnavailable, type DockerError } from "../errors";
import { engineCall } from "./call";
import type { ImagePullPolicy, ImagesShape } from "./images";

/** What to create: dockerode's own options plus what the engine does not know about. */
export type CreateContainerOptions = Docker.ContainerCreateOptions & {
	/** `IfNotPresent` by default. */
	readonly imagePullPolicy?: ImagePullPolicy;
	readonly registryAuth?: Docker.AuthConfig;
};

export type ContainerSummary = {
	readonly id: string;
	readonly name: string;
	readonly status: string;
};

export type HealthWaitOptions = {
	/** Probes before giving up. Default 30. */
	readonly maxRetries?: number;
	/** Wait between probes. Default 2000. */
	readonly retryIntervalMs?: number;
	/** When set, a running container must also answer this URL with a 2xx. */
	readonly healthCheckUrl?: string;
};

export type ContainersShape = {
	/** Stops the running containers labelled with the deployment. */
	readonly stopByDeployment: (deploymentId: string) => Effect.Effect<void, DockerError>;
	/** Every container, running or not, labelled with the deployment. */
	readonly listByDeployment: (deploymentId: string) => Effect.Effect<ContainerSummary[], DockerError>;
	/**
	 * Creates a container, pulling its image first when the policy asks and the image is missing.
	 * Not started: see `start`.
	 */
	readonly create: (options: CreateContainerOptions) => Effect.Effect<{ readonly id: string }, DockerError>;
	/** Starts a container; one that is already running counts as started. */
	readonly start: (idOrName: string) => Effect.Effect<void, DockerError>;
	/** Stops (if running) and removes a container and its anonymous volumes; one that is gone counts as removed. */
	readonly remove: (idOrName: string) => Effect.Effect<void, DockerError>;
	/** True once the container is running (and answers `healthCheckUrl`); false when the probes run out. */
	readonly waitForHealth: (idOrName: string, options?: HealthWaitOptions) => Effect.Effect<boolean>;
};

const HTTP_PROBE_TIMEOUT_MS = 30_000;

const deploymentFilter = (deploymentId: string) => ({
	all: true,
	filters: { label: [`deployer.deployment_id=${deploymentId}`] },
});

export function makeContainers(client: Docker, images: ImagesShape): ContainersShape {
	const stopByDeployment: ContainersShape["stopByDeployment"] = Effect.fn("DockerContainers.stopByDeployment")(
		function* (deploymentId) {
			yield* Effect.logInfo(`Stopping containers for deployment ${deploymentId}`);
			const listed = yield* engineCall("list containers", () => client.listContainers(deploymentFilter(deploymentId)));
			for (const info of listed) {
				if (info.State !== "running") continue;
				yield* engineCall(`stop container ${info.Id}`, () => client.getContainer(info.Id).stop({ t: 10 }));
				yield* Effect.logInfo(`Stopped container ${info.Names[0] ?? info.Id}`);
			}
		},
	);

	const listByDeployment: ContainersShape["listByDeployment"] = Effect.fn("DockerContainers.listByDeployment")(
		function* (deploymentId) {
			const listed = yield* engineCall("list containers", () => client.listContainers(deploymentFilter(deploymentId)));
			return listed.map((info) => ({ id: info.Id, name: info.Names[0] ?? "unknown", status: info.State }));
		},
	);

	const createOnce = (options: CreateContainerOptions) => {
		const { imagePullPolicy: _policy, registryAuth: _auth, ...engineOptions } = options;
		return engineCall("create container", async () => ({ id: (await client.createContainer(engineOptions)).id }));
	};

	const create: ContainersShape["create"] = Effect.fn("DockerContainers.create")(function* (options) {
		const image = options.Image;
		const policy = options.imagePullPolicy ?? "IfNotPresent";
		if (image === undefined || image.length === 0) {
			return yield* Effect.fail(new DockerInvalid({ reason: "Cannot create container: no image specified" }));
		}
		yield* images.ensurePresent(image, policy, options.registryAuth);

		return yield* createOnce(options).pipe(
			Effect.catch((failure: DockerError) => {
				// The image can vanish between the presence check and the create (pruned, or a registry
				// race); pull once more and retry, unless the policy forbids pulling at all.
				const imageMissing = /no such image|not found|manifest unknown/i.test(engineMessage(failure));
				if (!imageMissing || policy === "Never") return Effect.fail(failure);
				return images
					.pull(image, { registryAuth: options.registryAuth })
					.pipe(Effect.flatMap(() => createOnce(options)));
			}),
		);
	});

	const start: ContainersShape["start"] = Effect.fn("DockerContainers.start")(function* (idOrName) {
		yield* engineCall(`start container ${idOrName}`, () => client.getContainer(idOrName).start(), `container '${idOrName}'`).pipe(
			Effect.catch((failure) =>
				/already started|already running/i.test(engineMessage(failure.cause ?? failure))
					? Effect.logInfo(`Container ${idOrName} already running`)
					: Effect.fail(failure),
			),
		);
	});

	const remove: ContainersShape["remove"] = Effect.fn("DockerContainers.remove")(function* (idOrName) {
		const container = client.getContainer(idOrName);
		const info = yield* engineCall(`inspect container ${idOrName}`, () => container.inspect(), `container '${idOrName}'`);
		if (info.State.Status === "running") {
			yield* engineCall(`stop container ${idOrName}`, () => container.stop({ t: 10 }), `container '${idOrName}'`);
		}
		yield* engineCall(`remove container ${idOrName}`, () => container.remove({ force: true, v: true }), `container '${idOrName}'`);
		yield* Effect.logInfo(`Removed container ${idOrName}`);
	}, (effect) =>
		effect.pipe(
			Effect.catchTag("DockerNotFound", () => Effect.logInfo("Container already removed or not found")),
		),
	);

	/** One probe: running, and (when asked) answering the URL. A probe that errors is just "not yet". */
	const probe = (idOrName: string, healthCheckUrl: string | undefined) =>
		Effect.gen(function* () {
			const info = yield* engineCall(`inspect container ${idOrName}`, () => client.getContainer(idOrName).inspect());
			if (info.State.Status !== "running") return false;
			if (healthCheckUrl === undefined) return true;
			return yield* Effect.tryPromise({
				try: async () => {
					const response = await fetch(healthCheckUrl, {
						method: "GET",
						headers: { "User-Agent": "Deployer-HealthCheck/1.0" },
						signal: AbortSignal.timeout(HTTP_PROBE_TIMEOUT_MS),
					});
					return response.ok;
				},
				catch: (cause) => new DockerUnavailable({ reason: engineMessage(cause), cause }),
			});
		}).pipe(Effect.catch(() => Effect.succeed(false)));

	const waitForHealth: ContainersShape["waitForHealth"] = Effect.fn("DockerContainers.waitForHealth")(function* (
		idOrName,
		options = {},
	) {
		const maxRetries = options.maxRetries ?? 30;
		const retryIntervalMs = options.retryIntervalMs ?? 2000;
		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			yield* Effect.logDebug(`Health check attempt ${String(attempt)}/${String(maxRetries)} for container ${idOrName}`);
			if (yield* probe(idOrName, options.healthCheckUrl)) {
				yield* Effect.logInfo(`Container ${idOrName} is healthy after ${String(attempt)} attempts`);
				return true;
			}
			if (attempt < maxRetries) yield* Effect.sleep(retryIntervalMs);
		}
		yield* Effect.logError(`Container ${idOrName} failed health check after ${String(maxRetries)} attempts`);
		return false;
	});

	return { stopByDeployment, listByDeployment, create, start, remove, waitForHealth };
}
