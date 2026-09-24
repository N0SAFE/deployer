/**
 * DatabaseServiceSupervisorService — the DATABASE SERVICE PRIMITIVE.
 *
 * A database service is a SCALED set of managed Postgres instances. Each
 * instance is a container named `deployer-database-<instance>` with its own
 * data volume (`deployer-database-data-<instance>`) attached to the platform
 * network (and the drizzle-gateway reachable overlays) under an ALIAS equal
 * to the instance name — so drizzle-gateway (and any service on the private
 * network) connects to `postgresql://user:pass@db-<instance>:5432/db`.
 *
 * Scaling:
 *   - instance list comes from `MANAGED_DATABASE_INSTANCES` ("db-a,db-b").
 *   - the multi-instance base reconciles one child supervisor per instance in
 *     PARALLEL (scale up adds, scale down removes via `removeStaleChildren`).
 *
 * External management:
 *   - `MANAGED_DATABASE_ENABLED=true` → the deployment (compose/operator) owns
 *     the instance containers (compose declares `deployer-database-*`) — this
 *     supervisor skips registration; consumers use `managed.database.*`.
 */

import { Injectable } from "@nestjs/common";
import z from "zod/v4";

import { BaseMultiSupervisorService, type AnyChildSupervisor } from "@repo/nest-supervisor-core/base-multi-supervisor.service";
import {
	BaseSupervisorService,
	baseSupervisorPayloadSchema,
	type SupervisorProbeResult,
} from "@repo/nest-supervisor-core/base-supervisor.service";
import { BaseDockerSupervisorService } from "@/core/modules/docker/services/base-docker-supervisor.service";
import {
	resolveSupervisorRuntime,
	type DockerSupervisorRuntime,
} from "@/core/modules/docker/services/docker-supervisor-runtime";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import {
	baseSupervisorProcessInfoSchema,
	swarmProcessInfoSchema,
} from "@repo/nest-supervisor-core/supervisor-process-info";
import type { SwarmServiceSpecInput } from "@repo/contracts-entities";
import { EnvService } from "@/config/env/env.module";
import { splitManagedEnv } from "@repo/env";
import { PLATFORM_ROLE_LABEL, PlatformNetwork } from "../platform/traefik-supervisor.service";
import { AppError, ConflictError } from "@repo/errors";

export const DATABASE_SERVICE_SUPERVISOR_ID = "database-service";

/** Ownership marker — cleanup/inspection tooling keys off this label. */
const DATABASE_ROLE = "platform-database";

/** Internal Postgres port. */
export const DATABASE_POSTGRES_PORT = 5432;

/** Instance container name prefix. */
export const DATABASE_INSTANCE_PREFIX = "deployer-database";

const databaseInstancePayloadSchema = baseSupervisorPayloadSchema.extend({
	instance: z.string(),
	/** Live view of the instance's swarm service (null when absent). */
	service: swarmProcessInfoSchema.shape.live.nullable(),
	urlSafe: z.string(),
});
type DatabaseInstancePayload = z.output<typeof databaseInstancePayloadSchema>;

const databaseServicePayloadSchema = baseSupervisorPayloadSchema.extend({
	instances: z.array(z.string()),
	children: z.array(databaseInstancePayloadSchema),
});
type DatabaseServicePayload = z.output<typeof databaseServicePayloadSchema>;

const databaseInstanceProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: swarmProcessInfoSchema,
	name: z.string(),
	urlSafe: z.string(),
});
type DatabaseInstanceProcessInfo = z.output<typeof databaseInstanceProcessInfoSchema>;

const databaseServiceProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	instances: z.array(z.string()),
	children: z.array(databaseInstanceProcessInfoSchema),
});
type DatabaseServiceProcessInfo = z.output<typeof databaseServiceProcessInfoSchema>;

/** Child supervisor: ONE Postgres instance container (self-contained spec). */
class DatabaseInstanceSupervisor extends BaseDockerSupervisorService<
	typeof databaseInstancePayloadSchema,
	typeof databaseInstanceProcessInfoSchema
