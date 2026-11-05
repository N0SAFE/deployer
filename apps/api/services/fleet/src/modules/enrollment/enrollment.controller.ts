import { Controller, Inject } from '@nestjs/common'
import { Implement } from '@orpc/nest'

import { meshEnrollmentContract } from '@deployer/fleet-contracts'
import { procedure } from '@deployer/nest-effect'

import { EnrollmentService } from './enrollment.service'

/** Anonymous on purpose: the caller is a node that is not in the fleet yet, and its join token is its authorization. */
@Controller()
export class EnrollmentController {
    constructor(
        @Inject(EnrollmentService)
        private readonly enrollment: EnrollmentService
    ) {}

    @Implement(meshEnrollmentContract.describe)
    describe() {
        return procedure(meshEnrollmentContract.describe).handler(({ input }) =>
            this.enrollment.describe(input.token)
        )
    }

    @Implement(meshEnrollmentContract.enroll)
    enroll() {
        return procedure(meshEnrollmentContract.enroll).handler(({ input }) =>
            this.enrollment.enroll(input)
        )
    }
}
