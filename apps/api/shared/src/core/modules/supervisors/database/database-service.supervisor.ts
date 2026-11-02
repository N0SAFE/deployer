import { Logger } from "@nestjs/common";
import { Effect } from "effect";

import type { DockerEngineShape } from "@deployer/docker";
import { splitManagedEnv } from "@deployer/env";
import {
	DATABASE_SERVICE_SUPERVISOR_ID,
	
	
	makeDatabaseServiceSupervisor,
	
} from "@deployer/platform-supervisors";

import { EnvService } from "../../../../config/env/env.module";
import { buildSupervisor, type SupervisorEventBus, type SupervisorRegistration } from "../../supervision/index";

export { DATABASE_SERVICE_SUPERVISOR_ID };

export type DatabaseServiceSupervisorDeps = {
	readonly engine: DockerEngineShape;
	readonly env: EnvService;
	readonly bus: SupervisorEventBus;
};

/** Instance names from `MANAGED_DATABASE_INSTANCES` ("db-a,db-b"), trimmed and without duplicates. */
const desiredInstances = (env: EnvService): string[] => {
	const raw = splitManagedEnv(env).database.instances ?? "";
	return [...new Set(raw.split(",").map((name) => name.trim()).filter(Boolean))];
};

/** The scaled Postgres instances' supervisor; registers only when this deployment owns them and some are configured. */
export function makeDatabaseServiceRegistration({ engine, env, bus }: DatabaseServiceSupervisorDeps): SupervisorRegistration {
	const logger = new Logger("DatabaseServiceSupervisor");
	const databaseService = makeDatabaseServiceSupervisor({
		engine,
		logger,
		config: {
			instances: () => desiredInstances(env),
			prefix: () => env.get("DEPLOYER_PREFIX") ?? "",
			runtimeOverride: () => process.env.SUPERVISOR_RUNTIME,
			settings: () => splitManagedEnv(env).database,
		},
	});
	return {
		supervisor: buildSupervisor(databaseService.spec, bus, "DatabaseServiceSupervisor"),
		activate: Effect.sync(() => {
			if (splitManagedEnv(env).database.enabled) {
				logger.log("Externally-managed database service detected (MANAGED_DATABASE_ENABLED=true) — supervisor skipped");
				return null;
			}
			if (desiredInstances(env).length === 0) {
				logger.log("No database service instances configured (MANAGED_DATABASE_INSTANCES) — supervisor not registered");
				return null;
			}
			return {};
		}),
	};
}