> {
	static readonly identifier = DATABASE_SERVICE_SUPERVISOR_ID;
	readonly description = "Database service instance";

	readonly payloadSchema = databaseInstancePayloadSchema;
	readonly processInfoSchema = databaseInstanceProcessInfoSchema;

	private readonly instanceName: string;
	private readonly instanceAlias: string;
	private readonly image: string;
	private readonly user: string;
	private readonly password: string;
	private readonly dbName: string;
	private readonly dataVolumeBase: string;
	private readonly platformNetwork: string;

	constructor(
		dockerService: DockerService,
		env: EnvService,
		instanceName: string,
	) {
		super(dockerService);
		const managed = splitManagedEnv(env).database;
		this.instanceName = instanceName;
		this.instanceAlias = instanceName.replace(/[^a-zA-Z0-9_-]/g, "");
		this.image = managed.image ?? "postgres:16-alpine";
		this.user = managed.user ?? "deployer";
		this.password = managed.password ?? "deployer";
		this.dbName = managed.name ?? "deployer";
		this.dataVolumeBase = managed.dataVolumeBase ?? "deployer-database-data";
		const prefix = env.get("DEPLOYER_PREFIX") ?? "";
		this.platformNetwork = PlatformNetwork.name(prefix);
	}

	/** Container name: deployer-database-<instance>. */
	get containerName(): string {
		return `${DATABASE_INSTANCE_PREFIX}-${this.instanceAliaSafe}`;
	}

	private get instanceAliaSafe(): string {
		return this.instanceAlias;
	}

	/** The connection URL consumers use (by alias over the private network). */
	get urlSafe(): string {
		return `postgresql://${this.user}:*****@${this.instanceAlias}:${DATABASE_POSTGRES_PORT}/${this.dbName}`;
	}

	private get dataVolume(): string {
		return `${this.dataVolumeBase}-${this.instanceAlias}`;
	}

	/** Swarm SERVICE name for this instance (same DNS alias consumers use). */
	private get serviceName(): string {
		return `${DATABASE_INSTANCE_PREFIX}-${this.instanceAlias}`;
	}

	/** Runtime: mesh-wide → swarm-replicated (instance reachable by alias). */
	private async effectiveRuntime(): Promise<DockerSupervisorRuntime> {
		return (
			await resolveSupervisorRuntime({
				managed: false,
				rawRuntime: process.env.SUPERVISOR_RUNTIME,
				swarmActive: await this.isSwarmActive(),
				scope: "mesh-wide",
			})
		).runtime;
	}

	/**
	 * Desired swarm spec for ONE database-service instance.
	 *
	 * REPLICATED (not global): each instance is a single logical database.
	 * The instance NAME is registered as the network alias — consumers connect
	 * with `postgresql://…@db-<instance>:5432/…`, so the alias, not the service
	 * name, is the contract the URL depends on.
	 */
	protected buildSwarmSpec(): SwarmServiceSpecInput {
		return {
			name: this.serviceName,
			image: this.image,
			mode: "replicated",
			replicas: 1,
			env: [
				`POSTGRES_DB=${this.dbName}`,
				`POSTGRES_USER=${this.user}`,
				`POSTGRES_PASSWORD=${this.password}`,
			],
			command: [],
			args: [],
			labels: {
				[PLATFORM_ROLE_LABEL]: DATABASE_ROLE,
				"deployer.database.instance": this.instanceName,
			},
			containerLabels: {},
			mounts: [{ type: "volume", source: this.dataVolume, target: "/var/lib/postgresql/data", readOnly: false }],
			placementPreferences: [],
			placementConstraints: [],
			resourcesLimits: {},
			resourcesReservations: {},
			networks: [],
			healthcheck: {
				test: ["CMD-SHELL", `pg_isready -U ${this.user} -d ${this.dbName}`],
				intervalMs: 5_000,
				timeoutMs: 5_000,
				retries: 12,
				startPeriodMs: 5_000,
			},
			updateConfig: { parallelism: 1, delayMs: 0, order: "start-first", failureAction: "rollback" },
			// A database must checkpoint on shutdown — SIGKILL corrupts it.
			stopGracePeriodSeconds: 60,
			endpointPorts: [],
		};
	}

	/** One idempotent convergence pass: overlay → volume → converge the service. */
	protected async reconcile(): Promise<void> {
		const runtime = await this.effectiveRuntime();
		if (runtime === "unavailable") {
			throw new AppError(
				`Database instance '${this.instanceName}' requires an active swarm engine (no container fallback) — SwarmBootstrapService should have converged the engine`,
				"SWARM_UNAVAILABLE",
				{ supervisor: "database-service", instance: this.instanceName },
			);
		}
		if (runtime === "managed") {
			// The deployment owns this instance — nothing to converge.
			return;
		}

		await this.runWithBackoff(
			`Database instance '${this.instanceName}' convergence`,
			async () => {
				await this.ensureVolume(this.dataVolume);
				const overlay = await this.ensureSwarmNetwork(this.platformNetwork);
				const spec = this.buildSwarmSpec();
				// The instance NAME is the DNS contract (`db-<instance>`).
				this.attachOverlay(spec, overlay, [this.instanceAlias, spec.name]);
				await this.reconcileSwarmService(spec);
				await this.verifySwarmService(spec.name);
			},
			{ maxAttempts: 3 },
		);
	}

	/** The instance service's live state (exists + running task count). */
	private async serviceLive(
		name: string,
	): Promise<{ serviceId: string | null; exists: boolean; runningTasks: number; totalTasks: number }> {
		try {
			const service = await this.dockerService.inspectSwarmService(name);
			const tasks = await this.dockerService.listSwarmServiceTasks(name).catch(() => []);
			return {
				serviceId: service.ID ?? null,
				exists: true,
				runningTasks: tasks.filter((task) => task.Status.State === "running").length,
				totalTasks: tasks.length,
			};
		} catch {
			return { serviceId: null, exists: false, runningTasks: 0, totalTasks: 0 };
		}
	}

	protected async probe(): Promise<SupervisorProbeResult<typeof databaseInstancePayloadSchema>> {
		const startedAt = Date.now();
		const name = this.serviceName;
		const live = await this.serviceLive(name);
		const running = live.runningTasks > 0;
		return {
			healthy: running,
			...(running ? {} : { detail: `Database instance '${this.instanceName}' is not running` }),
			payload: {
				checkedAt: new Date().toISOString(),
				latencyMs: Date.now() - startedAt,
				instance: this.instanceName,
				service: live.exists
					? {
							serviceId: live.serviceId,
							exists: true,
							createdAt: null,
							updatedAt: null,
							serviceName: name,
							runningTasks: live.runningTasks,
							totalTasks: live.totalTasks,
						}
					: null,
				urlSafe: this.urlSafe,
			},
		};
	}

	protected buildDegradedPayload(detail: string): z.output<typeof databaseInstancePayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			instance: this.instanceName,
			service: null,
			urlSafe: this.urlSafe,
		};
	}

	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		const spec = this.buildSwarmSpec();
		return {
			process: await this.describeSwarmProcess(spec),
			name: this.serviceName,
			urlSafe: this.urlSafe,
		};
	}

	private async verifySwarmService(name: string): Promise<void> {
		const service = await this.dockerService.inspectSwarmService(name);
		if (service.ID === undefined || service.ID === "") {
			throw new ConflictError(`database instance service '${name}'`, "was not created");
		}
	}
}

