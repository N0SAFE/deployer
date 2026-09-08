/**
 * RedisSupervisorService — supervises the platform Redis.
 *
 * Redis is API-owned infrastructure (like traefik / global-db / managed-web).
 * RUNTIME (see docker-supervisor-runtime.ts):
 *   - managed (composition/operator in dev)  → link-only: ensure the overlay
 *     exists and wire the API container into it so compose-managed Redis
 *     reaches/is reached from swarm networks. The supervisor NEVER spawns a
 *     redis container when the deployment owns Redis.
 *   - swarm-replicated (prod, mesh-wide)     → a single replicated swarm
 *     service on the attachable platform overlay (one logical Redis store).
 *   - unavailable                             → no legacy container fallback.
 *
 * Consumers get the connection URL through `getConnectionUrl()` — resolution
 * is typed and centralized here (never scatter `redis://…` strings around).
 */

import { Injectable } from "@nestjs/common";
import z from "zod/v4";

import { BaseDockerSupervisorService } from "@/core/modules/docker/services/base-docker-supervisor.service";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import {
	baseSupervisorPayloadSchema,
	type SupervisorProbeResult,
} from "@/core/modules/supervisors/base-supervisor.service";
import {
	baseSupervisorProcessInfoSchema,
	swarmProcessInfoSchema,
} from "@/core/modules/supervisors/supervisor-process-info";
import { EnvService } from "@/config/env/env.service";
import { splitManagedEnv } from "@repo/env";
import {
	resolveSupervisorRuntime,
	type DockerSupervisorRuntime,
} from "@/core/modules/docker/services/docker-supervisor-runtime";
import type { SwarmServiceSpecInput } from "@repo/contracts-entities";
import { PLATFORM_ROLE_LABEL, PlatformNetwork } from "./traefik-supervisor.service";

/** Ownership marker — cleanup/inspection tooling keys off this label. */
const REDIS_ROLE = "platform-redis";

export const PLATFORM_REDIS_SUPERVISOR_ID = "platform-redis";
export const REDIS_CONTAINER_BASE_NAME = "deployer-redis";
export const REDIS_INTERNAL_PORT = 6379;
export const REDIS_DATA_VOLUME = "deployer-redis-data";
export const REDIS_DATA_MOUNT = "/data";
export const REDIS_SERVICE_IMAGE_DEFAULT = "redis:7-alpine";

/** Which runtime this supervisor is CURRENTLY under. */
export const redisRuntimeSchema = z.enum(["managed", "swarm-replicated", "unavailable"]);
export type RedisRuntime = z.output<typeof redisRuntimeSchema>;

/**
 * Rich health payload: process (service) state + reachability. `null` marks a
 * measurement that could not be obtained.
 */
export const redisSupervisorPayloadSchema = baseSupervisorPayloadSchema.extend({
	runtime: redisRuntimeSchema,
	service: z
		.object({
			id: z.string(),
			name: z.string(),
			runningTasks: z.number().int().min(0).nullable(),
			exists: z.boolean(),
		})
		.nullable(),
	host: z.string(),
	port: z.number().int().min(1),
	reachable: z.boolean(),
	ping: z.string().nullable(),
	redisVersion: z.string().nullable(),
});
export type RedisSupervisorPayload = z.output<typeof redisSupervisorPayloadSchema>;

