import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'

import { meshEnrollmentContract } from '@deployer/fleet-contracts'
import { procedure } from '@deployer/nest-effect'

import { Enrollment } from './enrollment.service'

/**
 * Anonymous on purpose: the caller is a node that is not in the fleet yet, and its join token is its authorization. There is
 * no session middleware, and the service refuses a token its agent does not vouch for before it does anything else.
 */
@Controller()
export class EnrollmentController {
    @Implement(meshEnrollmentContract.describe)
    describe() {
        return procedure(meshEnrollmentContract.describe).effect(function* ({ input }) {
            const enrollment = yield* Enrollment
            return yield* enrollment.describe(input.token)
        })
    }

    @Implement(meshEnrollmentContract.enroll)
    enroll() {
        return procedure(meshEnrollmentContract.enroll).effect(function* ({ input }) {
            const enrollment = yield* Enrollment
            return yield* enrollment.enroll(input)
        })
    }
}
