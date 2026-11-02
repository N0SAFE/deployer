import { createModuleContext } from "@deployer/nest-effect";

import { DatabasePort } from "@identity/core/database/database.port";

import { RoleController } from "./controllers/role.controller";
import { RoleRepository } from "./role.repository";
import { RoleService } from "./role.service";

/**
 * The role catalogue: reads for the picker, plus the boot-time seed that keeps the built-in roles in sync with
 * `SYSTEM_ROLES_TABLE`. The seed itself lives in `RoleSeedModule`: it runs on Nest's `OnApplicationBootstrap`, not in
 * a request context.
 */
export class RoleDomainModule extends createModuleContext(
	{
		controllers: [RoleController],
		providers: [
			{ provide: RoleService, useValue: RoleService.live },
			{ provide: RoleRepository, useValue: RoleRepository.live },
		],
	},
	DatabasePort,
) {}
