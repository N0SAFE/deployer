import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";

import { roleListContract } from "@deployer/identity-contracts";
import { procedure } from "@deployer/nest-effect";
import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { serve } from "@identity/core/orpc/serve";

import { RoleService } from "../role.service";

/** The role catalogue's read surface; `role:read` is enforced in the service. */
@Controller()
export class RoleController {
	@Implement(roleListContract)
	list() {
		return procedure(roleListContract)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const roles = yield* RoleService;
				const data = yield* serve(context)(roles.list(input.query.scope));
				return { data };
			});
	}
}
