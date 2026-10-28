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
	/** Starts every non-running container labelled with the deployment. */
	readonly startByDeployment: (deploymentId: string) => Effect.Effect<void, DockerError>;
	/** The engine's full record of the container; `DockerNotFound` when there is none. */
	readonly inspect: (idOrName: string) => Effect.Effect<Docker.ContainerInspectInfo, DockerError>;
	/** Containers matching `options`; running only unless `all` is set. */
	readonly list: (options?: Docker.ContainerListOptions) => Effect.Effect<Docker.ContainerInfo[], DockerError>;
	/** One resource-usage sample. */
	readonly stats: (idOrName: string) => Effect.Effect<Record<string, unknown>, DockerError>;
	/** Stops a container; one that is not running counts as stopped. */
	readonly stop: (idOrName: string) => Effect.Effect<void, DockerError>;
	readonly restart: (idOrName: string) => Effect.Effect<void, DockerError>;
	/** Pauses a container; one that is already paused counts as paused. */
	readonly pause: (idOrName: string) => Effect.Effect<void, DockerError>;
	/** Unpauses a container; one that is not paused counts as unpaused. */
	readonly unpause: (idOrName: string) => Effect.Effect<void, DockerError>;
	/** Kills a container; one that is not running counts as killed. */
	readonly kill: (idOrName: string) => Effect.Effect<void, DockerError>;
	/** True when the container runs and, if it defines a healthcheck, that healthcheck says healthy. False on any failure. */
	readonly isHealthy: (idOrName: string) => Effect.Effect<boolean>;
	/** Status, uptime, restarts, healthcheck log and resource usage. A container that cannot be read reports `status: "unknown"`. */
	readonly health: (idOrName: string) => Effect.Effect<ContainerHealth>;
	/** `health` for every container of a deployment, empty when they cannot be listed. */
	readonly monitorByDeployment: (
		deploymentId: string,
	) => Effect.Effect<{ containerId: string; containerName: string; health: ContainerHealth }[]>;
	/** `health` plus, for a running container, a GET of `healthCheckUrl` that must answer 2xx. */
	readonly probe: (idOrName: string, healthCheckUrl?: string, timeoutMs?: number) => Effect.Effect<HttpProbeResult>;
	/** True once the container is running (and answers `healthCheckUrl`); false when the probes run out. */
	readonly waitForHealth: (idOrName: string, options?: HealthWaitOptions) => Effect.Effect<boolean>;
};

export type ContainerHealth = {
	readonly isHealthy: boolean;
	readonly status: string;
	/** Seconds since the container started. */
	readonly uptime: number;
	readonly restartCount: number;
	readonly lastStarted: Date | null;
	readonly healthChecks?: {
		readonly status: string;
		readonly failingStreak: number;
		readonly log: readonly { start: string; end: string; exitCode: number; output: string }[];
	};
	readonly resources: { cpuUsage?: number; memoryUsage?: number; memoryLimit?: number };
};

