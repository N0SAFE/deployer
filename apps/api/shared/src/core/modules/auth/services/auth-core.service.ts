import { Context, Effect } from "effect";

import { domainError } from "@deployer/effect-core";

import type { AuthModuleOptions, AuthWithPlugins } from "../definitions/auth-module-definition";
import { AuthUtils, AuthUtilsEmpty } from "../orpc/auth-utils";

import { type UserSession } from "../utils/auth-utils";

import type { Auth } from "../../../../auth";
import type { IncomingHttpHeaders } from "http";


/** Type for request-scoped headers. */
export type RequestHeaders = IncomingHttpHeaders | Record<string, string | string[]> | Headers;

/** Normalise the shapes Node and fetch hand us to one `Headers` (array values joined, per the HTTP spec). */
export function normalizeHeaders(headers: RequestHeaders): Headers {
	if (headers instanceof Headers) return headers;

	const result = new Headers();
	for (const [key, value] of Object.entries(headers)) {
		if (Array.isArray(value)) result.set(key, value.join(", "));
		else if (typeof value === "string") result.set(key, value);
	}
	return result;
}

/** The configured Better Auth instance has no OpenAPI generator: an install problem, not a caller problem. */
export class AuthOpenApiGeneratorMissing extends domainError("AuthOpenApiGeneratorMissing", "dependency_missing")() {
	override publicMessage() { return "Better Auth OpenAPI generator is not available on the configured auth instance."; }
}

/**
 * The Better Auth instance, as this process holds it.
 *
 * ── WHAT IS NOT HERE ANY MORE ───────────────────────────────────────────────
 * This used to be the home of a plugin registry, a Nest-guard converter and an oRPC middleware builder, all so a handler
 * could call `auth.api.*` / `admin.hasPermission(...)` itself. Every one of those is a SECOND authorization mechanism
 * beside the gate, and the platform decided to have one (`SEC-062`): the gate refuses before the handler runs, so a
 * handler that also checks is either redundant or — worse — different.
 *
 * What remains is what a transport boundary genuinely needs: the instance, `api`, the empty auth context, and the
 * contract-closed refusal (`requireAuth` throws the oRPC `UNAUTHORIZED` the contract declares).
 */
export type AuthCoreServiceShape<T extends AuthWithPlugins = Auth> = {
	readonly getModuleOptions: () => AuthModuleOptions<T>;
	/** The Better Auth API endpoints. */
	readonly api: T["api"];
	/** The whole Better Auth instance, for the rare caller that needs plugins it configured. */
	readonly instance: T;
	/** The auth context a request starts with, before the session is resolved. */
	readonly createEmptyAuthUtils: () => AuthUtilsEmpty;
	/** The authenticated session, or the contract-closed `UNAUTHORIZED` refusal. */
	readonly requireAuth: (session: UserSession | null) => UserSession;
	/**
	 * Better Auth's OpenAPI schema, for the API document merge. The schema is static and needs no request headers.
	 */
	readonly generateAuthOpenAPISchema: () => Effect.Effect<unknown, AuthOpenApiGeneratorMissing>;
};

export function makeAuthCoreService<T extends AuthWithPlugins = Auth>(options: AuthModuleOptions<T>): AuthCoreServiceShape<T> {
	return {
		getModuleOptions: () => options,
		api: options.auth.api,
		instance: options.auth,
		createEmptyAuthUtils: () => new AuthUtilsEmpty(),
		requireAuth: (session) => new AuthUtils(session).requireAuth(),
		generateAuthOpenAPISchema: () => {
			const api = options.auth.api as {
				generateOpenAPISchema?: (input: Record<string, never>) => unknown;
			};
			const generate = api.generateOpenAPISchema;
			return generate === undefined ? Effect.fail(new AuthOpenApiGeneratorMissing({})) : Effect.sync(() => generate({}));
		},
	};
}

export class AuthCoreService extends Context.Service<AuthCoreService, AuthCoreServiceShape>()("shared/AuthCoreService") {}
