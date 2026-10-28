import { Injectable, Inject } from "@nestjs/common";
import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { SupervisorHost } from "../../supervision/index";
import { splitManagedEnv } from "@deployer/env";
import {
	DATABASE_SERVICE_SUPERVISOR_ID,
	databaseServicePayloadSchema,
	databaseServiceProcessInfoSchema,
	makeDatabaseServiceSupervisor,
	type DatabaseServiceSupervisor,
} from "@deployer/platform-supervisors";

import { EnvService } from "../../../../config/env/env.module";

export { DATABASE_SERVICE_SUPERVISOR_ID };

/**
 * The Nest host of the database service primitive (a scaled set of managed Postgres instances). What
 * it does (one replicated swarm service per instance, scale up and down, an aggregate probe) is
 * `@deployer/platform-supervisors`; this class supplies the engine and the `MANAGED_DATABASE_*`
 * environment, and decides WHETHER to register: not when the deployment owns the instances
 * (`MANAGED_DATABASE_ENABLED=true`), and not when none are configured.
 */
@Injectable()
export class DatabaseServiceSupervisorService extends SupervisorHost<
	typeof databaseServicePayloadSchema,
	typeof databaseServiceProcessInfoSchema
> {
	static readonly identifier = DATABASE_SERVICE_SUPERVISOR_ID;

	readonly payloadSchema = databaseServicePayloadSchema;
	readonly processInfoSchema = databaseServiceProcessInfoSchema;
	readonly description: string;

	private readonly databaseService: DatabaseServiceSupervisor;

	constructor(
		@Inject(DockerEngine) dockerService: DockerEngineShape,
		private readonly env: EnvService,
	) {
		super();
		this.databaseService = makeDatabaseServiceSupervisor({
			engine: dockerService,
			logger: this.logger,
			config: {
				instances: () => this.desiredInstances(),
				prefix: () => this.env.get("DEPLOYER_PREFIX") ?? "",
				runtimeOverride: () => process.env.SUPERVISOR_RUNTIME,
				settings: () => splitManagedEnv(this.env).database,
			},
		});
		this.description = this.databaseService.spec.description;
	}

	protected buildSpec(): DatabaseServiceSupervisor["spec"] {
		return this.databaseService.spec;
	}

	/** Instance names from `MANAGED_DATABASE_INSTANCES` ("db-a,db-b"), trimmed and without duplicates. */
	private desiredInstances(): string[] {
		const raw = splitManagedEnv(this.env).database.instances ?? "";
		return [...new Set(raw.split(",").map((name) => name.trim()).filter(Boolean))];
	}

	override onModuleInit(): void {
		if (splitManagedEnv(this.env).database.enabled) {
			this.logger.log("Externally-managed database service detected (MANAGED_DATABASE_ENABLED=true) — supervisor skipped");
			return;
		}
		if (this.desiredInstances().length === 0) {
			this.logger.log("No database service instances configured (MANAGED_DATABASE_INSTANCES) — supervisor not registered");
			return;
		}
		super.onModuleInit();
	}
}