export type HttpProbeResult = {
	readonly isHealthy: boolean;
	readonly httpStatus?: number;
	readonly responseTime?: number;
	readonly error?: string;
	readonly containerHealth: ContainerHealth;
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

	const startByDeployment: ContainersShape["startByDeployment"] = Effect.fn("DockerContainers.startByDeployment")(
		function* (deploymentId) {
			yield* Effect.logInfo(`Starting containers for deployment ${deploymentId}`);
			const listed = yield* engineCall("list containers", () => client.listContainers(deploymentFilter(deploymentId)));
			for (const info of listed) {
				if (info.State === "running") continue;
				yield* engineCall(`start container ${info.Id}`, () => client.getContainer(info.Id).start());
				yield* Effect.logInfo(`Started container ${info.Names[0] ?? info.Id}`);
			}
		},
	);

	const inspect: ContainersShape["inspect"] = (idOrName) =>
		engineCall(`inspect container ${idOrName}`, () => client.getContainer(idOrName).inspect(), `container '${idOrName}'`);

	const list: ContainersShape["list"] = (options = {}) => engineCall("list containers", () => client.listContainers(options));

	const stats: ContainersShape["stats"] = (idOrName) =>
		engineCall(
			`read stats of container ${idOrName}`,
			async () => (await client.getContainer(idOrName).stats({ stream: false })) as unknown as Record<string, unknown>,
			`container '${idOrName}'`,
		);

	/** Runs `action`, accepting the engine's "already in that state" refusals as success. */
	const idempotent = (idOrName: string, verb: string, run: () => Promise<unknown>, alreadyPattern: RegExp) =>
		engineCall(`${verb} container ${idOrName}`, run, `container '${idOrName}'`).pipe(
			Effect.asVoid,
			Effect.catch((failure) =>
				alreadyPattern.test(engineMessage(failure.cause ?? failure))
					? Effect.logInfo(`Container ${idOrName} ${verb}: already in that state`)
					: Effect.fail(failure),
			),
		);

	const stop: ContainersShape["stop"] = (idOrName) =>
		idempotent(idOrName, "stop", () => client.getContainer(idOrName).stop({ t: 10 }), /not running/i);
	const restart: ContainersShape["restart"] = (idOrName) =>
		engineCall(`restart container ${idOrName}`, () => client.getContainer(idOrName).restart(), `container '${idOrName}'`).pipe(Effect.asVoid);
	const pause: ContainersShape["pause"] = (idOrName) =>
		idempotent(idOrName, "pause", () => client.getContainer(idOrName).pause(), /already paused/i);
	const unpause: ContainersShape["unpause"] = (idOrName) =>
		idempotent(idOrName, "unpause", () => client.getContainer(idOrName).unpause(), /not paused/i);
	const kill: ContainersShape["kill"] = (idOrName) =>
		idempotent(idOrName, "kill", () => client.getContainer(idOrName).kill(), /not running/i);

	const isHealthy: ContainersShape["isHealthy"] = (idOrName) =>
		inspect(idOrName).pipe(
			Effect.map((info) => (info.State.Status !== "running" ? false : info.State.Health ? info.State.Health.Status === "healthy" : true)),
			Effect.catch(() => Effect.succeed(false)),
		);

	const unknownHealth: ContainerHealth = {
		isHealthy: false,
		status: "unknown",
		uptime: 0,
		restartCount: 0,
		lastStarted: null,
		resources: {},
	};

	const health: ContainersShape["health"] = Effect.fn("DockerContainers.health")(function* (idOrName) {
		const info = yield* inspect(idOrName).pipe(Effect.catch(() => Effect.succeed(null)));
		if (info === null) return unknownHealth;

		// Resource usage is best effort: a container that just started may have no sample yet.
		const sample = yield* stats(idOrName).pipe(Effect.catch(() => Effect.succeed(null)));
		const resources: ContainerHealth["resources"] = (() => {
			if (sample === null) return {};
			const cpu = sample.cpu_stats as { cpu_usage: { total_usage: number }; system_cpu_usage: number };
			const pre = sample.precpu_stats as { cpu_usage: { total_usage: number }; system_cpu_usage: number };
			const memory = sample.memory_stats as { usage: number; limit: number };
			const cpuDelta = cpu.cpu_usage.total_usage - pre.cpu_usage.total_usage;
			const systemDelta = cpu.system_cpu_usage - pre.system_cpu_usage;
			const cpuUsage = cpuDelta > 0 && systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;
			return { cpuUsage: Math.round(cpuUsage * 100) / 100, memoryUsage: memory.usage, memoryLimit: memory.limit };
		})();

		const startedAt = info.State.StartedAt ? new Date(info.State.StartedAt) : null;
		const result: ContainerHealth = {
			isHealthy: info.State.Status === "running",
			status: info.State.Status,
			uptime: Math.floor((startedAt ? Date.now() - startedAt.getTime() : 0) / 1000),
			restartCount: info.RestartCount || 0,
			lastStarted: startedAt,
			resources,
			...(info.State.Health
				? {
						healthChecks: {
							status: info.State.Health.Status,
							failingStreak: info.State.Health.FailingStreak || 0,
							// Docker's log entries use capitalised keys; callers read them lower-cased.
							log: info.State.Health.Log.slice(-5).map((entry) => ({
								start: entry.Start,
								end: entry.End,
								exitCode: entry.ExitCode,
								output: entry.Output,
							})),
						},
					}
				: {}),
		};
		return result;
	});

	const monitorByDeployment: ContainersShape["monitorByDeployment"] = Effect.fn("DockerContainers.monitorByDeployment")(
		function* (deploymentId) {
			const containers = yield* listByDeployment(deploymentId).pipe(Effect.catch(() => Effect.succeed([])));
			const results: { containerId: string; containerName: string; health: ContainerHealth }[] = [];
			for (const container of containers) {
				results.push({ containerId: container.id, containerName: container.name, health: yield* health(container.id) });
			}
			return results;
		},
	);

	const probeWithHealth: ContainersShape["probe"] = Effect.fn("DockerContainers.probe")(function* (
		idOrName,
		healthCheckUrl,
		timeoutMs = HTTP_PROBE_TIMEOUT_MS,
	) {
		const containerHealth = yield* health(idOrName);
		if (healthCheckUrl === undefined || !containerHealth.isHealthy) {
			return { isHealthy: containerHealth.isHealthy, containerHealth };
		}
		const startedAt = Date.now();
		return yield* Effect.tryPromise({
			try: async () => {
				const response = await fetch(healthCheckUrl, {
					method: "GET",
					headers: { "User-Agent": "Deployer-HealthCheck/1.0" },
					signal: AbortSignal.timeout(timeoutMs),
				});
				return { isHealthy: response.ok, httpStatus: response.status, responseTime: Date.now() - startedAt, containerHealth };
			},
			catch: (cause) => cause,
		}).pipe(
			Effect.catch((cause) => Effect.succeed({ isHealthy: false, error: engineMessage(cause), containerHealth })),
		);
	});

	return {
		stopByDeployment,
		listByDeployment,
		create,
		start,
		remove,
		waitForHealth,
		startByDeployment,
		inspect,
		list,
		stats,
		stop,
		restart,
		pause,
		unpause,
		kill,
		isHealthy,
		health,
		monitorByDeployment,
		probe: probeWithHealth,
	};
}
