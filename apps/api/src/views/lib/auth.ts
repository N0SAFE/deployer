"use client";

/**
 * Better Auth client for the API-served views.
 *
 * Mirrors the client used by the API's own login view (`@/views/pages/login`):
 * the same-origin `basePath: "/api/auth"` with credentials, so the session
 * cookie set here is the one the API and the web app both read. No `baseURL`
 * is passed — the page is served BY the API, so relative requests already hit
 * the right origin (and stay correct behind Traefik).
 */

import { createAuthClientFactory } from "@repo/auth/client";

export const auth = createAuthClientFactory({
	basePath: "/api/auth",
	fetchOptions: { credentials: "include" },
});

/**
 * Typed email/password sign-in.
 *
 * Better Auth returns `{ data, error }` — it does NOT throw — so the failure is
 * normalized into a thrown Error with the server message. Same contract as the
 * web app's helper, which is what lets the setup wizard's final button behave
 * identically on both surfaces.
 */
export async function signInWithEmail(input: { email: string; password: string }): Promise<unknown> {
	const result = await auth.signIn.email(input);
	if (result.error) {
		throw new Error(result.error.message ?? "Sign in failed");
	}
	return result.data;
}
