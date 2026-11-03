import { Context, Effect } from "effect";

import { roleGrants, type ScopeKind } from "@deployer/auth/authz";
import { CurrentActor, serviceOver } from "@deployer/effect-core";
import { ForbiddenError } from "@deployer/errors";

import { DatabasePort } from "@identity/core/database/database.port";
import { actorFromCurrent } from "@identity/core/utils/actor.utils";

import { RoleRepository, type RoleRow } from "./role.repository";

export type RoleServiceShape = {
	/** Internal check for the writers of `user.role`; not a capability, since it exposes nothing. */
	readonly isKnownPlatformRole: (name: string) => Effect.Effect<boolean, never, DatabasePort>;
	readonly list: (
		scope: ScopeKind | undefined,
	) => Effect.Effect<RoleRow[], ForbiddenError, RoleRepository | CurrentActor | DatabasePort>;
};

/**
 * Reading roles is the `role:read` capability, named as the permission so a custom role that holds it works without a
 * code change. The list names what every role can do, which is why it is not public.
 */
const makeRoleService = (repository: RoleRepository["Service"]): RoleServiceShape => ({
	isKnownPlatformRole: (name): ReturnType<RoleServiceShape["isKnownPlatformRole"]> =>
		repository.isKnownPlatformRole(name),

	list: (scope): ReturnType<RoleServiceShape["list"]> =>
		Effect.gen(function* () {
			const actor = actorFromCurrent(yield* CurrentActor);
			if (!roleGrants(actor.role, "role:read")) {
				return yield* Effect.fail(new ForbiddenError("actor lacks role:read"));
			}
			return yield* repository.list(scope);
		}),
});

export class RoleService extends Context.Service<RoleService, RoleServiceShape>()("identity/RoleService") {
	static readonly live = serviceOver(RoleRepository, makeRoleService);
}
