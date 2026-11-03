import { Context, Effect } from "effect";

import { isPermission, roleGrants } from "@deployer/auth/authz";
import { CurrentActor, serviceOver } from "@deployer/effect-core";

import { DatabasePort } from "@identity/core/database/database.port";
import { StepUpService } from "@identity/modules/step-up/step-up.service";

import { ApprovalForbidden, ApprovalInvalid, ApprovalNotFound, type ApprovalFailure } from "./approval.errors";
import {
	ApprovalRepository,
	type AccessRequestFilter,
	type AccessRequestRow,
	type AccessRequestVote,
} from "./approval.repository";

export type ApprovalRequestInput = {
	readonly permission: string;
	readonly scope: Record<string, unknown>;
	readonly actionHash: string;
	readonly reason: string;
	readonly ttlSec: number;
	readonly requiredApprovals: number;
};

export type ApprovalServiceShape = {
	readonly request: (
		input: ApprovalRequestInput,
	) => Effect.Effect<AccessRequestRow, ApprovalFailure, ApprovalRepository | CurrentActor | DatabasePort>;
	readonly list: (
		filter: AccessRequestFilter,
	) => Effect.Effect<AccessRequestRow[], ApprovalFailure, ApprovalRepository | CurrentActor | DatabasePort>;
	readonly decide: (
		id: string,
		decision: AccessRequestVote,
	) => Effect.Effect<
		AccessRequestRow,
		ApprovalFailure,
		ApprovalRepository | CurrentActor | DatabasePort | StepUpService
	>;
	readonly consume: (
		actionHash: string,
	) => Effect.Effect<
		{ readonly consumed: boolean },
		ApprovalFailure,
		ApprovalRepository | CurrentActor | DatabasePort
	>;
};

/**
 * Approvals are a CAPABILITY question for the DECIDER and a plain ask for the requester.
 *
 * Asking is not a permission: an account that cannot do something is exactly the account that needs to ask. Deciding is
 * `approval:approve`, requires a fresh passkey proof, and is refused to the requester — one person cannot be two.
 */
const makeApprovalService = (repository: ApprovalRepository["Service"]): ApprovalServiceShape => ({
	request: (input): ReturnType<ApprovalServiceShape["request"]> =>
		Effect.gen(function* () {
			const actor = yield* CurrentActor;
			if (actor.kind !== "user") {
				return yield* Effect.fail(new ApprovalForbidden({ reason: "only a signed-in account can ask for approval" }));
			}
			// The ledger names a capability the guard will later check; a typo would record consent for nothing.
			if (!isPermission(input.permission)) {
				return yield* Effect.fail(new ApprovalInvalid({ reason: `"${input.permission}" is not a permission this platform declares` }));
			}

			const now = Date.now();
			return yield* repository.create({
				permission: input.permission,
				requesterId: actor.id,
				via: null,
				scope: input.scope,
				actionHash: input.actionHash,
				reason: input.reason,
				requiredApprovals: input.requiredApprovals,
				ttlSec: input.ttlSec,
				expiresAt: new Date(now + input.ttlSec * 1000),
			});
		}),

	list: (filter): ReturnType<ApprovalServiceShape["list"]> =>
		Effect.gen(function* () {
			const actor = yield* CurrentActor;
			if (actor.kind !== "user" || !roleGrants(actor.role, "approval:read")) {
				return yield* Effect.fail(new ApprovalForbidden({ reason: "actor lacks approval:read" }));
			}
			return yield* repository.list(filter);
		}),

	decide: (id, decision): ReturnType<ApprovalServiceShape["decide"]> =>
		Effect.gen(function* () {
			const actor = yield* CurrentActor;
			if (actor.kind !== "user" || !roleGrants(actor.role, "approval:approve")) {
				return yield* Effect.fail(new ApprovalForbidden({ reason: "actor lacks approval:approve" }));
			}

			const stepUp = yield* StepUpService;
			yield* stepUp
				.assertCritical()
				.pipe(Effect.mapError(() => new ApprovalForbidden({ reason: "a fresh passkey proof is required to approve" })));

			const request = yield* repository.findById(id);
			if (request === null) return yield* Effect.fail(new ApprovalNotFound({ id }));

			// Two people means two PEOPLE: the requester's own vote is not a second opinion.
			if (request.requesterId === actor.id) {
				return yield* Effect.fail(new ApprovalForbidden({ reason: "you cannot decide your own request" }));
			}
			if (request.status !== "pending") {
				return yield* Effect.fail(new ApprovalInvalid({ reason: `request is already ${request.status}` }));
			}

			const now = new Date();
			if (request.expiresAt.getTime() <= now.getTime()) {
				return yield* Effect.fail(new ApprovalInvalid({ reason: "request has expired" }));
			}

			const decided = yield* repository.vote(id, actor.id, decision);
			if (decided === null) return yield* Effect.fail(new ApprovalNotFound({ id }));
			return decided;
		}),

	consume: (actionHash): ReturnType<ApprovalServiceShape["consume"]> =>
		Effect.gen(function* () {
			const actor = yield* CurrentActor;
			if (actor.kind !== "user") {
				return yield* Effect.fail(new ApprovalForbidden({ reason: "only the requester can spend an approval" }));
			}
			const consumed = yield* repository.consume(actor.id, actionHash, new Date());
			return { consumed };
		}),
});

/** The approval ledger's use cases (`SEC-072`). */
export class ApprovalService extends Context.Service<ApprovalService, ApprovalServiceShape>()(
	"identity/ApprovalService",
) {
	static readonly live = serviceOver(ApprovalRepository, makeApprovalService);
}
