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

import { BaseMultiSupervisorService, type AnyChildSupervisor } from "../base-multi-supervisor.service";
import {
	BaseSupervisorService,
	baseSupervisorPayloadSchema,
	type SupervisorProbeResult,
} from "../base-supervisor.service";
import {
	BaseDockerSupervisorService,
	type DockerSupervisorContainerSpec,
} from "@/core/modules/docker/services/base-docker-supervisor.service";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import {
	baseSupervisorProcessInfoSchema,
	dockerProcessInfoSchema,
} from "../supervisor-process-info";
import { EnvService } from "@/config/env/env.service";
import { splitManagedEnv } from "@repo/env";
import { PLATFORM_ROLE_LABEL, PlatformNetwork } from "../platform/traefik-supervisor.service";

export const DATABASE_SERVICE_SUPERVISOR_ID = "database-service";

/** Ownership marker — cleanup/inspection tooling keys off this label. */
const DATABASE_ROLE = "platform-database";

/** Internal Postgres port. */
export const DATABASE_POSTGRES_PORT = 5432;

/** Instance container name prefix. */
export const DATABASE_INSTANCE_PREFIX = "deployer-database";

const databaseInstancePayloadSchema = baseSupervisorPayloadSchema.extend({
	instance: z.string(),
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
	urlSafe: z.string(),
});
type DatabaseInstancePayload = z.output<typeof databaseInstancePayloadSchema>;

const databaseServicePayloadSchema = baseSupervisorPayloadSchema.extend({
	instances: z.array(z.string()),
	children: z.array(databaseInstancePayloadSchema),
});
type DatabaseServicePayload = z.output<typeof databaseServicePayloadSchema>;

const databaseInstanceProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: dockerProcessInfoSchema,
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

	protected buildContainerSpec(): DockerSupervisorContainerSpec {
		return {
			name: this.containerName,
			image: this.image,
			networkName: this.platformNetwork,
			env: [
				`POSTGRES_DB=${this.dbName}`,
				`POSTGRES_USER=${this.user}`,
				`POSTGRES_PASSWORD=${this.password}`,
			],
			binds: [`${this.dataVolume}:/var/lib/postgresql/data`],
			labels: {
				[PLATFORM_ROLE_LABEL]: DATABASE_ROLE,
				"deployer.database.instance": this.instanceName,
			},
			restartPolicy: "unless-stopped",
		};
	}

	protected async reconcile(): Promise<void> {
		await this.runWithBackoff(
			`Database instance '${this.instanceName}' convergence`,
			async () => {
				const spec = this.buildContainerSpec();
				const networkId = spec.networkName !== undefined ? await this.ensureNetwork(spec.networkName) : undefined;
				await this.ensureVolume(this.dataVolume);

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
					await this.removeContainerIfExists(spec.name);
					throw startError;
				}

				await this.verifyConvergence(spec);
			},
			{ maxAttempts: 3 },
		);
	}

	protected async probe(): Promise<SupervisorProbeResult<typeof databaseInstancePayloadSchema>> {
		const startedAt = Date.now();
		const spec = this.buildContainerSpec();
		const inspect = await this.inspectContainer(spec.name);
		const running = inspect !== null && inspect.State.Running;
		return {
			healthy: running,
			...(running ? {} : { detail: `Database instance '${this.instanceName}' is not running` }),
			payload: {
				checkedAt: new Date().toISOString(),
				latencyMs: Date.now() - startedAt,
				instance: this.instanceName,
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
				urlSafe: this.urlSafe,
			},
		};
	}

	protected buildDegradedPayload(detail: string): z.output<typeof databaseInstancePayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			instance: this.instanceName,
			container: null,
			urlSafe: this.urlSafe,
		};
	}

	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		const spec = this.buildContainerSpec();
		return {
			process: await this.describeDockerProcess(spec),
			name: this.containerName,
			urlSafe: this.urlSafe,
		};
	}

	private async verifyConvergence(spec: DockerSupervisorContainerSpec): Promise<void> {
		const live = await this.inspectContainer(spec.name);
		if (live === null || !live.State.Running) {
			throw new Error(`Database instance container '${spec.name}' did not start`);
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
		const allHealthy = childPayloads.length > 0 && childPayloads.every((p) => p.container?.running);
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