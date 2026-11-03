import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";

import {
	approvalConsumeContract,
	approvalDecideContract,
	approvalListContract,
	approvalRequestContract,
} from "@deployer/identity-contracts";
import { procedure } from "@deployer/nest-effect";
import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { serve } from "@identity/core/orpc/serve";

import { ApprovalService } from "../approval.service";

/**
 * The approval ledger's surface (`SEC-072`).
 *
 * Capability checks live in the service; the transport resolves the session and maps the typed refusals.
 */
@Controller()
export class ApprovalController {
	@Implement(approvalRequestContract)
	request() {
		return procedure(approvalRequestContract)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const approvals = yield* ApprovalService;
				return yield* serve(context)(approvals.request(input));
			});
	}

	@Implement(approvalListContract)
	list() {
		return procedure(approvalListContract)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const approvals = yield* ApprovalService;
				const data = yield* serve(context)(approvals.list(input.query));
				return { data };
			});
	}

	@Implement(approvalDecideContract)
	decide() {
		return procedure(approvalDecideContract)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const approvals = yield* ApprovalService;
				return yield* serve(context)(approvals.decide(input.params.id, input.body.decision));
			});
	}

	@Implement(approvalConsumeContract)
	consume() {
		return procedure(approvalConsumeContract)
			.use(requireAuth())
			.effect(function* ({ input, context }) {
				const approvals = yield* ApprovalService;
				return yield* serve(context)(approvals.consume(input.actionHash));
			});
	}
}
