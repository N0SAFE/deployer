/**
 * RedisSupervisorService — supervises the platform Redis container.
 *
 * Redis is API-owned infrastructure (like traefik / local-db / managed-web):
 * the API ensures the container, network, volume and health; it runs BEFORE
 * and WHILE the setup wizard because it is gateway-owned (registered in
 * SupervisorsPlatformModule). It is intentionally HEADLESS by default — only
 * reachable on the `deployer-platform` network as `deployer-redis` — with an
 * optional `DEPLOYER_REDIS_PORT` host bind for debugging.
 *
 * Extends BaseDockerSupervisorService: desired state is a single Redis
 * container ("always running"), converged idempotently with backoff, and
 * auto-registered into the SupervisorOrchestratorService by the base class.
 *
 * Consumers get the connection URL through `getConnectionUrl()` — resolution
 * is typed and centralized here (never scatter `redis://…` strings around).
 */

import type { Duplex } from "node:stream";
import { Injectable } from "@nestjs/common";
import z from "zod/v4";

import {
	BaseDockerSupervisorService,
	type DockerSupervisorContainerSpec,
} from "@/core/modules/docker/services/base-docker-supervisor.service";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import {
	baseSupervisorPayloadSchema,
	type SupervisorProbeResult,
} from "@/core/modules/supervisors/base-supervisor.service";
import {
	baseSupervisorProcessInfoSchema,
	dockerProcessInfoSchema,
} from "@/core/modules/supervisors/supervisor-process-info";
import { EnvService } from "@/config/env/env.service";
import { splitManagedEnv } from "@repo/env";
import { PLATFORM_ROLE_LABEL, PlatformNetwork } from "./traefik-supervisor.service";

/** Ownership marker — cleanup/inspection tooling keys off this label. */
const REDIS_ROLE = "platform-redis";

export const PLATFORM_REDIS_SUPERVISOR_ID = "platform-redis";

/** Container base name inside the platform network (docker embedded DNS). */
export const REDIS_CONTAINER_BASE_NAME = "deployer-redis";
/** Internal port the supervised Redis listens on INSIDE the container. */
export const REDIS_INTERNAL_PORT = 6379;
/** Named volume persisting the AOF data. */
export const REDIS_DATA_VOLUME = "deployer-redis-data";
/** Where the named volume is mounted inside the container. */
export const REDIS_DATA_MOUNT = "/data";

/**
 * Zod schema of the rich health payload this supervisor reports. Real
 * measurements: container state + a live `redis-cli ping` (expect PONG) with
 * latency; `null` marks a measurement that could not be obtained.
 */
export const redisSupervisorPayloadSchema = baseSupervisorPayloadSchema.extend({
	container: z
		.object({
			id: z.string(),
			name: z.string(),
			image: z.string(),
			running: z.boolean(),
			exitCode: z.number().int().nullable(),
			restartCount: z.number().int().min(0),
			startedAt: z.string().datetime().nullable(),
		})
		.nullable(),
	host: z.string(),
	port: z.number().int().min(1),
	reachable: z.boolean(),
	ping: z.string().nullable(),
	redisVersion: z.string().nullable(),
	latencyMs: z.number().int().min(0).nullable(),
});
export type RedisSupervisorPayload = z.output<typeof redisSupervisorPayloadSchema>;

/** Process info reported by the redis supervisor (the supervised container). */
export const redisProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: dockerProcessInfoSchema,
});
export type RedisProcessInfo = z.output<typeof redisProcessInfoSchema>;

@Injectable()
export class RedisSupervisorService extends BaseDockerSupervisorService<
	typeof redisSupervisorPayloadSchema,
	typeof redisProcessInfoSchema
