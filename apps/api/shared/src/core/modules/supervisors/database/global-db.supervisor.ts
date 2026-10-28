import { runSyncUnwrapped } from "@deployer/effect-core";
import { Logger } from "@nestjs/common";
import type { DockerEngineShape } from "@deployer/docker";
import { NodeConfigRepository, type NodeConfigRepositoryShape } from "@deployer/node-state"
import { buildSupervisor, type SupervisorEventBus, type SupervisorRegistration } from "../../supervision/index";
import { MANAGED_POSTGRES_IMAGE } from "@deployer/docker";
import { Effect } from "effect";
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

export type GlobalDbSupervisorDeps = {
	readonly engine: DockerEngineShape;
	readonly nodeConfig: NodeConfigRepositoryShape;
	readonly env: EnvService;
	readonly bus: SupervisorEventBus;
};

/**
 * The global Postgres supervisor. What it does (schedule the managed Postgres as a swarm service,
 * observe it or an external database) is `@deployer/platform-supervisors`; this supplies the engine,
 * the environment and the node config, and decides WHETHER to register.
 *
 * Registration is made once at module init: only when the database is not compose-managed, a database
 * URL exists in the local node config, and it is locally managed (`databaseProvisioning: "local"`).
 * External databases keep the startup guard / probe path and are never supervised, so they never appear
 * in health reports.
 */
export function makeGlobalDbRegistration({ engine, nodeConfig, env, bus }: GlobalDbSupervisorDeps): SupervisorRegistration {
	const logger = new Logger("GlobalDbSupervisor");
	const stored = () => {
		try {
			return runSyncUnwrapped(nodeConfig.find());
		} catch {
			return null;
		}
	};
	/** True when the deployment owns the global Postgres (dev compose stack): the API never spawns or supervises it. */
	const isComposeManaged = () => splitManagedEnv(env).globalDb.enabled;

	const globalDb = makeGlobalDbSupervisor({
		engine,
		logger,
		config: {
			prefix: () => env.get("DEPLOYER_PREFIX"),
			identity: () => ({
				databaseName: env.get("DB_DATABASE") ?? "deployer",
				username: env.get("DB_USER") ?? "deployer",
				password: env.get("DB_PASSWORD") ?? "deployer",
				image: MANAGED_POSTGRES_IMAGE,
			}),
			composeManaged: isComposeManaged,
			runtimeOverride: () => process.env.SUPERVISOR_RUNTIME,
			provisioning: () => stored()?.databaseProvisioning,
			// The persisted DSN; empty when nothing was written yet, which consumers gate on.
			databaseUrl: () => stored()?.databaseUrl ?? "",
		},
	});
	return {
		supervisor: buildSupervisor(globalDb.spec, bus, "GlobalDbSupervisor"),
		activate: Effect.sync(() => {
			if (isComposeManaged()) {
				logger.log("Compose-managed global DB detected (MANAGED_GLOBAL_DB_ENABLED=true) — supervisor skipped (not registered)");
				return null;
			}
			// A real DATABASE URL has been written to the local node config (setup wizard or dev bootstrap completed).
			if (!Boolean(stored()?.databaseUrl?.trim())) {
				logger.log("Global-db dependencies not ready (no database URL) — skipping registration (retry from dev console after setup)");
				return null;
			}
			if (stored()?.databaseProvisioning === "local") {
				logger.log("Locally-managed database detected — Postgres supervisor active");
				return {};
			}
			logger.log("Externally-managed database — Postgres supervisor disabled (not registered)");
			return null;
		}),
	};
}
