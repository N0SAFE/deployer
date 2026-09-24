/**
 * GlobalDbSupervisorService — supervises the LOCALLY-MANAGED global Postgres
 * container.
 *
 * Activation is driven by the persisted `node_config.databaseProvisioning`
 * marker:
 *
 *   - "local"    → the API spawned its own Postgres container (dockerode)
 *                  during setup. THIS supervisor takes over its ongoing
 *                  desired-state: ensure it exists/runs, report health.
 *   - "external" → the operator supplied an existing database URL. No
 *                  container is managed by this API, so the supervisor is
 *                  NOT registered (no supervision — the existing
 *                  DatabaseStartupGuard / DatabaseProbeService logic
 *                  applies instead).
 *   - null       → legacy/unknown — treated as external (no supervision).
 *
 * Registration is conditional: `onModuleInit` only publishes the instance
 * into the SupervisorOrchestratorService when the database is locally
 * managed, so external-database installs never see it in health reports.
 */

import { Injectable } from "@nestjs/common";
import { Pool } from "pg";
import z from "zod/v4";

import {
	BaseDockerSupervisorService,
} from "@/core/modules/docker/services/base-docker-supervisor.service";
import {
	resolveSupervisorRuntime,
	type DockerSupervisorRuntime,
} from "@/core/modules/docker/services/docker-supervisor-runtime";
import {
	BaseSupervisorService,
	baseSupervisorPayloadSchema,
	type SupervisorProbeResult,
} from "@repo/nest-supervisor-core/base-supervisor.service";
import {
	baseSupervisorProcessInfoSchema,
	dockerProcessInfoSchema,
	swarmProcessInfoSchema,
	type DockerProcessInfo,
} from "@repo/nest-supervisor-core/supervisor-process-info";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import {
	PostgresServiceProvisioner,
	MANAGED_POSTGRES_CONTAINER_NAME,
	MANAGED_POSTGRES_IMAGE,
	MANAGED_POSTGRES_PORT,
	MANAGED_POSTGRES_VOLUME_NAME,
	managedPostgresServiceName,
	type PostgresServiceIdentity,
} from "@/core/modules/docker/containers/postgres/postgres-service.provisioner";
import { MANAGED_POSTGRES_ALIAS } from "@/core/modules/docker/containers/postgres/postgres-service.provisioner";
import { NodeConfigRepository } from "@/core/modules/setup/repositories/node-config.repository";
import { EnvService } from "@repo/nest-env";
import { splitManagedEnv } from "@repo/env";
import type { SwarmServiceSpecInput } from "@repo/contracts-entities";

export const GLOBAL_DB_SUPERVISOR_ID = "global-db-postgres";

/**
 * Rich health payload — a DISCRIMINATED UNION on how the database is
 * provisioned:
 *
 *   - "managed"  → the API scheduled the database as a SWARM SERVICE: service
 *                  + task state, data-volume usage, published port.
 *   - "external" → operator-provided URL: real SELECT 1 probe + table count
 *                  and names (database health, not process health).
 *
 * Zod is the source of truth — `getHealth().payload` is validated at runtime.
 */
export const globalDbSupervisorPayloadSchema = z.discriminatedUnion("mode", [
	baseSupervisorPayloadSchema.extend({
		mode: z.literal("managed"),
		service: swarmProcessInfoSchema.shape.live.nullable(),
		volume: z
			.object({
				name: z.string(),
				mountpoint: z.string().nullable(),
				sizeBytes: z.number().int().min(0).nullable(),
			})
			.nullable(),
		publishedPort: z.number().int().min(1).nullable(),
	}),
	baseSupervisorPayloadSchema.extend({
		mode: z.literal("external"),
		select1: z.object({
			ok: z.boolean(),
			latencyMs: z.number().int().min(0).nullable(),
		}),
		tableCount: z.number().int().min(0),
		tables: z.array(z.string()),
		database: z.string(),
	}),
]);
export type GlobalDbSupervisorPayload = z.output<typeof globalDbSupervisorPayloadSchema>;

/**
 * Process info reported by the global-db supervisor through
 * `getProcessInfo()` — the managed Postgres SWARM SERVICE plus the connection
 * DSN consumers (or the operator) need to reach the database. The supervisor
 * only registers when the database is LOCALLY MANAGED, so `process` is always
 * the swarm flavor.
 */
export const globalDbProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: swarmProcessInfoSchema,
	connection: z.object({
		/** Full DSN (includes credentials) — for programmatic use by other
		 *  supervised processes that must connect to the database. */
		url: z.string(),
		/** Password-masked DSN — safe to display in tooling/UI. */
		urlSafe: z.string(),
		host: z.string(),
		port: z.number().int().min(1).nullable(),
		database: z.string(),
		user: z.string(),
	}),
});
export type GlobalDbProcessInfo = z.output<typeof globalDbProcessInfoSchema>;

