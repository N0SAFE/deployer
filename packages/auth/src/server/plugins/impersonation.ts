import { createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod/v4";

import { IMPERSONATION_TTL_SECONDS, canImpersonate } from "../../authz/impersonation";

import type { AuthAuditSink } from "../../audit/events";
import type { BetterAuthPlugin } from "better-auth";

/** Where the admin's own session token waits while the impersonated one is active. */
const PARKED_ADMIN_TOKEN = "deployer.admin_session";

/** The columns this plugin reads off a user row; nothing else is needed to decide and mint a session. */
interface ImpersonationTarget {
	readonly id: string;
	readonly name: string;
	readonly email: string;
	readonly role?: string | null;
	readonly banned?: boolean | null;
}

export interface ImpersonationOptions {
	/**
	 * Whether the CALLER's session holds a fresh passkey proof.
	 *
	 * A port, not a table: `packages/auth` owns no schema, and the deployment answers it from `step_up_events`. Absent
	 * means no proof exists, so impersonation is refused — the safe direction.
	 */
	readonly hasStepUp?: (sessionId: string) => Promise<boolean>;
	/** Where the attempt and its outcome are recorded. */
	readonly audit?: AuthAuditSink;
}

interface SessionWithImpersonation {
	readonly impersonatedBy?: string | null;
}

/**
 * Impersonation, wrapped (`AUTH-067`).
 *
 * Replaces the `loginAs`/master-token doors: a `superAdmin` (or a custom role holding `user:impersonate`) may act as a
 * STRICTLY weaker principal for one hour, after a passkey step-up and with a reason. Better Auth's raw impersonate
 * endpoint is never mounted — the admin plugin that owned it is gone, and this endpoint is the only writer of
 * `session.impersonated_by`.
 *
 * ── WHY THE ADMIN'S SESSION IS PARKED IN A COOKIE ───────────────────────────
 * Impersonation REPLACES the session cookie: every request after this one must see the target. The admin's token is the
 * only way back, so it waits in an HttpOnly, signed cookie scoped to the auth path, and `stop-impersonating` restores it.
 * Nothing else can read it, and it expires with the impersonated session.
 *
 * ── WHY THE IMPERSONATED SESSION IS READ-ONLY ───────────────────────────────
 * `actorFromContext` maps a session carrying `impersonatedBy` to the platform `viewer` role, so every capability check
 * answers with read-only rights. That is stronger than trusting each handler to remember a flag, and it is the design's
 * default (`DEC-AUTH-25`): a write while impersonating is a deliberate later feature, not an accident.
 */
export const impersonationPlugin = (options: ImpersonationOptions = {}) => ({
	id: "impersonation",
	endpoints: {
		impersonate: createAuthEndpoint(
			"/impersonate",
			{
				method: "POST",
				use: [sessionMiddleware],
				body: z.object({
					userId: z.string().min(1),
					/** Why — required, and recorded. "Because I can" is not an answer an audit reader accepts. */
					reason: z.string().min(5),
				}),
			},
			async (ctx) => {
				// `sessionMiddleware` answers 401 in production; this guard keeps the handler honest when called directly
				// (a plugin test, or a future mount that forgets the middleware).
				const session = ctx.context.session as typeof ctx.context.session | null;
				if (session === null) {
					return ctx.json({ error: "Authentication required" }, { status: 401 });
				}

				const actor = session.user as ImpersonationTarget;
				const existing = session.session as SessionWithImpersonation;
				// Nested impersonation would make the audit row lie about who is acting.
				if (existing.impersonatedBy !== null && existing.impersonatedBy !== undefined) {
					return ctx.json({ error: "Already impersonating" }, { status: 409 });
				}

				const target = await ctx.context.adapter.findOne<ImpersonationTarget>({
					model: "user",
					where: [{ field: "id", value: ctx.body.userId, operator: "eq" }],
				});
				if (target === null) return ctx.json({ error: "User not found" }, { status: 404 });
				if (target.banned === true) return ctx.json({ error: "User is banned" }, { status: 409 });

				const refusal = canImpersonate(actor.role ?? "user", target.role ?? "user");
				if (refusal !== null) {
					options.audit?.record({
						action: "impersonation-start",
						actorId: actor.id,
						targetId: target.id,
						detail: { refused: refusal },
					});
					return ctx.json({ error: `Impersonation refused: ${refusal}` }, { status: 403 });
				}

				const steppedUp = options.hasStepUp === undefined ? false : await options.hasStepUp(session.session.id);
				if (!steppedUp) {
					options.audit?.record({
						action: "impersonation-start",
						actorId: actor.id,
						targetId: target.id,
						detail: { refused: "step-up-required" },
					});
					return ctx.json({ error: "A passkey step-up is required" }, { status: 403 });
				}

				const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_SECONDS * 1000);
				const impersonated = await ctx.context.internalAdapter.createSession(target.id, false, {
					impersonatedBy: actor.id,
					expiresAt,
				});

				// Park the admin's token BEFORE replacing the cookie: if this fails, the admin can still stop.
				await ctx.setSignedCookie(PARKED_ADMIN_TOKEN, session.session.token, ctx.context.secret, {
					httpOnly: true,
					sameSite: "lax",
					maxAge: IMPERSONATION_TTL_SECONDS,
					path: "/",
				});

				await setSessionCookie(ctx, { session: impersonated, user: target as never });

				options.audit?.record({
					action: "impersonation-start",
					actorId: actor.id,
					targetId: target.id,
					ip: ctx.headers?.get("x-forwarded-for") ?? undefined,
					userAgent: ctx.headers?.get("user-agent") ?? undefined,
					detail: { reason: ctx.body.reason, expiresAt: expiresAt.toISOString() },
				});

				return ctx.json({ success: true, impersonatedUserId: target.id, expiresAt });
			},
		),

		/**
		 * Allow WRITES inside an impersonated session (`DEC-AUTH-25`).
		 *
		 * Read-only is the default; this is the explicit toggle, and it costs a fresh passkey proof from the admin who is
		 * impersonating — not the target's password, which the admin does not have. The flag lives on the session row, so
		 * ending the impersonation ends the permission with it.
		 */
		enableImpersonationWrites: createAuthEndpoint(
			"/enable-impersonation-writes",
			{ method: "POST", use: [sessionMiddleware] },
			async (ctx) => {
				const session = ctx.context.session as typeof ctx.context.session | null;
				if (session === null) {
					return ctx.json({ error: "Authentication required" }, { status: 401 });
				}

				const impersonated = session.session as SessionWithImpersonation;
				const impersonatedBy = impersonated.impersonatedBy;
				if (typeof impersonatedBy !== "string" || impersonatedBy.length === 0) {
					return ctx.json({ error: "This session is not impersonating anyone" }, { status: 409 });
				}

				const steppedUp = options.hasStepUp === undefined ? false : await options.hasStepUp(session.session.id);
				if (!steppedUp) {
					return ctx.json({ error: "A passkey step-up is required to enable writes" }, { status: 403 });
				}

				await ctx.context.internalAdapter.updateSession(session.session.token, {
					impersonationWrites: true,
				});

				options.audit?.record({
					action: "impersonation-writes-enabled",
					actorId: impersonatedBy,
					targetId: session.user.id,
				});

				return ctx.json({ success: true });
			},
		),

		stopImpersonating: createAuthEndpoint(
			"/stop-impersonating",
			{ method: "POST", use: [sessionMiddleware] },
			async (ctx) => {
				const session = ctx.context.session as typeof ctx.context.session | null;
				if (session === null) {
					return ctx.json({ error: "Authentication required" }, { status: 401 });
				}

				const impersonated = session.session as SessionWithImpersonation;
				const impersonatedBy = impersonated.impersonatedBy;
				if (typeof impersonatedBy !== "string" || impersonatedBy.length === 0) {
					return ctx.json({ error: "This session is not impersonating anyone" }, { status: 409 });
				}

				const adminId = impersonated.impersonatedBy;
				if (typeof adminId !== "string" || adminId.length === 0) {
					return ctx.json({ error: "This session is not impersonating anyone" }, { status: 409 });
				}

				const parked = await ctx.getSignedCookie(PARKED_ADMIN_TOKEN, ctx.context.secret);
				if (parked === null || parked === false || parked === "") {
					return ctx.json({ error: "The impersonating admin's session is gone" }, { status: 400 });
				}

				const adminSession = await ctx.context.internalAdapter.findSession(parked);
				if (adminSession?.user.id !== adminId) {
					return ctx.json({ error: "The parked session does not match" }, { status: 400 });
				}

				// The impersonated session is single-use: sign-out semantics, without touching the admin's.
				await ctx.context.internalAdapter.deleteSession(session.session.token);
				await setSessionCookie(ctx, { session: adminSession.session, user: adminSession.user });
				ctx.setCookie(PARKED_ADMIN_TOKEN, "", { maxAge: 0, path: "/" });

				options.audit?.record({
					action: "impersonation-stop",
					actorId: adminId,
					targetId: session.user.id,
				});

				return ctx.json({ success: true });
			},
		),
	},
}) satisfies BetterAuthPlugin;
