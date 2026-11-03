import { Context, Effect } from "effect";

import { isPermission } from "@deployer/auth/authz";
import { CurrentActor, serviceOver } from "@deployer/effect-core";

import { roleHasPermission } from "@identity/core/authz/role-catalog";
import { DatabasePort } from "@identity/core/database/database.port";
import { AuditService } from "@identity/modules/audit/audit.service";
import { StepUpService } from "@identity/modules/step-up/step-up.service";

import { ApprovalForbidden, ApprovalInvalid, ApprovalNotFound, type ApprovalFailure } from "./approval.errors";
import { approvalPolicyFor } from "./approval.policy";
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
	) => Effect.Effect<
		AccessRequestRow,
		ApprovalFailure,
		ApprovalRepository | CurrentActor | DatabasePort | AuditService
	>;
	readonly list: (
		filter: AccessRequestFilter,
	) => Effect.Effect<AccessRequestRow[], ApprovalFailure, ApprovalRepository | CurrentActor | DatabasePort>;
	readonly decide: (
		id: string,
		decision: AccessRequestVote,
	) => Effect.Effect<
		AccessRequestRow,
		ApprovalFailure,
		ApprovalRepository | CurrentActor | DatabasePort | StepUpService | AuditService
	>;
	/**
	 * The guard a protected action calls (`SEC-072`).
	 *
	 * Allowed when the actor's role already grants `permission`; otherwise an approved, unexpired, matching request is
	 * consumed atomically. Anything else is a refusal, which the caller maps to its own domain error.
	 */
	readonly require: (
		permission: string,
		actionHash: string,
	) => Effect.Effect<void, ApprovalFailure, CurrentActor | DatabasePort>;
	readonly consume: (
		actionHash: string,
	) => Effect.Effect<
		{ readonly consumed: boolean },
		ApprovalFailure,
		ApprovalRepository | CurrentActor | DatabasePort | AuditService
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

			// Only a policied action is approvable. Otherwise the row would sit in a queue whose approval no guard reads,
			// and the requester would wait for consent that changes nothing.
			const policy = approvalPolicyFor(input.permission);
			if (policy === null) {
				return yield* Effect.fail(
					new ApprovalInvalid({ reason: `"${input.permission}" cannot be approved; it is not a policied action` }),
				);
			}

			const now = Date.now();
			const ttlSec = Math.min(input.ttlSec, policy.ttlSec);
			const created = yield* repository.create({
				permission: input.permission,
				requesterId: actor.id,
				via: null,
				scope: input.scope,
				actionHash: input.actionHash,
				reason: input.reason,
				// The policy decides the quorum, never the requester's payload: asking for fewer approvers must not shorten
				// the rule.
				requiredApprovals: Math.max(input.requiredApprovals, policy.requiredApprovals),
				ttlSec,
				expiresAt: new Date(now + ttlSec * 1000),
			});

			const audit = yield* AuditService;
			yield* audit.record({
				action: "approval-requested",
				actorId: actor.id,
				detail: {
					requestId: created.id,
					permission: created.permission,
					actionHash: created.actionHash,
					requiredApprovals: created.requiredApprovals,
				},
			});
			return created;
		}),

	list: (filter): ReturnType<ApprovalServiceShape["list"]> =>
		Effect.gen(function* () {
			const actor = yield* CurrentActor;
			if (actor.kind !== "user" || !roleHasPermission(actor.role, "approval:read")) {
				return yield* Effect.fail(new ApprovalForbidden({ reason: "actor lacks approval:read" }));
			}

			// Expire before reading, so the queue never shows a request that can no longer be approved.
			yield* repository.expireStale(new Date());
			return yield* repository.list(filter);
		}),

	decide: (id, decision): ReturnType<ApprovalServiceShape["decide"]> =>
		Effect.gen(function* () {
			const actor = yield* CurrentActor;
			if (actor.kind !== "user" || !roleHasPermission(actor.role, "approval:approve")) {
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

			const audit = yield* AuditService;
			yield* audit.record({
				action: "approval-decided",
				actorId: actor.id,
				targetId: decided.requesterId,
				detail: {
					requestId: decided.id,
					permission: decided.permission,
					decision,
					status: decided.status,
				},
			});
			return decided;
		}),

	require: (permission, actionHash): ReturnType<ApprovalServiceShape["require"]> =>
		Effect.gen(function* () {
			const actor = yield* CurrentActor;
			if (actor.kind !== "user") {
				return yield* Effect.fail(new ApprovalForbidden({ reason: "a system caller cannot be approved for this action" }));
			}

			// The named capability must exist, or the guard would be protecting something nothing enforces.
			if (!isPermission(permission)) {
				return yield* Effect.fail(
					new ApprovalForbidden({ reason: `"${permission}" is not a permission this platform declares` }),
				);
			}

			// Holding the capability is the normal path: an approval is only for what the caller cannot do alone.
			if (roleHasPermission(actor.role, permission)) return;

			// Without a policy there is no second-person route: the refusal is the ordinary one, not "approval required".
			if (approvalPolicyFor(permission) === null) {
				return yield* Effect.fail(new ApprovalForbidden({ reason: `actor lacks ${permission}` }));
			}

			const consumed = yield* repository.consume(actor.id, actionHash, new Date());
			if (!consumed) {
				return yield* Effect.fail(
					new ApprovalForbidden({
						// The digest is not a secret — it is a hash of the action the caller is already attempting — and
						// echoing it is what lets the caller FILE the matching request without a copy of the server's
						// canonicalisation.
						reason: `approval required: ask another admin to approve action ${actionHash}`, 
					}),
				);
			}
		}),

	consume: (actionHash): ReturnType<ApprovalServiceShape["consume"]> =>
		Effect.gen(function* () {
			const actor = yield* CurrentActor;
			if (actor.kind !== "user") {
				return yield* Effect.fail(new ApprovalForbidden({ reason: "only the requester can spend an approval" }));
			}
			const consumed = yield* repository.consume(actor.id, actionHash, new Date());

			const audit = yield* AuditService;
			yield* audit.record({
				action: "approval-consumed",
				actorId: actor.id,
				detail: { actionHash, consumed },
			});
			return { consumed };
		}),
});

/** The approval ledger's use cases (`SEC-072`). */
export class ApprovalService extends Context.Service<ApprovalService, ApprovalServiceShape>()(
	"identity/ApprovalService",
) {
	static readonly live = serviceOver(ApprovalRepository, makeApprovalService);
}