/** Process info reported by the redis supervisor (a swarm service). */
export const redisProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: swarmProcessInfoSchema,
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

	/** True when the deployment owns this redis (dev compose stack). */
	private isComposeManaged(): boolean {
		return splitManagedEnv(this.env).redis.enabled === true;
	}

	/** Resolve the current runtime. Redis is mesh-wide → replicated 1 in prod. */
	protected resolveRuntime(): { runtime: RedisRuntime; reason: string } {
		const resolved = resolveSupervisorRuntime({
			managed: this.isComposeManaged(),
			rawRuntime: process.env.SUPERVISOR_RUNTIME,
			// Swarm activity is a soft signal: reconcile's swarm calls are the
			// authoritative check (a node that isn't active reports unavailable).
			swarmActive: true,
			scope: "mesh-wide",
		});
		const runtime: RedisRuntime =
			resolved.runtime === "managed"
				? "managed"
				: resolved.runtime === "unavailable"
					? "unavailable"
					: "swarm-replicated";
		return { runtime, reason: resolved.reason };
	}

	/** Current runtime, defaulting to swarm-replicated for a healthy supervised node. */
	protected effectiveRuntime(): RedisRuntime {
		return this.resolveRuntime().runtime;
	}

	/** Swarm service name (same DNS name as the container era). */
	private serviceName(): string {
		const prefix = this.env.get("DEPLOYER_PREFIX") ?? "";
		return prefix === "" ? REDIS_CONTAINER_BASE_NAME : `${REDIS_CONTAINER_BASE_NAME}-${prefix}`;
	}

	private image(): string {
		return this.env.get("DEPLOYER_REDIS_IMAGE") ?? REDIS_SERVICE_IMAGE_DEFAULT;
	}

	private command(): string[] {
		const password = this.env.get("DEPLOYER_REDIS_PASSWORD");
		return ["redis-server", "--appendonly", "yes", ...(password ? ["--requirepass", password] : [])];
	}

	/** Swarm service spec for the mesh-wide platform Redis. */
	protected buildSwarmSpec(): SwarmServiceSpecInput {
		return {
			name: this.serviceName(),
			image: this.image(),
			mode: "replicated",
			replicas: 1,
			env: [],
			command: this.command(),
			args: [],
			labels: { [PLATFORM_ROLE_LABEL]: REDIS_ROLE, "deployer.managed": "true" },
			containerLabels: {},
			mounts: [{ type: "volume", source: REDIS_DATA_VOLUME, target: REDIS_DATA_MOUNT, readOnly: false }],
			placementPreferences: [],
			placementConstraints: [],
			resourcesLimits: {},
			resourcesReservations: {},
			networks: [],
			healthcheck: null,
			updateConfig: { parallelism: 1, delayMs: 0, order: "start-first", failureAction: "rollback" },
			endpointPorts: [],
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

		const host = this.serviceName();
		const password = this.env.get("DEPLOYER_REDIS_PASSWORD");
		const auth = password ? `${encodeURIComponent(password)}@` : "";
		return `redis://${auth}${host}:${REDIS_INTERNAL_PORT}`;
	}

	/** Always register — managed links networks, swarm reconciles the service. */
	override onModuleInit(): void {
		const { runtime, reason } = this.resolveRuntime();
		this.logger.log(`Redis supervisor registering — runtime=${runtime} (${reason})`);
		super.onModuleInit();
	}

	/** One idempotent convergence pass. */
	protected async reconcile(): Promise<void> {
		const runtime = this.effectiveRuntime();

		if (runtime === "managed") {
			const overlay = await this.wireExternalToSwarm(
				PlatformNetwork.name(this.env.get("DEPLOYER_PREFIX") ?? ""),
				this.serviceName(),
			);
			this.logger.log(`Redis managed (compose/operator) — wired external to swarm overlay ${overlay}`);
			return;
		}

		if (runtime === "unavailable") {
			throw new Error(
				"Redis requires an active swarm engine or managed (compose/operator) ownership — no legacy container fallback. SwarmBootstrapService should have converged the engine.",
			);
		}

		// swarm-replicated
		await this.runWithBackoff(
			"Platform Redis (swarm) convergence",
			async () => {
				const overlay = await this.ensureSwarmNetwork(
					PlatformNetwork.name(this.env.get("DEPLOYER_PREFIX") ?? ""),
				);
				const spec = this.buildSwarmSpec();
				spec.networks = [overlay];
				await this.reconcileSwarmService(spec);
				await this.verifySwarmConvergence(spec.name);
			},
			{ maxAttempts: 5 },
		);
	}

	/** Verify the swarm service exists after converge. */
	private async verifySwarmConvergence(name: string): Promise<void> {
		const svc = await this.dockerService.inspectSwarmService(name);
		if (svc.ID) return;
		throw new Error(`Redis swarm service '${name}' was not created`);
	}

	/** Entire config + live process view (a swarm service). */
	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		const runtime = this.effectiveRuntime();
		if (runtime === "swarm-replicated") {
			return {
				process: await this.describeSwarmProcess(this.buildSwarmSpec()),
				connection: { host: this.serviceName(), port: REDIS_INTERNAL_PORT, url: this.getConnectionUrl() },
			};
		}
		return {
			process: {
				kind: "swarm",
				runtime: "swarm-replicated",
				desired: { name: this.serviceName(), image: this.image(), command: this.command(), labels: {}, networkName: null, mode: "replicated", replicas: 1 },
				live: { serviceId: null, exists: false, createdAt: null, updatedAt: null, serviceName: null, runningTasks: null, totalTasks: null },
			},
			connection: { host: this.serviceName(), port: REDIS_INTERNAL_PORT, url: this.getConnectionUrl() },
		};
	}

	/** Degraded payload when probe() itself throws. */
	protected buildDegradedPayload(_detail: string): z.output<typeof redisSupervisorPayloadSchema> {
		const runtime = this.effectiveRuntime();
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			runtime,
			service: null,
			host: this.serviceName(),
			port: REDIS_INTERNAL_PORT,
			reachable: false,
			ping: null,
			redisVersion: null,
		};
	}

	/** REAL health observation: service state + best-effort reachability. */
	protected async probe(): Promise<SupervisorProbeResult<typeof redisSupervisorPayloadSchema>> {
		const startedAt = Date.now();
		const runtime = this.effectiveRuntime();

		if (runtime === "managed") {
			return {
				healthy: true,
				detail:
					"Redis is compose/operator-managed — link-only wiring active, process health owned by the deployment.",
				payload: {
					checkedAt: new Date().toISOString(),
					latencyMs: Date.now() - startedAt,
					runtime,
					service: null,
					host: this.serviceName(),
					port: REDIS_INTERNAL_PORT,
					reachable: true,
					ping: null,
					redisVersion: null,
				},
			};
		}

		if (runtime === "unavailable") {
			return {
				healthy: false,
				detail: "Redis runtime unavailable (no active swarm, not managed) — no legacy container fallback.",
				payload: {
					checkedAt: new Date().toISOString(),
					latencyMs: Date.now() - startedAt,
					runtime,
					service: null,
					host: this.serviceName(),
					port: REDIS_INTERNAL_PORT,
					reachable: false,
					ping: null,
					redisVersion: null,
				},
			};
		}

		try {
			const svc = await this.dockerService.inspectSwarmService(this.serviceName());
			const tasks = await this.dockerService.listSwarmServiceTasks(this.serviceName()).catch(() => []);
			const running = (tasks as Array<{ Status?: { State?: string } }>).filter(
				(t) => t.Status?.State === "running",
			).length;
			return {
				healthy: running > 0,
				...(running > 0 ? {} : { detail: `Redis swarm service has ${String(running)} running tasks` }),
				payload: {
					checkedAt: new Date().toISOString(),
					latencyMs: Date.now() - startedAt,
					runtime,
					service: { id: svc.ID, name: svc.Spec.Name, runningTasks: running, exists: true },
					host: this.serviceName(),
					port: REDIS_INTERNAL_PORT,
					reachable: running > 0,
					ping: null,
					redisVersion: null,
				},
			};
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				healthy: false,
				detail: `Redis swarm service probe failed: ${message}`,
				payload: {
					checkedAt: new Date().toISOString(),
					latencyMs: Date.now() - startedAt,
					runtime,
					service: null,
					host: this.serviceName(),
					port: REDIS_INTERNAL_PORT,
					reachable: false,
					ping: null,
					redisVersion: null,
				},
			};
		}
	}
}
