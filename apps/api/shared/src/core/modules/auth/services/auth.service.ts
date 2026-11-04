import { Injectable, Optional, Scope } from "@nestjs/common";

import { AuthCoreService, normalizeHeaders } from "./auth-core.service";

import type { Auth } from "../../../../auth";
import type { AuthWithPlugins } from "../definitions/auth-module-definition";

/**
 * The request-scoped face of {@link AuthCoreService}.
 *
 * One instance per HTTP request, purely so a caller in a Nest context does not have to thread the incoming headers by
 * hand. It holds no logic of its own: everything it exposes is the core's, and the core no longer exposes an
 * authorization API (the oRPC gate owns that, `SEC-062`).
 */
@Injectable({ scope: Scope.REQUEST })
export class AuthService<T extends AuthWithPlugins = Auth> {
	constructor(
		private readonly core: AuthCoreService<T>,
		@Optional()
		private readonly request?: Request,
	) {}

	/** The incoming request's headers, normalised to the Web `Headers` shape. */
	getRequestHeaders(): Headers {
		return this.request ? normalizeHeaders(this.request.headers) : new Headers();
	}

	/** The Better Auth API endpoints. */
	get api(): T["api"] {
		return this.core.api;
	}

	/** The whole Better Auth instance. */
	get instance(): T {
		return this.core.instance;
	}

	/** The auth context a request starts with, before the session is resolved. */
	createEmptyAuthUtils() {
		return this.core.createEmptyAuthUtils();
	}

	/** The authenticated session, or the contract-closed `UNAUTHORIZED` refusal. */
	requireAuth(session: Parameters<AuthCoreService<T>["requireAuth"]>[0]) {
		return this.core.requireAuth(session);
	}

	/** Better Auth's OpenAPI schema, for the API document merge. */
	generateAuthOpenAPISchema() {
		return this.core.generateAuthOpenAPISchema();
	}
}
