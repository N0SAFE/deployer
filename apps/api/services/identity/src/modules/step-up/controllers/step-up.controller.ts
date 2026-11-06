import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'
import { Effect } from 'effect'

import {
    stepUpAssertCriticalContract,
    stepUpStatusContract,
} from '@deployer/identity-contracts'
import { procedure } from '@deployer/nest-effect'
import {
    requireAuth,
    requireSystemActor,
} from '@deployer/shared/core/modules/auth/orpc/middlewares'

import { ForbiddenError } from '@deployer/errors'

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

    /**
     * Whether the session a peer names stepped up: the guard a peer service calls before an act that needs a passkey. A system
     * actor, never a session; the signed claim's `subject` is the session, and a claim that names none is refused.
     */
    @Implement(stepUpAssertCriticalContract)
    assertCritical() {
        return procedure(stepUpAssertCriticalContract)
            .use(requireSystemActor('identity'))
            .effect(function* ({ context }) {
                const sessionId = context.systemActor.subject
                if (sessionId === null) {
                    return yield* Effect.fail(
                        new ForbiddenError(
                            'step-up check needs the session it is about'
                        )
                    )
                }
                const stepUp = yield* StepUpService
                yield* stepUp.assertCriticalFor(sessionId)
                return { critical: true as const }
            })
    }
}
