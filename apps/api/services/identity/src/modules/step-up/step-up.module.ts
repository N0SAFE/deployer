import { createModuleContext } from "@deployer/nest-effect";

import { DatabasePort } from "@identity/core/database/database.port";

import { StepUpController } from "./controllers/step-up.controller";
import { StepUpRepository } from "./step-up.repository";
import { StepUpService } from "./step-up.service";

/** Step-up proofs (`AUTH-062`): one read of what the caller's session proved recently. */
export class StepUpDomainModule extends createModuleContext(
	{
		controllers: [StepUpController],
		providers: [
			{ provide: StepUpService, useValue: StepUpService.live },
			{ provide: StepUpRepository, useValue: StepUpRepository.live },
		],
		exports: [StepUpService, StepUpRepository],
	},
	DatabasePort,
) {}
