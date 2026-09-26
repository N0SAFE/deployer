"use client";

/**
 * Where a completed setup hands the operator over.
 *
 * THE RULE (see the web app's `lib/redirects.ts` for the same contract):
 *   - a SAME-ORIGIN destination is returned as a relative path (`/dashboard`),
 *     so the browser resolves it against the origin it already reached — which
 *     is by definition reachable;
 *   - an ABSOLUTE URL is produced ONLY for the one genuinely cross-origin case:
 *     the wizard runs on the SETUP surface (`setup.<domain>`) while the
 *     dashboard lives on the WEB surface (`web.<domain>`).
 *
 * WHY: absolute URLs were previously built by string-munging the request
 * hostname, and a missing-protocol branch even returned a bare
 * `web.deployer.localhost`. Relative-where-possible removes both failure modes:
 * the browser can never be sent to an unqualified or internal hostname unless a
 * real cross-origin hop is being made, and that hop names its origin explicitly.
 *
 * WHY THE PREFIX IS `setup.` AND NOT `api.` (this changed with the refactor):
 * the wizard used to be served BY the API, so a completed setup was already on
 * `api.<domain>` and only had to hop to `web.<domain>`. The wizard now lives in
 * its own app on `setup.<domain>`, which is a different origin from BOTH — so
 * the same single hop still applies, just from the new host. The rule is
 * unchanged: replace the service label, keep the rest of the hostname, so a
 * prefixed deployment (`setup.acme.deployer.localhost`) resolves to
 * `web.acme.deployer.localhost` without any prefix-specific logic. The pattern
 * is anchored to the START of the hostname so a domain that merely CONTAINS
 * "setup." is not mistaken for the setup surface.
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
	if (!/^setup\./.test(hostname)) return target;

	// Cross-origin hand-off: the wizard is on `setup.<domain>` and the dashboard
	// on `web.<domain>`. This is the ONLY case needing an absolute URL, and the
	// origin is stated explicitly rather than inferred at the call site.
	const webOrigin = `${protocol}//${hostname.replace(/^setup\./, "web.")}`;
	return new URL(target, webOrigin).toString();
}
