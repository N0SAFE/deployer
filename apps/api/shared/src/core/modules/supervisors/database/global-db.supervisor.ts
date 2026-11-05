import { Logger } from "@nestjs/common";
import { Effect } from "effect";

import { MANAGED_POSTGRES_IMAGE } from "@deployer/docker";
import type { DockerEngineShape } from "@deployer/docker";
import { splitManagedEnv } from "@deployer/env";
import {
	GLOBAL_DB_SUPERVISOR_ID,
	
	
	makeGlobalDbSupervisor,
	
} from "@deployer/platform-supervisors";

import { EnvService } from "../../../../config/env/env.module";
import type { NodeConfigSnapshotShape } from "../../node-state/node-config.snapshot";
import { buildSupervisor, type SupervisorEventBusFacade, type SupervisorRegistration } from "../../supervision/index";

export { GLOBAL_DB_SUPERVISOR_ID };

export type GlobalDbSupervisorDeps = {
	readonly engine: DockerEngineShape;
	/** Synchronous cache of `node_config`: the spec's config callbacks cannot await a repository. */
	readonly snapshot: Pick<NodeConfigSnapshotShape, "current" | "refresh">;
	readonly env: EnvService;
	readonly bus: SupervisorEventBusFacade;
};

/**
 * The global Postgres supervisor. What it does (schedule the managed Postgres as a swarm service,
 * observe it or an external database) is `@deployer/platform-supervisors`; this supplies the engine,
 * the environment and the node config, and decides WHETHER to register.
 *
 * Registration is made once at module init: only when the database is not compose-managed, a database
 * URL exists in the node config, and it is locally managed (`databaseProvisioning: "local"`).
 * External databases keep the startup guard / probe path and are never supervised, so they never appear
 * in health reports.
 */
export function makeGlobalDbRegistration({ engine, snapshot, env, bus }: GlobalDbSupervisorDeps): SupervisorRegistration {
	const logger = new Logger("GlobalDbSupervisor");
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
			provisioning: () => snapshot.current()?.databaseProvisioning,
			// The persisted DSN; empty when nothing was written yet, which consumers gate on.
			databaseUrl: () => snapshot.current()?.databaseUrl ?? "",
		},
	});
	return {
		supervisor: buildSupervisor(globalDb.spec, bus, "GlobalDbSupervisor"),
		activate: snapshot.refresh().pipe(
			Effect.map((row) => {
				if (isComposeManaged()) {
					logger.log("Compose-managed global DB detected (MANAGED_GLOBAL_DB_ENABLED=true) — supervisor skipped (not registered)");
					return null;
				}
				// A real DATABASE URL has been written to the node config (setup wizard or dev bootstrap completed).
				if (!row?.databaseUrl?.trim()) {
					logger.log("Global-db dependencies not ready (no database URL) — skipping registration (retry from dev console after setup)");
					return null;
				}
				if (row?.databaseProvisioning === "local") {
					logger.log("Locally-managed database detected — Postgres supervisor active");
					return {};
				}
				logger.log("Externally-managed database — Postgres supervisor disabled (not registered)");
				return null;
			}),
		),
	};
}
