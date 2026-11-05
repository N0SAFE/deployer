import { createModuleContext } from "@deployer/nest-effect";

import { DatabaseModule } from "../database/database.module";
import { GlobalDatabaseService, type GlobalDatabaseServiceShape } from "../database/services/global-database.service";

import { ProjectAccessRepository } from "./repositories/project-access.repository";
import { ProjectAccessService } from "./services/project-access.service";

/**
 * Project ownership and collaborator lookups, for the tiers that gate a project.
 *
 * Both classes are Effect services: the repository reads the current connection from the global database handle (the
 * pool is a placeholder at boot and is initialised later), and the service yields it per call.
 */
export class ProjectCoreModule extends createModuleContext({
	imports: [DatabaseModule],
	providers: [
		{
			provide: ProjectAccessRepository,
			useFactory: (database: GlobalDatabaseServiceShape) => new ProjectAccessRepository.live(database.handle),
			inject: [GlobalDatabaseService],
		},
		{ provide: ProjectAccessService, useClass: ProjectAccessService.live },
	],
	// The service yields the repository per call, so a module that reaches the service must be able to reach it too.
	exports: [ProjectAccessService, ProjectAccessRepository],
}) {}

