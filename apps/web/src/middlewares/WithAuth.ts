/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { getCookieCache, getSessionCookie } from "better-auth/cookies";
import { NextFetchEvent, NextProxy, NextRequest } from "next/server";

import type { Session } from "@deployer/auth";
import { isPlatformAdministrator } from "@deployer/auth/authz";

import { createContextFilterDebugLogger } from "@/lib/logging/context-filter-debug";
import { AuthDashboard, AuthSignin } from "@/routes/index";

import { redirectSameOrigin } from "./utils/redirects";
import { nextjsRegexpPageOnly, nextNoApi } from "./utils/static";
import { ConfigFactory, Matcher, MiddlewareFactory } from "./utils/types";

import { validateEnvSafe } from "#/env";



const debugAuth = createContextFilterDebugLogger("WithAuth", "middleware:[WithAuth]");
const debugAuthError = createContextFilterDebugLogger("WithAuth", "middleware:[WithAuth]:error");

const env = validateEnvSafe(process.env).data;

const dashboardRegexpAndChildren = /^\/dashboard(\/.*)?$/;

/**
 * Pages only an administrator may open.
 *
 * The server is the boundary — every mutation checks the role itself — so this is UX: a viewer who follows a stale link
 * should see "not for you" instead of a page whose every button fails. It is enforced here because the role is read from
 * the same verified session the page would use.
 */
const ADMIN_ONLY_PATHS: readonly RegExp[] = [/^\/settings\/users(\/.*)?$/];

/** What the gate decided for one request. */
export type AuthGateDecision = "allow" | "signin" | "forbidden";

export interface AuthGateInput {
	/** A session cookie is present (signed by the API, but not verified here on its own). */
	readonly hasSessionCookie: boolean;
	/** The verified session: the cookie cache when it is live, otherwise the API's answer. */
	readonly session: { readonly user?: { readonly role?: string | null } } | null;
	readonly path: string;
}

/**
 * The decision, as data.
 *
 * A cookie alone is not authentication: it proves a value was issued, not that the session still exists. The caller
 * therefore passes the resolved session, and `null` means "not authenticated" whether that came from a missing cookie
 * or from an API that refused it.
 */
export function authGateDecision(input: AuthGateInput): AuthGateDecision {
	// Both are required: the cookie is the credential, the session is the proof it still means something.
	if (!input.hasSessionCookie || input.session === null) return "signin";

	if (ADMIN_ONLY_PATHS.some((pattern) => pattern.test(input.path))) {
		return isPlatformAdministrator(input.session.user?.role) ? "allow" : "forbidden";
	}

	return "allow";
}

/**
 * The session, when the cookie cache does not answer for it.
 *
 * The cache lives 60 seconds (the API's `session.cookieCache.maxAge`), so a user who has been idle for a minute would
 * otherwise be bounced to sign-in on every navigation. Asking the API is the server-side validation the cache stands in
 * for: same trust boundary, one request, only when the cache is cold. A failed call answers `null` — an unreachable API
 * must not look like an authenticated user.
 */
async function verifyWithApi(request: NextRequest, baseUrl: string): Promise<SessionLike | null> {
	try {
		const response = await fetch(`${baseUrl}/api/auth/get-session`, {
			headers: { cookie: request.headers.get("cookie") ?? "" },
			cache: "no-store",
		});
		if (!response.ok) return null;
		const body = (await response.json()) as SessionLike | null;
		return body !== null && typeof body === "object" && "user" in body ? body : null;
	} catch (error) {
		debugAuthError("Session verification failed", {
			error: error instanceof Error ? error.message : error,
		});
		return null;
	}
}

interface SessionLike {
	readonly user?: { readonly role?: string | null };
}



const withAuth: MiddlewareFactory = (next: NextProxy) => {
	if (!env) {
		debugAuthError("Environment variables are not valid", {
			env: process.env,
			error: validateEnvSafe(process.env).error,
		});
		throw new Error("env is not valid");
	}

	return async (request: NextRequest, _next: NextFetchEvent) => {
		const path = request.nextUrl.pathname;
		debugAuth(`Checking authentication for ${path}`, { path });

		const masterTokenEnabled =
			env.NODE_ENV === "development" ? request.cookies.get("master-token-enabled")?.value === "true" : false;

		if (masterTokenEnabled) {
			return next(request, _next);
		}

		const sessionCookie = getSessionCookie(request);

		let cached: SessionLike | null = null;
		try {
			cached = await getCookieCache<Session & { updatedAt: number }>(request, {
				secret: env.BETTER_AUTH_SECRET,
				// Match the cookie security setting from the API
				// In Docker without HTTPS termination, use non-secure cookies
				isSecure: env.NEXT_PUBLIC_API_URL?.startsWith("https://") ?? false,
			});
		} catch (error) {
			debugAuthError("Error reading the session cookie cache", {
				error: error instanceof Error ? error.message : error,
			});
		}

		const session =
			cached ?? (sessionCookie !== null && env.NEXT_PUBLIC_API_URL ? await verifyWithApi(request, env.NEXT_PUBLIC_API_URL) : null);

		const decision = authGateDecision({ hasSessionCookie: sessionCookie !== null, session, path });
		debugAuth(`Session result - decision: ${decision}`, { path, decision });

		if (decision === "allow") return next(request, _next);

		if (decision === "forbidden") {
			// Same-origin redirect into the app, not a 403 page: the viewer keeps their session and can navigate.
			return redirectSameOrigin(request, AuthDashboard({}, {}));
		}

		debugAuth(`Redirecting unauthenticated user from ${path} to signin`);
		return redirectSameOrigin(
			request,
			AuthSignin({}, { redirectTo: path + (request.nextUrl.search ?? "") }),
		);
	};
};

export default withAuth;

export const matcher: Matcher = [
	{
		and: [
			nextNoApi,
			nextjsRegexpPageOnly,
			{
				or: [
					dashboardRegexpAndChildren,
					"/settings",
					"/settings/users",
					"/profile",
					// The device-authorisation page: approving a CLI login requires a real, signed-in user, and a
					// signed-out visitor must be sent to sign-in rather than to a page that cannot act.
					"/device",
				],
			},
		],
	},
];

export const config: ConfigFactory = {
	name: "withAuth",
	matcher: true,
};
