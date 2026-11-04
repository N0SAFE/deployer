/**
 * SupervisorsDatabaseModule — registers the DATABASE supervisors.
 *
 * All supervisor definitions live under `supervisors/` (folder layout):
 *   - database/global-db.supervisor.ts        → global Postgres
 *   - database/local-db.supervisor.ts         → local SQLite
 *   - database/database-service.supervisor.ts → scaled Postgres instances
 *
 * This module owns their DI registration. It is imported by the app alongside the framework
 * `SupervisorsModule` and the platform counterpart. The framework module stays leaf so unit harnesses
 * importing it alone never pull Docker/Env machinery.
 */

import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { createGlobalModule } from "@deployer/nest-effect";
import type { LocalDb } from "@deployer/node-state";

import { EnvModule, EnvService } from "../../../../config/env/env.module";
import { LOCAL_DATABASE_CONNECTION } from "../../database/database-connection";
import { CoreDockerModule } from "../../docker/docker.module";
import { NodeConfigSnapshot, type NodeConfigSnapshotShape } from "../../node-state/node-config.snapshot";
import { supervisorProviders, SupervisorEventBus, type SupervisorEventBusFacade } from "../../supervision/index";

import { makeDatabaseServiceRegistration } from "./database-service.supervisor";
import { makeGlobalDbRegistration } from "./global-db.supervisor";
import { makeLocalDbRegistration } from "./local-db.supervisor";

const DATABASE_SUPERVISORS = Symbol("DATABASE_SUPERVISORS");

export const SupervisorsDatabaseModule = createGlobalModule({
	imports: [CoreDockerModule, EnvModule],
	providers: supervisorProviders({
		token: DATABASE_SUPERVISORS,
		inject: [DockerEngine, NodeConfigSnapshot, EnvService, SupervisorEventBus, LOCAL_DATABASE_CONNECTION],
		build: (engine: DockerEngineShape, snapshot: NodeConfigSnapshotShape, env: EnvService, bus: SupervisorEventBusFacade, db: LocalDb) => [
			makeGlobalDbRegistration({ engine, snapshot, env, bus }),
			makeLocalDbRegistration({ db, env, bus }),
			makeDatabaseServiceRegistration({ engine, env, bus }),
		],
	}),
});
