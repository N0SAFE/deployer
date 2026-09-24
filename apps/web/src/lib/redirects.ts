/**
 * Redirect targets — same-project paths vs external URLs.
 *
 * THE RULE
 * --------
 * A redirect must use a **relative path** when the destination is served by the
 * SAME deployment (`/setup`, `/auth/signin`, `/dashboard/...`). An **absolute
 * URL** is only correct when the destination genuinely lives on a different
 * origin (an external IdP, a tunnel hostname, the dashboard on the web app when
 * the request is being served by the API).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Absolute URLs were being built from `API_URL`, which is the **private Docker
 * network** address (`http://nextjs-nestjs-api-dev:3005`) on the server. That is
 * correct for server-to-server calls and catastrophically wrong in a `Location`
 * header: the browser is told to visit a hostname that only resolves inside the
 * Docker network, so the user sees `ERR_NAME_NOT_RESOLVED` instead of the page.
 *
 * A relative redirect cannot make that mistake — the browser resolves it against
 * the origin it already reached, which is by definition reachable.
 */

/**
 * Is this target an external origin?
 *
 * Anything with an explicit scheme (`https://idp.example`) or a
 * protocol-relative form (`//cdn.example`) leaves this deployment. Bare paths
 * (`/setup`) and relative paths (`dashboard`) stay inside it.
 */
export function isExternalRedirect(target: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
}

/**
 * Normalize anything into a safe redirect target.
 *
 * - absolute URLs are validated and passed through (external redirects MUST be
 *   absolute — that is the one case where a full URL is correct);
 * - everything else is forced to a root-relative path, so a malformed or
 *   internal-looking value can never reach a `Location` header.
 *
 * Returns `fallback` (default `/`) when the input is empty or unparseable, so a
 * caller never emits an empty `Location`.
 */
export function toRedirectTarget(target: string | null | undefined, fallback = "/"): string {
	if (!target || target.trim() === "") return fallback;
	const value = target.trim();

	if (isExternalRedirect(value)) {
		try {
			// Validate: a malformed absolute URL would otherwise produce a
			// Location the browser rejects outright.
			return new URL(value, "http://placeholder.invalid").toString();
		} catch {
			return fallback;
		}
	}

	// In-deployment target. Collapse any accidental scheme/host by treating the
	// value as a path — `toAbsoluteUrl`-style expansion is exactly what leaked
	// the internal hostname.
	return value.startsWith("/") ? value : `/${value}`;
}

/**
 * Absolute URL for an EXTERNAL redirect.
 *
 * The only supported way to build a cross-origin redirect target. Requires an
 * explicit origin so the caller must name the destination: there is no implicit
 * fallback to an internal address, which is how the internal hostname leaked.
 */
export function toExternalRedirectUrl(origin: string, path: string, fallbackOrigin: string): string {
	const base = isExternalRedirect(origin) ? origin : fallbackOrigin;
	try {
		return new URL(path, base).toString();
	} catch {
		return fallbackOrigin;
	}
}
