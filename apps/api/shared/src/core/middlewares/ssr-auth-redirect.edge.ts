import { logger } from "@deployer/logger";

import { edgeAt, type HttpEdgeEntry } from "../../server/http-edge";
import { normalizeHeaders } from "../modules/auth/services/auth-core.service";

import type { RequestHandler } from "express";

/** What the redirect needs from Better Auth: a session lookup. Structural, so a spec passes a plain object. */
export interface SessionLookup {
	readonly api: { getSession(input: { headers: Headers }): Promise<{ user?: unknown } | null> };
}

const LOGIN_PATH = "/manage/login";
const log = logger.scope("ssr-auth");

/**
 * Server-side auth redirect for the SSR pages the API serves itself (`/manage/*`).
 *
 * A request without a valid Better Auth session cookie is redirected to the login page; `/manage/login` itself is exempt,
 * or nobody could ever sign in. It reuses the SAME auth core as the oRPC and HTTP surfaces — no duplicated session logic, no
 * client-only redirects. A failed session lookup (a malformed cookie, say) is treated as unauthenticated and never leaks.
 *
 * A plain function, not a Nest middleware. (Unwired today: see `ARCH-089`, which decides whether the SSR pages exist.)
 */
export function ssrAuthRedirect(auth: SessionLookup): RequestHandler {
	return async (req, res, next) => {
		if (req.originalUrl.split("?")[0] === LOGIN_PATH) {
			next();
			return;
		}
		try {
			const session = await auth.api.getSession({ headers: normalizeHeaders(req.headers) });
			if (session?.user !== undefined) {
				next();
				return;
			}
		} catch (error) {
			log.debug(`SSR auth session check failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		res.redirect(LOGIN_PATH);
	};
}

export const ssrAuthRedirectEdge = (auth: SessionLookup): HttpEdgeEntry => edgeAt("ssr-auth-redirect", "/manage", ssrAuthRedirect(auth));
