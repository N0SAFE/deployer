"use client";

/**
 * Better Auth client for the wizard's sign-in step.
 *
 * The wizard is PRE-AUTH (no session, no guard), but its final step authenticates
 * the admin that onboarding just created — so this client exists for that one
 * call, not to establish a session the setup app itself would use.
 *
 * `basePath: "/api/auth"` with credentials, and NO `baseURL`: the wizard is
 * served by the setup app, which proxies the API, so a relative request reaches
 * the API through the same origin that served the page. That is what keeps the
 * cookie valid after the handover, when the browser is sent to `api.<host>` —
 * same registrable domain, same cookie.
 *
 * Same contract as the web app's helper: Better Auth returns `{ data, error }`
 * and does NOT throw, so the failure is normalized into a thrown Error. That
 * shared contract is what lets the wizard's final button behave identically on
 * every surface.
 */

import { createAuthClientFactory } from "@repo/auth/client";

export const auth = createAuthClientFactory({
	basePath: "/api/auth",
	fetchOptions: { credentials: "include" },
});

/**
 * Typed email/password sign-in.
 */
export async function signInWithEmail(input: { email: string; password: string }): Promise<unknown> {
	const result = await auth.signIn.email(input);
	if (result.error) {
		throw new Error(result.error.message ?? "Sign in failed");
	}
	return result.data;
}
