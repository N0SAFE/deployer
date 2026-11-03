import { createModuleContext } from "@deployer/nest-effect";

import { DatabasePort } from "@identity/core/database/database.port";

import { AuditRepository } from "./audit.repository";
import { AuditService } from "./audit.service";
import { AuditController } from "./controllers/audit.controller";

/** The auth audit log: append-only reads for whoever holds `audit:read`. */
export class AuditDomainModule extends createModuleContext(
	{
		controllers: [AuditController],
		exports: [AuditService, AuditRepository],
		providers: [
			{ provide: AuditService, useValue: AuditService.live },
			{ provide: AuditRepository, useValue: AuditRepository.live },
		],
	},
	DatabasePort,
) {}