@Injectable()
export class DatabaseServiceSupervisorService extends BaseMultiSupervisorService<
	string,
	typeof databaseServicePayloadSchema
> {
	static readonly identifier = DATABASE_SERVICE_SUPERVISOR_ID;
	readonly description =
		"Database service primitive (scaled managed Postgres instances, reachable by alias over the private mesh)";

	readonly payloadSchema = databaseServicePayloadSchema;
	readonly childrenPayloadSchema = databaseServicePayloadSchema;
	readonly processInfoSchema = databaseServiceProcessInfoSchema;

	constructor(
		private readonly dockerService: DockerService,
		private readonly env: EnvService,
	) {
		super();
	}

	/** Instance names from MANAGED_DATABASE_INSTANCES ("db-a,db-b"). */
	private desiredInstances(): string[] {
		const managed = splitManagedEnv(this.env).database;
		const raw = managed.instances ?? "";
		const names = raw.split(",").map((s) => s.trim()).filter(Boolean);
		// Dedupe while preserving order.
		return [...new Set(names)];
	}

	/**
	 * External management: MANAGED_DATABASE_ENABLED=true → compose owns the
	 * instance containers → skip registration.
	 */
	override async onModuleInit(): Promise<void> {
		const managed = splitManagedEnv(this.env).database;
		if (managed.enabled) {
			this.logger.log("Externally-managed database service detected (MANAGED_DATABASE_ENABLED=true) — supervisor skipped");
			return;
		}
		if (this.desiredInstances().length === 0) {
			this.logger.log("No database service instances configured (MANAGED_DATABASE_INSTANCES) — supervisor not registered");
			return;
		}
		super.onModuleInit();
	}

	protected async enumerateInstanceKeys(): Promise<string[]> {
		return this.desiredInstances();
	}

	protected buildInstance(key: string): AnyChildSupervisor {
		return new DatabaseInstanceSupervisor(this.dockerService, this.env, key);
	}

	protected async reconcile(): Promise<void> {
		const desired = this.desiredInstances();
		const previous = this.activeKeys ?? [];
		// Scale down: remove children whose key is no longer desired.
		this.removeStaleChildren(desired, previous, (key) => {
			this.logger.log(`Database instance '${key}' scaled down — removing`);
			// Best-effort container removal (data volume persists).
			const child = new DatabaseInstanceSupervisor(this.dockerService, this.env, key);
			void child.ensureDesiredState();
		});
		await this.runReconcileChildren();
	}

	protected async probe(): Promise<SupervisorProbeResult<typeof databaseServicePayloadSchema>> {
		const startedAt = Date.now();
		const instances = this.desiredInstances();
		const childSnapshots = await this.runProbeChildren();
		const childPayloads = childSnapshots
			.map((s) => (s as { payload?: DatabaseInstancePayload }).payload)
			.filter((p): p is DatabaseInstancePayload => p !== undefined);
		const allHealthy =
			childPayloads.length > 0 && childPayloads.every((p) => (p.service?.runningTasks ?? 0) > 0);
		return {
			healthy: allHealthy,
			...(allHealthy ? {} : { detail: "one or more database instances not running" }),
			payload: {
				checkedAt: new Date().toISOString(),
				latencyMs: Date.now() - startedAt,
				instances,
				children: childPayloads,
			},
		};
	}

	protected buildDegradedPayload(detail: string): z.output<typeof databaseServicePayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			instances: this.desiredInstances(),
			children: [],
		};
	}

	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		const instances = this.desiredInstances();
		const childInfos = await Promise.all(
			instances.map(async (key) => {
				const child = new DatabaseInstanceSupervisor(this.dockerService, this.env, key);
				return await child.getProcessInfo();
			}),
		);
		return {
			instances,
			children: childInfos,
		};
	}
}