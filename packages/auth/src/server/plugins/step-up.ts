import { createAuthMiddleware } from "better-auth/api";

import type { StepUpMethod } from "../../authz/step-up";
import type { BetterAuthPlugin } from "better-auth";

/** One completed verification, bound to the session that performed it. */
export interface StepUpEvent {
	readonly sessionId: string;
	readonly userId: string;
	readonly method: StepUpMethod;
	/** Why the caller asked, when the request carried a reason. */
	readonly reason?: string;
}

/**
 * Where step-up proofs go.
 *
 * A sink rather than a table, for the same reason the audit hook takes one: `packages/auth` builds an instance for
 * callers that own no database, and the deployment that has one passes `drizzleStepUpSink`.
 */
export interface StepUpSink {
	record(event: StepUpEvent): void;
}

/**
 * The endpoints that PROVE a factor.
 *
 * Only a successful verification reaches the `after` hook — Better Auth runs it on a 2xx response. `/passkey/verify-
 * authentication` is the signed-in re-verification (a passkey tap); `/two-factor/verify-totp` is AAL2 and is recorded
 * so an operator can see it, but `isCriticalStepUp` refuses it for critical actions.
 */
const VERIFYING_PATHS: readonly { readonly path: string; readonly method: StepUpMethod }[] = [
	{ path: "/passkey/verify-authentication", method: "passkey" },
	{ path: "/two-factor/verify-totp", method: "totp" },
];

/**
 * Record every factor verification as a step-up for the CURRENT session (`AUTH-062`).
 *
 * The session is read from the verified context, never from the body: a caller must not be able to claim a step-up for
 * another session by naming its id. Silent on failure, like the audit hook — a missing proof row must not turn a
 * successful passkey ceremony into an error the browser sees.
 */
export const stepUpPlugin = (sink: StepUpSink): BetterAuthPlugin => ({
	id: "step-up",
	hooks: {
		after: [
			{
				matcher: (context) => VERIFYING_PATHS.some((candidate) => candidate.path === context.path),
				handler: createAuthMiddleware((ctx) => {
					const verifying = VERIFYING_PATHS.find((candidate) => candidate.path === ctx.path);
					const session = ctx.context.session;
					if (verifying === undefined || session === null) return Promise.resolve();

					const reason = (ctx.body as { reason?: unknown } | undefined)?.reason;
					sink.record({
						sessionId: session.session.id,
						userId: session.user.id,
						method: verifying.method,
						...(typeof reason === "string" && reason.length > 0 ? { reason } : {}),
					});
					return Promise.resolve();
				}),
			},
		],
	},
});
