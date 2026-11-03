import { createModuleContext } from "@deployer/nest-effect";

import { DatabasePort } from "@identity/core/database/database.port";
import { StepUpDomainModule } from "@identity/modules/step-up/step-up.module";

import { ApprovalRepository } from "./approval.repository";
import { ApprovalService } from "./approval.service";
import { ApprovalController } from "./controllers/approval.controller";

/** Approvals (`SEC-072`): the ledger and its decide/consume surface. */
export class ApprovalDomainModule extends createModuleContext(
	{
		controllers: [ApprovalController],
		imports: [StepUpDomainModule],
		providers: [
			{ provide: ApprovalService, useValue: ApprovalService.live },
			{ provide: ApprovalRepository, useValue: ApprovalRepository.live },
		],
	},
	DatabasePort,
) {}
