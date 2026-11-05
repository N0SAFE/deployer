import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'

import { stepUpStatusContract } from '@deployer/identity-contracts'
import { procedure } from '@deployer/nest-effect'
import { requireAuth } from '@deployer/shared/core/modules/auth/orpc/middlewares'

import { StepUpService } from '../step-up.service'

/** Whether the caller's session stepped up recently; the service reads the proof, the transport only resolves it. */
@Controller()
export class StepUpController {
    @Implement(stepUpStatusContract)
    status() {
        return procedure(stepUpStatusContract)
            .use(requireAuth())
            .effect(function* () {
                const stepUp = yield* StepUpService
                return yield* stepUp.status()
            })
    }
}
