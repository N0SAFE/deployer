import { createModuleContext } from '@deployer/nest-effect'

import { DatabasePort } from '@identity/core/database/database.port'

import { StepUpController } from './controllers/step-up.controller'
import { StepUpRepository } from './step-up.repository'
import { StepUpService } from './step-up.service'

/** Step-up proofs (`AUTH-062`): one read of what the caller's session proved recently. */
export class StepUpDomainModule extends createModuleContext(
    {
        controllers: [StepUpController],
        providers: [
            // The service takes its repository as a constructor argument (see the class doc), so the
            // factory only wires; the repository yields the database handle itself.
            {
                provide: StepUpService,
                useFactory: (repository: StepUpRepository['Service']) =>
                    new StepUpService.live(repository),
                inject: [StepUpRepository],
            },
            { provide: StepUpRepository, useClass: StepUpRepository.live },
        ],
        exports: [StepUpService, StepUpRepository],
    },
    DatabasePort
) {}
