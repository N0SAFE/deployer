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

import { Global, Module } from "@nestjs/common";
import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { NodeConfigRepository, type NodeConfigRepositoryShape, type LocalDb } from "@deployer/node-state";

import { CoreDockerModule } from "../../docker/docker.module";
import { LOCAL_DATABASE_CONNECTION } from "../../database/database-connection";
import { supervisorProviders, SupervisorEventBus } from "../../supervision/index";
import { EnvModule, EnvService } from "../../../../config/env/env.module";
import { makeDatabaseServiceRegistration } from "./database-service.supervisor";
import { makeGlobalDbRegistration } from "./global-db.supervisor";
import { makeLocalDbRegistration } from "./local-db.supervisor";

const DATABASE_SUPERVISORS = Symbol("DATABASE_SUPERVISORS");

@Global()
@Module({
	imports: [CoreDockerModule, EnvModule],
	providers: supervisorProviders({
		token: DATABASE_SUPERVISORS,
		inject: [DockerEngine, NodeConfigRepository, EnvService, SupervisorEventBus, LOCAL_DATABASE_CONNECTION],
		build: (engine: DockerEngineShape, nodeConfig: NodeConfigRepositoryShape, env: EnvService, bus: SupervisorEventBus, db: LocalDb) => [
			makeGlobalDbRegistration({ engine, nodeConfig, env, bus }),
			makeLocalDbRegistration({ db, env, bus }),
			makeDatabaseServiceRegistration({ engine, env, bus }),
		],
	}),
})
export class SupervisorsDatabaseModule {}