@Injectable()
export class GlobalDbSupervisorService extends BaseDockerSupervisorService<
	typeof globalDbSupervisorPayloadSchema,
	typeof globalDbProcessInfoSchema
> {
	static readonly identifier = GLOBAL_DB_SUPERVISOR_ID;
	readonly description = "Global Postgres database (locally-managed container or provided URL)";

	readonly payloadSchema = globalDbSupervisorPayloadSchema;
	readonly processInfoSchema = globalDbProcessInfoSchema;

	constructor(
		dockerService: DockerService,
		private readonly provisioner: PostgresServiceProvisioner,
		private readonly nodeConfigRepository: NodeConfigRepository,
		private readonly env: EnvService,
	) {
		super(dockerService);
	}

	/**
 * Register + converge ONLY when its dependencies are present:
 *   - the database is NOT compose-managed (`MANAGED_GLOBAL_DB_ENABLED`
 *     must NOT be true — when the deployment owns Postgres the API must not
 *     supervise it, the supervisor is skipped entirely),
 *   - a real DATABASE URL exists in local node_config (written by the setup
 *     wizard / dev bootstrap at boot — NOT available in early onModuleInit),
 *   - the database is locally-managed ("local" provisioning) — external DBs
 *     keep the guard/probe path and must NOT be supervised.
 *
 * Registration is the supervisor's OWN decision: `onModuleInit` reads the
 * current state once. When the deps are not ready yet, the operator retries
 * from the dev console once setup completes (no orchestrator polling).
 */
async onModuleInit(): Promise<void> {
	if (this.isComposeManaged()) {
		this.logger.log("Compose-managed global DB detected (MANAGED_GLOBAL_DB_ENABLED=true) — supervisor skipped (not registered)");
		return;
	}
	if (!(await this.depsReady())) {
		this.logger.log("Global-db dependencies not ready (no database URL) — skipping registration (retry from dev console after setup)");
		return;
	}
	if (await this.isManagedDatabase()) {
		this.logger.log("Locally-managed database detected — Postgres supervisor active");
		super.onModuleInit();
	} else {
		this.logger.log("Externally-managed database — Postgres supervisor disabled (not registered)");
	}
}

/** True when the deployment owns the global Postgres (dev compose stack) — the
 *  API never spawns/supervises it, the URL comes from managed.globalDb.*. */
private isComposeManaged(): boolean {
	return splitManagedEnv(this.env).globalDb.enabled === true;
}

/** Dependencies for the global-db supervisor: a real DATABASE URL has been
 *  written to local node_config (setup wizard / dev bootstrap completed). */
private async depsReady(): Promise<boolean> {
	try {
		const config = this.nodeConfigRepository.find();
		return Boolean(config?.databaseUrl?.trim());
	} catch {
		return false;
	}
}

	/** Resolve the current runtime (async: real engine probe). Global-DB is
	 *  mesh-wide → swarm-replicated in prod; container pre-swarm. */
	protected async resolveRuntime(): Promise<{ runtime: DockerSupervisorRuntime; reason: string }> {
		return resolveSupervisorRuntime({
			managed: this.isComposeManaged(),
			rawRuntime: process.env.SUPERVISOR_RUNTIME,
			swarmActive: await this.isSwarmActive(),
			scope: "mesh-wide",
		});
	}

	/** Current runtime. */
	private async effectiveRuntime(): Promise<DockerSupervisorRuntime> {
		return (await this.resolveRuntime()).runtime;
	}

	/** Swarm service name for the global Postgres (overlay DNS name). */
	private serviceName(): string {
		return managedPostgresServiceName(this.env.get("DEPLOYER_PREFIX"));
	}

	/** Swarm service spec for the mesh-wide platform Postgres. The desired
	 *  state is owned by `PostgresServiceProvisioner` (setup provisions the very
	 *  first instance through the same builder), so the supervisor delegates
	 *  instead of duplicating the spec. */
	protected buildSwarmSpec(): SwarmServiceSpecInput {
		return this.provisioner.buildSpec({
			prefix: this.env.get("DEPLOYER_PREFIX"),
			identity: this.identity(),
		});
	}

	/** Credentials + image of the managed database, resolved from the env. */
	private identity(): PostgresServiceIdentity {
		return {
			databaseName: this.env.get("DB_DATABASE") ?? "deployer",
			username: this.env.get("DB_USER") ?? "deployer",
			password: this.env.get("DB_PASSWORD") ?? "deployer",
			image: MANAGED_POSTGRES_IMAGE,
		};
	}
	/** One idempotent convergence pass towards the desired state. */
	protected async reconcile(): Promise<void> {
		// Defensive: unregistered supervisors never run, but the orchestration
		// layer can be asked to ensure all — never touch an external DB.
		if (!(await this.isManagedDatabase())) return;

		const runtime = await this.effectiveRuntime();

		if (runtime === "managed") {
			// Managed mode: compose/operator owns postgres — link-only wiring.
			this.logger.log("Global-DB managed (compose/operator) — link-only wiring active");
			return;
		}

		if (runtime === "unavailable") {
			// No active swarm → nowhere to schedule Postgres. Surface the cause
			// instead of silently running a second, container-based copy.
			throw new Error(
				"Global Postgres requires an active swarm engine or managed (compose/operator) ownership — " +
					"no legacy container fallback. SwarmBootstrapService should have converged the engine.",
			);
		}

		// swarm-replicated
		await this.runWithBackoff(
			"Postgres (swarm) convergence",
			async () => {
				// Clean the container-era incarnation an older install left
				// behind — swarm owns the database now.
				await this.removeContainerIfExists(MANAGED_POSTGRES_CONTAINER_NAME);
				const spec = this.provisioner.attachOverlay(
					this.buildSwarmSpec(),
					this.env.get("DEPLOYER_PREFIX"),
				);
				await this.provisioner.ensureOverlay(this.env.get("DEPLOYER_PREFIX"));
				await this.reconcileSwarmService(spec);
				await this.verifySwarmConvergence(spec.name);
			},
			{ maxAttempts: 3 },
		);
	}

	/** Verify the swarm service exists after converge. */
	private async verifySwarmConvergence(name: string): Promise<void> {
		const svc = await this.dockerService.inspectSwarmService(name);
		if (svc.ID) return;
		throw new Error(`Global-DB swarm service '${name}' was not created`);
	}

	/**
	 * REAL health observation. Discriminates on the database provisioning:
	 * managed → container/volume/port measurements; external → SELECT 1 +
	 * table listing. Never throws for an unhealthy database — the payload
	 * records exactly what failed.
	 */
	protected async probe(): Promise<SupervisorProbeResult<typeof globalDbSupervisorPayloadSchema>> {
		const startedAt = Date.now();
		const managed = await this.isManagedDatabase();

		if (!managed) {
			const external = await this.probeExternal();
			return {
				healthy: external.select1.ok,
				detail: external.select1.ok
					? `database reachable (${String(external.tableCount)} tables in "${external.database}")`
					: "database unreachable — SELECT 1 failed",
				payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, ...external },
			};
		}

		const managedPayload = await this.probeManaged();
		const runningTasks = managedPayload.service?.runningTasks ?? 0;
		const serviceExists = managedPayload.service?.exists === true;
		const healthy = serviceExists && runningTasks > 0;
		return {
			healthy,
			detail: healthy
				? `managed Postgres service running (tasks=${String(runningTasks)}, host :${String(managedPayload.publishedPort ?? "?")}, volume ${String(managedPayload.volume?.sizeBytes ?? "?")} B)`
				: serviceExists
					? `managed Postgres service exists but has no running task (tasks=${String(runningTasks)})`
					: "managed Postgres swarm service missing",
			payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, ...managedPayload },
		};
	}

	/** Payload shape when the probe mechanism itself fails (docker socket / pg down hard). */
	protected buildDegradedPayload(detail: string): z.output<typeof globalDbSupervisorPayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			mode: "external",
			select1: { ok: false, latencyMs: null },
			tableCount: 0,
			tables: [],
			database: "unknown",
		};
	}

	/**
	 * The entire config + live state of the managed Postgres process plus the
	 * connection DSN (full + display-safe) from the persisted database URL.
	 */
	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		return {
			process: await this.describeSwarmProcess(this.buildSwarmSpec()),
			connection: GlobalDbSupervisorService.parsePostgresUrl(this.databaseUrl()),
		};
	}

	/** The persisted database DSN (also used by the boot chain). Empty when
	 *  nothing was written yet — reported as-is; consumers gate on it. */
	private databaseUrl(): string {
		try {
			return this.nodeConfigRepository.find()?.databaseUrl ?? "";
		} catch {
			return "";
		}
	}

	/** Parse a postgres DSN into the connection fields reported to consumers
	 *  (host, port, database, user + a display-safe masked DSN). */
	private static parsePostgresUrl(url: string): {
		url: string;
		urlSafe: string;
		host: string;
		port: number | null;
		database: string;
		user: string;
	} {
		if (url === "") return { url, urlSafe: "", host: "unknown", port: null, database: "unknown", user: "unknown" };
		try {
			const parsed = new URL(url);
			const host = parsed.hostname !== "" ? parsed.hostname : "localhost";
			const port = parsed.port !== "" ? Number(parsed.port) : null;
			const database = parsed.pathname.replace(/^\//, "") || "postgres";
			const user = parsed.username !== "" ? parsed.username : "unknown";
			return {
				url,
				urlSafe: url.replace(/:[^@/]+@/, ":***@"),
				host,
				port: port !== null && Number.isInteger(port) && port >= 1 ? port : null,
				database,
				user,
			};
		} catch {
			return { url, urlSafe: url, host: "unknown", port: null, database: "unknown", user: "unknown" };
		}
	}

	// ─── Managed branch ──────────────────────────────────────────────────────

	/**
	 * Measure the locally-managed Postgres SWARM SERVICE + data volume +
	 * published port. A service whose inspect fails is reported as absent
	 * (exists=false) rather than throwing — the payload records the failure.
	 */
	private async probeManaged(): Promise<{
		mode: "managed";
		service: {
			serviceId: string | null;
			exists: boolean | null;
			createdAt: string | null;
			updatedAt: string | null;
			serviceName: string | null;
			runningTasks: number | null;
			totalTasks: number | null;
		} | null;
		volume: { name: string; mountpoint: string | null; sizeBytes: number | null } | null;
		publishedPort: number | null;
	}> {
		const name = this.serviceName();
		let service: {
			serviceId: string | null;
			exists: boolean | null;
			createdAt: string | null;
			updatedAt: string | null;
			serviceName: string | null;
			runningTasks: number | null;
			totalTasks: number | null;
		} | null = null;

		try {
			const info = await this.dockerService.inspectSwarmService(name);
			const tasks = await this.dockerService.listSwarmServiceTasks(name).catch(() => []);
			service = {
				serviceId: info.ID ?? null,
				exists: true,
				createdAt: info.CreatedAt ?? null,
				updatedAt: info.UpdatedAt ?? null,
				serviceName: info.Spec.Name ?? null,
				runningTasks: tasks.filter((task) => task.Status.State === "running").length,
				totalTasks: tasks.length,
			};
		} catch {
			// Service absent (404) or engine not a manager — reported as absent.
			service = null;
		}

		const published = this.buildSwarmSpec().endpointPorts[0]?.publishedPort ?? null;

		// Data-volume usage (Size may be null until docker has COW stats).
		const docker = this.dockerService.getDockerClient();
		const volumeInspect = await docker.getVolume(MANAGED_POSTGRES_VOLUME_NAME).inspect().catch(() => null);
		const volume = volumeInspect
			? {
					name: MANAGED_POSTGRES_VOLUME_NAME,
					mountpoint: (volumeInspect as unknown as { Mountpoint?: string }).Mountpoint ?? null,
					sizeBytes:
						((volumeInspect as unknown as { UsageData?: { Size?: number } }).UsageData?.Size ?? null),
				}
			: null;

		return { mode: "managed" as const, service, volume, publishedPort: published };
	}

	// ─── External branch ─────────────────────────────────────────────────────

	/** SELECT 1 + table listing against the provided database URL. */
	private async probeExternal(): Promise<{
		mode: "external";
		select1: { ok: boolean; latencyMs: number | null };
		tableCount: number;
		tables: string[];
		database: string;
	}> {
		const config = this.nodeConfigRepository.find();
		const databaseUrl = config?.databaseUrl?.trim() ?? "";
		const database = databaseUrl.split("/").pop() ?? "unknown";

		if (!databaseUrl) {
			return {
				mode: "external",
				select1: { ok: false, latencyMs: null },
				tableCount: 0,
				tables: [],
				database,
			};
		}

		const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000 });
		try {
			const t0 = Date.now();
			await pool.query("SELECT 1");
			const latencyMs = Date.now() - t0;

			const tablesRes = await pool.query<{ table_name: string }>(
				`SELECT table_name FROM information_schema.tables
				 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
				 ORDER BY table_name`,
			);
			const tables = tablesRes.rows.map((r) => r.table_name);
			return {
				mode: "external",
				select1: { ok: true, latencyMs },
				tableCount: tables.length,
				tables,
				database,
			};
		} catch {
			return {
				mode: "external",
				select1: { ok: false, latencyMs: null },
				tableCount: 0,
				tables: [],
				database,
			};
		} finally {
			await pool.end().catch(() => undefined);
		}
	}

	/** True only when this node manages its own Postgres container. */
	private async isManagedDatabase(): Promise<boolean> {
		return this.nodeConfigRepository.find()?.databaseProvisioning === "local";
	}
}