import type { BetterAuthPlugin, HookEndpointContext } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

/**
 * Revokes a user's credentials after an administration action that changes what they may do.
 *
 * The admin plugin writes the row and nothing else: a ban or a role change left the target's sessions alive, so a
 * banned user kept working until their session expired and a demoted one kept the old role until it did. Sessions carry
 * the role, so the only way a change takes effect *now* is to end them — and the API keys, which resolve to their own
 * sessions through `enableSessionForAPIKeys`.
 *
 * Runs as an `after` hook: the action must have succeeded before anything is revoked. It runs on:
 *
 *   - `/admin/ban-user` — the account must stop acting immediately;
 *   - `/admin/set-role` — the session holds the old role;
 *   - `/admin/remove-user` — the user row is gone; the credentials must not outlive it.
 *
 * `internalAdapter.deleteSessions` takes tokens, not a user id, so the sessions are listed first. Both steps are
 * best-effort: a revocation that fails must not turn a successful ban into a 500, and the next session check still sees
 * the ban once the cookie cache (60 s) lapses.
 */
const REVOKING_PATHS: readonly string[] = ["/admin/ban-user", "/admin/set-role", "/admin/remove-user"];

type RevocationBody = { readonly userId?: string };

/** The user an admin action targeted, or `null` when the body does not name one. */
export function revokedUserId(body: unknown): string | null {
	const userId = (body as RevocationBody | undefined)?.userId;
	return typeof userId === "string" && userId.length > 0 ? userId : null;
}

export const adminSessionRevocationPlugin = (): BetterAuthPlugin => ({
	id: "adminSessionRevocation",
	hooks: {
		after: [
			{
				matcher: (context: HookEndpointContext) => REVOKING_PATHS.includes(context.path ?? ""),
				handler: createAuthMiddleware(async (ctx) => {
					const userId = revokedUserId(ctx.body);
					if (userId === null) return;

					const sessions = await ctx.context.internalAdapter.listSessions(userId).catch(() => []);
					const tokens = sessions.map((session) => session.token).filter((token) => token.length > 0);
					if (tokens.length > 0) {
						await ctx.context.internalAdapter.deleteSessions(tokens).catch(() => undefined);
					}

					// The api-key plugin's rows are keyed by `referenceId` (the owning user).
					await ctx.context.adapter
						.deleteMany({ model: "apikey", where: [{ field: "referenceId", value: userId }] })
						.catch(() => undefined);
				}),
			},
		],
	},
});
