import { Controller, Inject } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { meshEnrollmentContract } from "@deployer/fleet-contracts";
import { AllowAnonymous } from "@deployer/shared/core/modules/auth/decorators/decorators";

import { EnrollmentService } from "./enrollment.service";

/** Anonymous on purpose: the caller is a node that is not in the fleet yet, and its join token is its authorization. */
@Controller()
export class EnrollmentController {
  constructor(@Inject(EnrollmentService) private readonly enrollment: EnrollmentService) {}

  @Implement(meshEnrollmentContract.describe)
  @AllowAnonymous()
  describe() {
    return implement(meshEnrollmentContract.describe).handler(({ input }) => this.enrollment.describe(input.token));
  }

  @Implement(meshEnrollmentContract.enroll)
  @AllowAnonymous()
  enroll() {
    return implement(meshEnrollmentContract.enroll).handler(({ input }) => this.enrollment.enroll(input));
  }
}