> {
	static readonly identifier = PLATFORM_REDIS_SUPERVISOR_ID;
	readonly description =
		"Platform Redis (durable key-value store for idempotency, rate limits and future multi-node coordination)";

	readonly payloadSchema = redisSupervisorPayloadSchema;
	readonly processInfoSchema = redisProcessInfoSchema;

	constructor(
		dockerService: DockerService,
		private readonly env: EnvService,
	) {
		super(dockerService);
	}

	/**
	 * Compose-managed Redis: `MANAGED_REDIS_ENABLED=true` means the deployment
	 * (Docker Compose / operator) owns the Redis service — the API must NOT
	 * spawn or supervise it. Skip registration entirely; consumers reach it
	 * through the nested `managed.redis.*` config instead.
	 */
	override async onModuleInit(): Promise<void> {
		if (this.isComposeManaged()) {
			this.logger.log("Compose-managed Redis detected (MANAGED_REDIS_ENABLED=true) — supervisor skipped (not registered)");
			return;
		}
		super.onModuleInit();
	}

	/** True when the deployment owns this redis (dev compose stack). */
	private isComposeManaged(): boolean {
		return splitManagedEnv(this.env).redis.enabled === true;
	}

	protected buildDegradedPayload(_detail: string): z.output<typeof redisSupervisorPayloadSchema> {
		const spec = this.buildContainerSpec();
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			container: null,
			host: spec.name,
			port: REDIS_INTERNAL_PORT,
			reachable: false,
			ping: null,
			redisVersion: null,
		};
	}

	/** The connection URL + live container state of the supervised process. */
	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		const spec = this.buildContainerSpec();
		return {
			process: await this.describeDockerProcess(spec),
			connection: {
				host: spec.name,
				port: REDIS_INTERNAL_PORT,
				url: this.getConnectionUrl(),
				published: spec.portBindings !== undefined,
			},
		};
	}

	/** Deterministic container spec for the platform Redis. Default HEADLESS
	 *  (platform-network only); an optional `DEPLOYER_REDIS_PORT` host bind is
	 *  for debugging, not required by any in-network consumer. */
	protected buildContainerSpec(): DockerSupervisorContainerSpec {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		const password = this.env.get("DEPLOYER_REDIS_PASSWORD");
		const debugPort = this.env.get("DEPLOYER_REDIS_PORT");

		const command = [
			"redis-server",
			// Durable AOF — the supervised volume persists `/data`.
			"--appendonly",
			"yes",
			...(password ? ["--requirepass", password] : []),
		];

		return {
			name: prefix === "" ? REDIS_CONTAINER_BASE_NAME : `${REDIS_CONTAINER_BASE_NAME}-${prefix}`,
			// Default image is small + has `redis-cli` (used by the real probe).
			image: this.env.get("DEPLOYER_REDIS_IMAGE") ?? "redis:7-alpine",
			command,
			networkName: PlatformNetwork.name(prefix),
			// Named volume → AOF data survives container recreation.
			binds: [`${REDIS_DATA_VOLUME}:${REDIS_DATA_MOUNT}`],
			portBindings:
				debugPort === undefined || debugPort === null
					? undefined
					: { [`${REDIS_INTERNAL_PORT}/tcp`]: [{ HostPort: String(debugPort) }] },
			restartPolicy: "unless-stopped",
			labels: {
				[PLATFORM_ROLE_LABEL]: REDIS_ROLE,
			},
		};
	}

	/**
	 * The typed connection URL consumers use to reach the managed Redis.
	 * Resolution order:
	 *   1. `managed.redis.url` (compose-managed explicit URL)
	 *   2. `DEPLOYER_REDIS_URL` (explicit override, e.g. an external Redis)
	 *   3. compose-managed defaults → `redis://[pwd@]<host>:<port>` from
	 *      `managed.redis.host/port/password`
	 *   4. API-supervised default → `redis://[pwd@]deployer-redis:6379`
	 */
	getConnectionUrl(): string {
		const managed = splitManagedEnv(this.env).redis;
		if (managed.enabled) {
			const managedUrl = managed.url;
			if (managedUrl !== undefined && managedUrl !== "") return managedUrl;

			const host = managed.host ?? "redis";
			const port = managed.port ?? 6379;
			const password = managed.password;
			const auth = password ? `${encodeURIComponent(password)}@` : "";
			return `redis://${auth}${host}:${port}`;
		}

		const explicit = this.env.get("DEPLOYER_REDIS_URL");
		if (explicit !== undefined && explicit !== "") return explicit;

		const prefix = this.env.get("DEPLOYER_PREFIX");
		const host = prefix === "" ? REDIS_CONTAINER_BASE_NAME : `${REDIS_CONTAINER_BASE_NAME}-${prefix}`;
		const password = this.env.get("DEPLOYER_REDIS_PASSWORD");
		const auth = password ? `${encodeURIComponent(password)}@` : "";
		return `redis://${auth}${host}:${REDIS_INTERNAL_PORT}`;
	}

	/** One idempotent convergence pass: network → volume → self-attach →
	 *  inspect → create/start → verify. Never binds host ports by default. */
	protected async reconcile(): Promise<void> {
		await this.runWithBackoff(
			"Platform Redis convergence",
			async () => {
				const spec = this.buildContainerSpec();
				const networkId = spec.networkName !== undefined ? await this.ensureNetwork(spec.networkName) : undefined;

				// Ensure the data volume exists (compose usually creates it;
				// belt-and-suspenders for dockerode-only deployments).
				await this.ensureVolume(REDIS_DATA_VOLUME);

				// The API itself must reach Redis over the platform network.
				if (networkId !== undefined) {
					await this.connectSelfToNetwork(networkId);
				}

				const inspect = await this.inspectContainer(spec.name);
				try {
					if (inspect === null) {
						await this.pullImage(spec.image);
						const container = await this.createContainer(spec, networkId);
						await container.start();
					} else if (!inspect.State.Running) {
						await this.client.getContainer(spec.name).start();
					}
				} catch (startError) {
					// A failed create/start should not leave a zombie behind.
					await this.removeContainerIfExists(spec.name);
					throw startError;
				}

				await this.verifyConvergence(spec);
			},
			{ maxAttempts: 5 },
		);
	}

	/**
	 * REAL health observation: container state (docker inspect) + a live
	 * `redis-cli ping` executed INSIDE the container (expect PONG) + `INFO
	 * server` for the version. Never throws for an unhealthy redis — the
	 * payload records the failure.
	 */
	protected async probe(): Promise<SupervisorProbeResult<typeof redisSupervisorPayloadSchema>> {
		const startedAt = Date.now();
		const spec = this.buildContainerSpec();

		const inspect = await this.inspectContainer(spec.name);
		if (inspect === null || !inspect.State.Running) {
			return {
				healthy: false,
				detail: `Redis container '${spec.name}' is not running`,
				payload: {
					checkedAt: new Date().toISOString(),
					latencyMs: Date.now() - startedAt,
					container: inspect
						? {
								id: inspect.Id,
								name: spec.name,
								image: spec.image,
								running: inspect.State.Running,
								exitCode: inspect.State.ExitCode ?? null,
								restartCount: inspect.RestartCount ?? 0,
								startedAt: inspect.State.StartedAt ?? null,
							}
						: null,
					host: spec.name,
					port: REDIS_INTERNAL_PORT,
					reachable: false,
					ping: null,
					redisVersion: null,
				},
			};
		}

		try {
			const ping = await this.execRedisCli(spec.name, ["ping"]);
			const pingOk = ping.trim().toUpperCase() === "PONG";
			const info = pingOk ? await this.execRedisCli(spec.name, ["info", "server"]) : "";
			const version = /^redis_version:([0-9.]+)/m.exec(info)?.[1] ?? null;

			return {
				healthy: pingOk,
				...(pingOk ? {} : { detail: `redis-cli ping did not return PONG (got '${ping.trim() || "<empty>"}')` }),
				payload: {
					checkedAt: new Date().toISOString(),
					latencyMs: Date.now() - startedAt,
					container: {
						id: inspect.Id,
						name: spec.name,
						image: spec.image,
						running: inspect.State.Running,
						exitCode: inspect.State.ExitCode ?? null,
						restartCount: inspect.RestartCount ?? 0,
						startedAt: inspect.State.StartedAt ?? null,
					},
					host: spec.name,
					port: REDIS_INTERNAL_PORT,
					reachable: pingOk,
					ping: pingOk ? "PONG" : ping.trim(),
					redisVersion: version,
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				healthy: false,
				detail: `redis-cli probe failed: ${message}`,
				payload: {
					checkedAt: new Date().toISOString(),
					latencyMs: Date.now() - startedAt,
					container: {
						id: inspect.Id,
						name: spec.name,
						image: spec.image,
						running: inspect.State.Running,
						exitCode: inspect.State.ExitCode ?? null,
						restartCount: inspect.RestartCount ?? 0,
						startedAt: inspect.State.StartedAt ?? null,
					},
					host: spec.name,
					port: REDIS_INTERNAL_PORT,
					reachable: false,
					ping: null,
					redisVersion: null,
				},
			};
		};
	}

	/** Attach THIS API container to the platform network idempotently (403
	 *  "already exists" proves compose already attached it — treat as ok). */
	private async connectSelfToNetwork(networkId: string): Promise<void> {
		const selfId = process.env.HOSTNAME;
		if (selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId)) return; // not in Docker

		const ownName = await this.resolveOwnContainerName();
		const network = this.client.getNetwork(networkId);
		const isAttached = async (): Promise<boolean> => {
			const details = await network.inspect().catch(() => null);
			return Object.values(details?.Containers ?? {}).some((entry) => {
				if (typeof entry !== "object" || entry === null) return false;
				const name = (entry as { Name?: string }).Name?.replace(/^\//, "") ?? "";
				return name === ownName;
			});
		};
		if (await isAttached()) return;

		try {
			await network.connect({ Container: selfId });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes("already exists")) return;
			const attached = await isAttached();
			if (!attached) throw error;
		}
	}

	private async resolveOwnContainerName(): Promise<string> {
		const selfId = process.env.HOSTNAME;
		if (selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId)) return "host.docker.internal";
		try {
			const info = await this.client.getContainer(selfId).inspect();
			const name = ((info as unknown as { Name?: string })?.Name ?? "").replace(/^\//, "");
			if (name !== "") return name;
		} catch {
			/* inspect failed — fall through */
		}
		return selfId;
	}
	private async execRedisCli(containerName: string, args: string[]): Promise<string> {
		const container = this.client.getContainer(containerName);
		const exec = await container.exec({
			Cmd: ["redis-cli", ...args],
			AttachStdout: true,
			AttachStderr: true,
		});

		return await new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("redis-cli exec timed out"));
			}, 3_000);
			exec.start({} as never, (err: unknown, stream: Duplex | undefined) => {
				if (err) {
					clearTimeout(timer);
					reject(err instanceof Error ? err : new Error(String(err)));
					return;
				}
				if (stream === null || stream === undefined) {
					clearTimeout(timer);
					reject(new Error("redis-cli exec produced no output stream"));
					return;
				}
				let output = "";
				stream.on("data", (chunk: Buffer | string) => {
					output += chunk.toString();
				});
				stream.on("end", () => {
					clearTimeout(timer);
					resolve(output.trim());
				});
				stream.on("error", (streamError: Error) => {
					clearTimeout(timer);
					reject(streamError);
				});
			});
		});
	}

	/** Throw when the container is not actually running after converge. */
	private async verifyConvergence(spec: DockerSupervisorContainerSpec): Promise<void> {
		const live = await this.inspectContainer(spec.name);
		if (live === null || !live.State.Running) {
			throw new Error(`Redis container '${spec.name}' did not start`);
		}
	}
}