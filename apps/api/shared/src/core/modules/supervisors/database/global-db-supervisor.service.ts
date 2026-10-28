import { runSyncUnwrapped } from "@deployer/effect-core";
import { Injectable, Inject } from "@nestjs/common";
import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { NodeConfigRepository, type NodeConfigRepositoryShape } from "@deployer/node-state"
import { SupervisorHost } from "../../supervision/index";
import { MANAGED_POSTGRES_IMAGE } from "@deployer/docker";
import { splitManagedEnv } from "@deployer/env";
import {
	GLOBAL_DB_SUPERVISOR_ID,
	globalDbProcessInfoSchema,
	globalDbSupervisorPayloadSchema,
	makeGlobalDbSupervisor,
	type GlobalDbSupervisor,
} from "@deployer/platform-supervisors";

import { EnvService } from "../../../../config/env/env.module";

export { GLOBAL_DB_SUPERVISOR_ID };

/**
 * The Nest host of the global Postgres supervisor. What it does (schedule the managed Postgres as a
 * swarm service, observe it or an external database) is `@deployer/platform-supervisors`; this class
 * supplies the engine, the environment and the node config, and decides WHETHER to register.
 *
 * Registration is the supervisor's own decision, made once from `onModuleInit`: only when the database
 * is not compose-managed, a database URL exists in the local node config, and it is locally managed
 * (`databaseProvisioning: "local"`). External databases keep the startup guard / probe path and are
 * never supervised, so they never appear in health reports.
 */
@Injectable()
export class GlobalDbSupervisorService extends SupervisorHost<
	typeof globalDbSupervisorPayloadSchema,
	typeof globalDbProcessInfoSchema
> {
	static readonly identifier = GLOBAL_DB_SUPERVISOR_ID;

	readonly payloadSchema = globalDbSupervisorPayloadSchema;
	readonly processInfoSchema = globalDbProcessInfoSchema;
	readonly description: string;

	private readonly globalDb: GlobalDbSupervisor;

	constructor(
		@Inject(DockerEngine) dockerService: DockerEngineShape,
		@Inject(NodeConfigRepository) private readonly nodeConfigRepository: NodeConfigRepositoryShape,
		private readonly env: EnvService,
	) {
		super();
		this.globalDb = makeGlobalDbSupervisor({
			engine: dockerService,
			logger: this.logger,
			config: {
				prefix: () => this.env.get("DEPLOYER_PREFIX"),
				identity: () => ({
					databaseName: this.env.get("DB_DATABASE") ?? "deployer",
					username: this.env.get("DB_USER") ?? "deployer",
					password: this.env.get("DB_PASSWORD") ?? "deployer",
					image: MANAGED_POSTGRES_IMAGE,
				}),
				composeManaged: () => this.isComposeManaged(),
				runtimeOverride: () => process.env.SUPERVISOR_RUNTIME,
				provisioning: () => runSyncUnwrapped(this.nodeConfigRepository.find())?.databaseProvisioning,
				databaseUrl: () => this.persistedDatabaseUrl(),
			},
		});
		this.description = this.globalDb.spec.description;
	}

	protected buildSpec(): GlobalDbSupervisor["spec"] {
		return this.globalDb.spec;
	}

	/** Registers only when the dependencies are present and the database is locally managed. */
	onModuleInit(): void {
		if (this.isComposeManaged()) {
			this.logger.log("Compose-managed global DB detected (MANAGED_GLOBAL_DB_ENABLED=true) — supervisor skipped (not registered)");
			return;
		}
		if (!this.depsReady()) {
			this.logger.log("Global-db dependencies not ready (no database URL) — skipping registration (retry from dev console after setup)");
			return;
		}
		if (runSyncUnwrapped(this.nodeConfigRepository.find())?.databaseProvisioning === "local") {
			this.logger.log("Locally-managed database detected — Postgres supervisor active");
			super.onModuleInit();
		} else {
			this.logger.log("Externally-managed database — Postgres supervisor disabled (not registered)");
		}
	}

	/** True when the deployment owns the global Postgres (dev compose stack): the API never spawns or supervises it. */
	private isComposeManaged(): boolean {
		return splitManagedEnv(this.env).globalDb.enabled;
	}

	/** A real DATABASE URL has been written to the local node config (setup wizard or dev bootstrap completed). */
	private depsReady(): boolean {
		try {
			return Boolean(runSyncUnwrapped(this.nodeConfigRepository.find())?.databaseUrl?.trim());
		} catch {
			return false;
		}
	}

	/** The persisted DSN; empty when nothing was written yet, which consumers gate on. */
	private persistedDatabaseUrl(): string {
		try {
			return runSyncUnwrapped(this.nodeConfigRepository.find())?.databaseUrl ?? "";
		} catch {
			return "";
		}
	}
}
