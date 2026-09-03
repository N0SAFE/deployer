/**
 * SupervisorsDatabaseModule — registers the DATABASE supervisors.
 *
 * All supervisor implementations live under `supervisors/` (folder layout):
 *   - database/global-db-supervisor.service.ts  → global Postgres
 *   - database/local-db-supervisor.service.ts   → local SQLite
 *
 * This module owns their DI registration. It is imported by the app alongside
 * the framework `SupervisorsModule` and the platform counterpart. The
 * framework module stays leaf so unit harnesses importing it alone never pull
 * Docker/Env machinery.
 */

import { Global, Module } from "@nestjs/common";

import { CoreDockerModule } from "@/core/modules/docker/docker.module";
import { GlobalDbSupervisorService } from "./global-db-supervisor.service";
import { LocalDbSupervisorService } from "./local-db-supervisor.service";
import { DatabaseServiceSupervisorService } from "./database-service-supervisor.service";

@Global()
@Module({
	imports: [CoreDockerModule],
	providers: [
		GlobalDbSupervisorService,
		LocalDbSupervisorService,
		DatabaseServiceSupervisorService,
	],
	exports: [
		GlobalDbSupervisorService,
		LocalDbSupervisorService,
		DatabaseServiceSupervisorService,
	],
})
export class SupervisorsDatabaseModule {}