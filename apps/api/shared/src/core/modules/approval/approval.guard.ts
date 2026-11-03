import { Context, Effect } from "effect";

import { actionHash } from "@deployer/auth/server";
import { ForbiddenError } from "@deployer/errors";
import { approvalContract } from "@deployer/identity-contracts";

import type { ServiceClient } from "../../../server/service-client";

/** What a peer service may ask before a protected action. */
export type ApprovalGuardShape = {
	/**
	 * Verify that `requesterId` may perform exactly `action` now.
	 *
	 * Succeeds when the account's role grants the capability, or when an approval for that hash is consumed; fails with
	 * the refusal otherwise. `ForbiddenError` carries the API's own message, including the digest a caller needs to FILE
	 * the matching request.
	 */
	readonly require: (
		requesterId: string,
		permission: string,
		action: string,
		parts: readonly (string | number)[],
	) => Effect.Effect<void, ForbiddenError>;
};

/**
 * The cross-service approval guard (`SEC-069`, `SEC-072`).
 *
 * The service authenticated the caller; this asks identity the ONE question it cannot answer alone — "is this caller
 * allowed, by capability or by approval, to do this exact action". The digest is computed by the same helper on both
 * sides, so the request a peer files is the request the guard spends.
 *
 * Fail-closed: identity unreachable or refusing both answer `ForbiddenError`. An approval system that silently allows
 * when its ledger is down is not a control.
 */
export class ApprovalGuard extends Context.Service<ApprovalGuard, ApprovalGuardShape>()("approval/Guard") {}

export function makeApprovalGuard(services: ServiceClient): ApprovalGuardShape {
	return {
		require: (requesterId, permission, action, parts): Effect.Effect<void, ForbiddenError> =>
			Effect.tryPromise({
				try: async () => {
					await services.clientFor("identity", approvalContract).require({
						requesterId,
						permission,
						actionHash: actionHash(action, ...parts),
					});
				},
				catch: (cause) => new ForbiddenError(cause instanceof Error ? cause.message : "approval required"),
			}),
	};
}
