import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";

import {
	approvalConsumeContract,
	approvalDecideContract,
	approvalListContract,
	approvalRequestContract,
	approvalRequireContract,
} from "@deployer/identity-contracts";
import { procedure } from "@deployer/nest-effect";
import { requireAuth, requireMesh } from "@deployer/shared/core/modules/auth/orpc/middlewares";


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
			.effect(function* ({ input }) {
				const approvals = yield* ApprovalService;
				return yield* approvals.request(input);
			});
	}

	@Implement(approvalListContract)
	list() {
		return procedure(approvalListContract)
			.use(requireAuth())
			.effect(function* ({ input }) {
				const approvals = yield* ApprovalService;
				const data = yield* approvals.list(input.query);
				return { data };
			});
	}

	@Implement(approvalDecideContract)
	decide() {
		return procedure(approvalDecideContract)
			.use(requireAuth())
			.effect(function* ({ input }) {
				const approvals = yield* ApprovalService;
				return yield* approvals.decide(input.params.id, input.body.decision);
			});
	}

	/**
	 * The guard a PEER service calls (`SEC-069`): mesh-authenticated, and it names the actor the peer verified.
	 *
	 * A mesh call carries no browser session, so the anonymous actor is the honest boundary — the identity comes from the
	 * body, and the MESH trust is what makes that claim usable.
	 */
	@Implement(approvalRequireContract)
	requireApproval() {
		return procedure(approvalRequireContract)
			.use(requireMesh())
			.effect(function* ({ input }) {
				const approvals = yield* ApprovalService;
				yield* approvals.requireFor(input.requesterId, input.permission, input.actionHash)
				;
				return { allowed: true as const };
			});
	}

	@Implement(approvalConsumeContract)
	consume() {
		return procedure(approvalConsumeContract)
			.use(requireAuth())
			.effect(function* ({ input }) {
				const approvals = yield* ApprovalService;
				return yield* approvals.consume(input.actionHash);
			});
	}
}
