"use client";

/**
 * Where a completed setup hands the operator over.
 *
 * THE RULE (see the web app's `lib/redirects.ts` for the same contract):
 *   - a SAME-ORIGIN destination is returned as a relative path (`/dashboard`),
 *     so the browser resolves it against the origin it already reached — which
 *     is by definition reachable;
 *   - an ABSOLUTE URL is produced ONLY for the one genuinely cross-origin case
 *     here: the wizard runs on the API surface (`api.<domain>`) while the
 *     dashboard lives on the web surface (`web.<domain>`).
 *
 * WHY: absolute URLs were previously built by string-munging the request
 * hostname, and a missing-protocol branch even returned a bare
 * `web.deployer.localhost`. Relative-where-possible removes both failure modes:
 * the browser can never be sent to an unqualified or internal hostname unless a
 * real cross-origin hop is being made, and that hop names its origin explicitly.
 */
export function resolvePostSetupRedirect(search?: string): string {
	const params = new URLSearchParams(
		search ?? (typeof window === "undefined" ? "" : window.location.search),
	);

	// What the gate captured before bouncing into setup — a WEB-app path.
	const target = params.get("redirectTo")?.trim() || "/";

	// Server-side render: no origin to cross, so a relative path is correct and
	// always valid (it used to return a protocol-less hostname here).
	if (typeof window === "undefined") return target;

	const { hostname, protocol } = window.location;

	// Already on the web surface (or a single-origin deployment): the dashboard
	// is on THIS origin, so stay relative.
	if (!/^api\./.test(hostname)) return target;

	// Cross-origin hand-off: the wizard is on `api.<domain>` and the dashboard
	// on `web.<domain>`. This is the ONLY case needing an absolute URL, and the
	// origin is stated explicitly rather than inferred at the call site.
	const webOrigin = `${protocol}//${hostname.replace(/^api\./, "web.")}`;
	return new URL(target, webOrigin).toString();
}
