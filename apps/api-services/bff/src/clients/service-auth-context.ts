import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The CALLER's credentials, carried to the service clients the BFF fans out with.
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 * A service resolves `context.auth` from the session cookie on the request it
 * receives (`createAuthMiddleware` → `auth.api.getSession({ headers })`). When the
 * BFF forwarded the browser's request verbatim, the cookie travelled with it and
 * this worked by accident.
 *
 * An orchestrator does NOT forward — it calls several services itself. Those calls
 * are new requests, and by default they carry no cookie, so every service would
 * answer 401 and the whole layer would be dead on arrival. The BFF must therefore
 * make the caller's credentials travel, deliberately, to each fan-out leg.
 *
 * ── WHY ASYNC LOCAL STORAGE AND NOT A PARAMETER ─────────────────────────────
 * The alternative is threading `headers` through every orchestrator, every helper
 * and `ServiceClientRegistry.clientFor`. That is a parameter that every function in
 * the layer must accept and none of them inspects — the definition of noise. ALS
 * binds the credentials to the REQUEST instead: the edge seeds it once, the link
 * plugin reads it on each outgoing call, and no orchestrator has to know it exists.
 *
 * ── WHY IT IS SEEDED AT THE EDGE, NOT READ INSIDE THE PLUGIN ────────────────
 * The plugin runs deep inside an outgoing fetch with no access to the inbound
 * request. Capturing at the edge — where the inbound request provably exists — is
 * what makes the value the FAN-OUT's caller rather than a stray global.
 */
export interface ServiceAuthContext {
	/** The caller's cookies, including the session cookie services authenticate from. */
	cookie?: string;
	/** The caller's Authorization header, when they use one (dev auth token, API key). */
	authorization?: string;
	/** The platform-scoped mesh internal key, when the caller holds one. */
	meshInternalKey?: string;
}

const storage = new AsyncLocalStorage<ServiceAuthContext>();

/** Run `fn` with `auth` visible to every service client called inside it. */
export function runWithServiceAuth<T>(auth: ServiceAuthContext, fn: () => T): T {
	return storage.run(auth, fn);
}

/** The credentials for the in-flight request, or an empty set outside one. */
export function currentServiceAuth(): ServiceAuthContext {
	return storage.getStore() ?? {};
}

/**
 * The headers to send on a fan-out leg.
 *
 * Only the three credentials travel — not the caller's full header set. Relaying
 * everything would push the browser's `accept-encoding`, `user-agent` and
 * conditional headers onto an internal JSON call, where they mean nothing and
 * where `content-length` in particular would make the service wait for bytes that
 * are not coming.
 */
export function serviceAuthHeaders(): Record<string, string> {
	const auth = currentServiceAuth();
	const headers: Record<string, string> = {};
	if (auth.cookie) headers.cookie = auth.cookie;
	if (auth.authorization) headers.authorization = auth.authorization;
	if (auth.meshInternalKey) headers["x-mesh-internal-key"] = auth.meshInternalKey;
	return headers;
}
