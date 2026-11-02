import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";

import { auditListContract } from "@deployer/identity-contracts";
import { procedure } from "@deployer/nest-effect";
import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { serve } from "@identity/core/orpc/serve";

import { AuditService } from "../audit.service";

/**
 * The auth audit log's read surface (`AUTH-029`).
 *
 * `auth:audit` is checked in the service against the actor's role; the transport only resolves the session.
 */
@Controller()
export class AuditController {
	@Implement(auditListContract)
	list() {
		return procedure(auditListContract)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const audit = yield* AuditService;
				return yield* serve(context)(audit.list(input.query));
			});
	}
}
