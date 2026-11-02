import { Context, Effect } from "effect";

import { roleGrants } from "@deployer/auth/authz";
import { ForbiddenError } from "@deployer/errors";
import { CurrentActor, serviceOver } from "@deployer/effect-core";

import { DatabasePort } from "@identity/core/database/database.port";
import { actorFromCurrent } from "@identity/core/utils/actor.utils";

import { AuditRepository, type AuditPage, type AuditQuery } from "./audit.repository";

export type AuditServiceShape = {
	readonly list: (
		query: AuditQuery,
	) => Effect.Effect<AuditPage, ForbiddenError, AuditRepository | CurrentActor | DatabasePort>;
};

/**
 * Reading the audit log is a CAPABILITY, not a role: `audit:read` is what the route needs, and the check names the
 * permission so a custom role holding it works without a code change.
 */
const makeAuditService = (repository: AuditRepository["Service"]): AuditServiceShape => ({
	list: (query): ReturnType<AuditServiceShape["list"]> =>
		Effect.gen(function* () {
			const actor = actorFromCurrent(yield* CurrentActor);
			if (!roleGrants(actor.role, "audit:read")) {
				return yield* Effect.fail(new ForbiddenError("actor lacks audit:read"));
			}
			return yield* repository.list(query);
		}),
});

export class AuditService extends Context.Service<AuditService, AuditServiceShape>()("identity/AuditService") {
	static readonly live = serviceOver(AuditRepository, makeAuditService);
}
