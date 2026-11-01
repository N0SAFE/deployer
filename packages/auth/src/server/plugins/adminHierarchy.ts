import type { BetterAuthPlugin, HookEndpointContext } from "better-auth";
import { createAuthMiddleware, getAuthoritativeSessionFromCtx } from "better-auth/api";

import { refuseAdminAction, refuseRoleGrant, type HierarchyRefusal } from "../../authz/hierarchy";

/**
 * The admin endpoints this hook governs.
 *
 * The admin plugin guards each of them with a capability (`user:set-role`, `user:ban`, `user:delete`), which says the
 * caller may administer users — not that it may administer *this* user, nor that it may hand out a role at or above its
 * own. That second half is `refuseAdminAction` / `refuseRoleGrant`; without it an `admin` could grant itself
 * `superAdmin`, or ban and demote the `superAdmin` above it.
 */
const ADMIN_ACTION_PATHS: readonly string[] = [
	"/admin/set-role",
	"/admin/ban-user",
	"/admin/unban-user",
	"/admin/remove-user",
	"/admin/update-user",
	"/admin/impersonate-user",
];

/** The `set-role` and `update-user` bodies carry a role to grant; the others only name a target. */
const GRANTING_PATHS: readonly string[] = ["/admin/set-role", "/admin/update-user"];

type AdminActionBody = {
	readonly userId?: string;
	readonly role?: string;
	readonly data?: { readonly role?: string };
};

/** Everything the decision needs, extracted so the rule can be tested without an HTTP request or a database. */
export function adminActionRefusal(input: {
	readonly path: string;
	readonly actorRole: string | null;
	readonly targetRole: string | null;
	readonly grantedRole?: string | null;
}): HierarchyRefusal | null {
	const refusal = refuseAdminAction({ actorRole: input.actorRole, targetRole: input.targetRole });
	if (refusal !== null) return refusal;

	if (!GRANTING_PATHS.includes(input.path)) return null;

	return refuseRoleGrant({ actorRole: input.actorRole, grantedRole: input.grantedRole ?? null });
}

/**
 * Enforces the platform role hierarchy on Better Auth's admin endpoints.
 *
 * Register it AFTER the admin plugin (the endpoints must exist) and before anything that trusts a role from the cookie
 * cache: the actor is read authoritatively, so a demotion takes effect on the next admin call rather than up to five
 * minutes later.
 */
export const adminHierarchyPlugin = (): BetterAuthPlugin => ({
	id: "adminHierarchy",
	hooks: {
		before: [
			{
				matcher: (context: HookEndpointContext) => ADMIN_ACTION_PATHS.includes(context.path ?? ""),
				handler: createAuthMiddleware(async (ctx) => {
					const session = await getAuthoritativeSessionFromCtx(ctx).catch(() => null);
					// No session is not this hook's business: the endpoint's own middleware refuses it with 401.
					if (!session) return;

					const body = (ctx.body ?? {}) as AdminActionBody;
					if (body.userId === undefined) return;

					// The adapter's typed projection, not `findUserById`: the door's user type has no `role`, and a cast
					// here would hide the day the column is renamed.
					const target = await ctx.context.adapter.findOne<{ id: string; role?: string | null }>({
						model: "user",
						where: [{ field: "id", value: body.userId }],
					});

					const refusal = adminActionRefusal({
						path: ctx.path,
						actorRole: session.user.role ?? null,
						targetRole: target?.role ?? null,
						grantedRole: body.role ?? body.data?.role ?? null,
					});

					if (refusal !== null) {
						throw ctx.error("FORBIDDEN", { message: refusal.message });
					}
				}),
			},
		],
	},
});
