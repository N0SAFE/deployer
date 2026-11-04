import { Context, Effect } from "effect";

import { isPermission } from "@deployer/auth/authz";
import { CurrentActor, HttpRequest, serviceOver } from "@deployer/effect-core";

import { roleHasPermission, roleNamesWithPermission } from "@deployer/shared/core/authz/role-catalog";
import { DatabasePort } from "@identity/core/database/database.port";
import { actionHash } from "@identity/core/utils/action-hash";
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
		ApprovalRepository | CurrentActor | DatabasePort | HttpRequest | AuditService
	>;
	readonly list: (
		filter: AccessRequestFilter,
	) => Effect.Effect<AccessRequestRow[], ApprovalFailure, ApprovalRepository | CurrentActor | DatabasePort | HttpRequest>;
	readonly decide: (
		id: string,
		decision: AccessRequestVote,
	) => Effect.Effect<
		AccessRequestRow,
		ApprovalFailure,
		ApprovalRepository | CurrentActor | DatabasePort | HttpRequest | StepUpService | AuditService
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
	) => Effect.Effect<void, ApprovalFailure, CurrentActor | DatabasePort | HttpRequest>;
	/**
	 * The same guard for a PEER service, which names the actor it authenticated (`SEC-069`).
	 *
	 * A mesh call carries no browser session, so the peer asserts who it verified; the mesh trust is what makes that
	 * claim usable. Everything else — capability, policy, consume, refusal — is identical.
	 */
	readonly requireFor: (
		requesterId: string,
		permission: string,
		actionHash: string,
	) => Effect.Effect<void, ApprovalFailure, CurrentActor | DatabasePort | HttpRequest>;
	readonly consume: (
		actionHash: string,
	) => Effect.Effect<
		{ readonly consumed: boolean },
		ApprovalFailure,
		ApprovalRepository | CurrentActor | DatabasePort | HttpRequest | AuditService
	>;
};

/**
 * Approvals are a CAPABILITY question for the DECIDER and a plain ask for the requester.
 *
 * Asking is not a permission: an account that cannot do something is exactly the account that needs to ask. Deciding is
 * `approval:approve`, requires a fresh passkey proof, and is refused to the requester — one person cannot be two.
 */
const makeApprovalService = (repository: ApprovalRepository["Service"]): ApprovalServiceShape => {
	/**
	 * The one guard, for both callers: an in-process actor and a peer that names the actor it authenticated.
	 */
	const guard = (
		requesterId: string,
		permission: string,
		actionHash: string,
	): Effect.Effect<void, ApprovalFailure, DatabasePort> =>
		Effect.gen(function* () {
			// The named capability must exist, or the guard would be protecting something nothing enforces.
			if (!isPermission(permission)) {
				return yield* Effect.fail(
					new ApprovalForbidden({ reason: `"${permission}" is not a permission this platform declares` }),
				);
			}

			// Holding the capability is the normal path: an approval is only for what the caller cannot do alone.
			const role = yield* repository.roleOf(requesterId);
			if (role !== null && roleHasPermission(role, permission)) return;

			// Without a policy there is no second-person route: the refusal is the ordinary one, not "approval required".
			if (approvalPolicyFor(permission) === null) {
				return yield* Effect.fail(new ApprovalForbidden({ reason: `actor lacks ${permission}` }));
			}

			// SOLO MODE (`DEC-AUTH-16`): with fewer than two people able to approve, a second person cannot exist, so
			// demanding one would lock the only administrator out. The caller has already demanded the passkey proof.
			const approvers = yield* repository.countApprovers(roleNamesWithPermission("approval:approve"));
			if (approvers < 2) return;

			const consumed = yield* repository.consume(requesterId, actionHash, new Date());
			if (!consumed) {
				return yield* Effect.fail(
					new ApprovalForbidden({
						reason: `approval required: ask another admin to approve action ${actionHash}`,
					}),
				);
			}
		});

	return {
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

			// Bind the decision to the proof that passed `assertCritical`, so the vote cannot be re-attributed to another
			// request or approver. A raw WebAuthn assertion would need the browser to send it HERE; this is the digest of the
			// verified proof, which is the same guarantee without re-implementing the ceremony.
			const proof = yield* stepUp.latestProof();
			const proofHash =
				proof === null ? null : actionHash("approval.decide", id, actor.id, proof.id);

			const decided = yield* repository.vote(id, actor.id, decision, proofHash);
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
					proofHash,
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
			return yield* guard(actor.id, permission, actionHash);
		}),

	requireFor: (requesterId, permission, actionHash): ReturnType<ApprovalServiceShape["requireFor"]> =>
		guard(requesterId, permission, actionHash),

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
	};
};

/** The approval ledger's use cases (`SEC-072`). */
export class ApprovalService extends Context.Service<ApprovalService, ApprovalServiceShape>()(
	"identity/ApprovalService",
) {
	static readonly live = serviceOver(ApprovalRepository, makeApprovalService);
}
